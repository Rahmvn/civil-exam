import path from "node:path";

import {
  ACTIVE_SUBJECT_SLUGS,
  DEV_SEED_SOURCE_MARKERS,
  IMPORT_REQUIRED_FIELDS,
  IMPORTER_INPUT_DIRECTORY,
  IMPORTER_VALID_STATUSES,
  REPORT_DIRECTORIES,
  VALID_CORRECT_OPTIONS,
} from "./contentRules.mjs";
import {
  findDuplicateNumbers,
  findMissingSequentialNumbers,
  hasValue,
  normalizeText,
  parseCliArgs,
  readJsonFile,
  summarizeCounts,
  toBulletList,
  writeMarkdownReport,
} from "./contentUtils.mjs";
import { detectContentType } from "./validateContent.mjs";

const EXPLICIT_ORAL_FIELDS = ["resource_type", "prompt", "model_answer", "key_points"];

function hasDevSeedSource(sourceNote) {
  const normalized = normalizeText(sourceNote).toLowerCase();
  return DEV_SEED_SOURCE_MARKERS.some((marker) => normalized.includes(marker));
}

function collectQuestionTextDuplicates(items) {
  const duplicates = [];
  const seen = new Map();

  items.forEach((item, index) => {
    const key = normalizeText(item.question_text);
    if (!key) {
      return;
    }

    const positions = seen.get(key) ?? [];
    positions.push(index + 1);
    seen.set(key, positions);
  });

  for (const positions of seen.values()) {
    if (positions.length > 1) {
      duplicates.push(positions);
    }
  }

  return duplicates;
}

function checkImportReady(items) {
  const errors = [];
  const warnings = [];

  if (detectContentType(items) === "oral") {
    errors.push("Oral prep content cannot be consumed by the CBT question importer.");
  }

  const subjectSummary = summarizeCounts(items, (item) => item.subject_slug || "missing");
  const batchSummary = summarizeCounts(
    items,
    (item) => `${item.subject_slug || "missing"} batch ${item.batch_number ?? "missing"}`,
  );

  const batchPositions = [];
  const sourceNumbers = [];
  const emptyExplanationItems = [];
  const needsReviewItems = [];
  const reviewNoteItems = [];

  items.forEach((item, index) => {
    const label = `Item ${index + 1}`;

    for (const field of IMPORT_REQUIRED_FIELDS) {
      if (!hasValue(item[field])) {
        errors.push(`${label}: missing ${field}.`);
      }
    }

    if (!ACTIVE_SUBJECT_SLUGS.has(item.subject_slug)) {
      errors.push(`${label}: invalid subject_slug "${item.subject_slug}".`);
    }

    if (!VALID_CORRECT_OPTIONS.has(item.correct_option) || item.correct_option === null) {
      errors.push(`${label}: correct_option must be A, B, C, or D.`);
    }

    if (!IMPORTER_VALID_STATUSES.has(item.status)) {
      errors.push(`${label}: status must be draft, review, or published.`);
    }

    for (const field of EXPLICIT_ORAL_FIELDS) {
      if (field in item) {
        errors.push(`${label}: oral prep field ${field} should not be present.`);
      }
    }

    const optionValues = [item.option_a, item.option_b, item.option_c, item.option_d];
    if (optionValues.some((value) => !hasValue(value))) {
      errors.push(`${label}: one or more options are missing.`);
    }

    if (hasValue(item.batch_position)) {
      batchPositions.push(Number(item.batch_position));
    }

    if (hasValue(item.source_number)) {
      sourceNumbers.push(Number(item.source_number));
    }

    if (!hasValue(item.explanation)) {
      emptyExplanationItems.push(index + 1);
      errors.push(`${label}: explanation is empty and would block the current importer.`);
    }

    if (item.needs_review === true) {
      needsReviewItems.push(index + 1);
      warnings.push(`${label}: needs_review is true.`);
    }

    if (Array.isArray(item.review_notes) && item.review_notes.length > 0) {
      reviewNoteItems.push(index + 1);
      warnings.push(`${label}: review_notes present (${item.review_notes.length}).`);
    }

    if (!hasValue(item.source_note)) {
      warnings.push(`${label}: source_note is empty.`);
    } else if (hasDevSeedSource(item.source_note)) {
      errors.push(`${label}: source_note uses a development-seed marker.`);
    }
  });

  const duplicateBatchPositions = findDuplicateNumbers(batchPositions);
  if (duplicateBatchPositions.length) {
    errors.push(`Duplicate batch_position values detected (${duplicateBatchPositions.join(", ")}).`);
  }

  const missingBatchPositions = findMissingSequentialNumbers(batchPositions);
  if (missingBatchPositions.length) {
    errors.push(`Batch position gaps detected (${missingBatchPositions.join(", ")}).`);
  }

  const duplicateSourceNumbers = findDuplicateNumbers(sourceNumbers);
  if (duplicateSourceNumbers.length) {
    errors.push(`Duplicate source_number values detected (${duplicateSourceNumbers.join(", ")}).`);
  }

  const duplicateQuestionTexts = collectQuestionTextDuplicates(items);
  for (const group of duplicateQuestionTexts) {
    errors.push(`Duplicate question_text detected at items ${group.join(", ")}.`);
  }

  const published = items.length > 0 && items.every((item) => item.status === "published");
  const allReviewed =
    items.length > 0 &&
    items.every(
      (item) =>
        item.needs_review !== true &&
        (!Array.isArray(item.review_notes) || item.review_notes.length === 0),
    );

  let readiness = "BLOCKED";
  let recommendation = "Do not import.";

  if (errors.length === 0) {
    if (published && allReviewed && emptyExplanationItems.length === 0) {
      readiness = "PUBLISH_READY";
      recommendation = "Ready for controlled publish.";
    } else if (
      items.every((item) => item.status === "draft") &&
      allReviewed
    ) {
      readiness = "REVIEWED_DRAFT_READY";
      recommendation = "Ready for remote draft import.";
    } else {
      readiness = "DRAFT_IMPORT_CANDIDATE";
      recommendation = "Safe for local draft import only.";
      if (needsReviewItems.length > 0 || reviewNoteItems.length > 0) {
        recommendation = "Needs human review before remote import.";
      }
    }
  }

  return {
    errors,
    warnings,
    emptyExplanationCount: emptyExplanationItems.length,
    needsReviewCount: needsReviewItems.length,
    reviewNotesCount: reviewNoteItems.length,
    readiness,
    recommendation,
    subjectSummary,
    batchSummary,
  };
}

function buildPathWarning(sourceFile) {
  const normalized = sourceFile.replace(/\\/g, "/").toLowerCase();
  const importerDir = IMPORTER_INPUT_DIRECTORY.replace(/\\/g, "/").toLowerCase();

  if (normalized.includes(`/${importerDir}/`) || normalized.startsWith(`${importerDir}/`)) {
    return null;
  }

  return `This file is structurally checked, but the existing importer will not discover it unless it is placed in ${IMPORTER_INPUT_DIRECTORY}/ or a separate import command is created.`;
}

function renderReport({ sourceFile, totalItems, result, pathWarning }) {
  const primarySubject = result.subjectSummary[0]?.key ?? "unknown";
  const primaryBatch = result.batchSummary[0]?.key ?? "unknown";
  const importerCompatibility =
    result.readiness === "BLOCKED"
      ? "Not compatible with the current importer."
      : "Compatible with the current importer.";

  return `# Import-Ready Compatibility Check

## Source File

- \`${sourceFile}\`

## Summary

- Total items: ${totalItems}
- Subject: ${primarySubject}
- Batch: ${primaryBatch}
- Readiness classification: ${result.readiness}
- Structurally exported batch exists: yes
- Current importer compatibility: ${importerCompatibility}

## Blocking Errors

${toBulletList(result.errors)}

## Warnings

${toBulletList(result.warnings)}

## Importer Path Warning

${toBulletList(pathWarning ? [pathWarning] : [])}

## Review Counts

- Empty explanation count: ${result.emptyExplanationCount}
- needs_review count: ${result.needsReviewCount}
- review_notes count: ${result.reviewNotesCount}

## Recommendation

- ${result.recommendation}
- Explanations must be filled before import through the current importer.
`;
}

async function main() {
  const args = parseCliArgs();
  const sourceFile = args.file;

  if (!sourceFile) {
    console.error('Missing required argument: --file "path/to/import-ready.json"');
    process.exitCode = 1;
    return;
  }

  const data = await readJsonFile(sourceFile);

  if (!Array.isArray(data)) {
    console.error("Import-ready check failed: JSON root must be an array.");
    process.exitCode = 1;
    return;
  }

  const result = checkImportReady(data);
  const pathWarning = buildPathWarning(sourceFile);
  if (pathWarning) {
    result.warnings.push(pathWarning);
  }
  const report = renderReport({
    sourceFile,
    totalItems: data.length,
    result,
    pathWarning,
  });

  const reportPath = await writeMarkdownReport({
    directory: REPORT_DIRECTORIES.reports,
    prefix: "check-import-ready",
    sourceFile,
    content: report,
  });

  console.log(`Import-ready check complete for ${path.basename(sourceFile)}`);
  console.log(`Items: ${data.length}`);
  console.log(`Readiness: ${result.readiness}`);
  console.log(`Blocking errors: ${result.errors.length}`);
  console.log(`Warnings: ${result.warnings.length}`);
  console.log(`Recommendation: ${result.recommendation}`);
  if (pathWarning) {
    console.log(`Path warning: ${pathWarning}`);
  }
  console.log(`Report: ${reportPath}`);

  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Import-ready check failed: ${error.message}`);
  process.exitCode = 1;
});
