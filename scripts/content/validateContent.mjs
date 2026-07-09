import path from "node:path";

import {
  OBJECTIVE_REQUIRED_FIELDS,
  ORAL_FORBIDDEN_FIELDS,
  ORAL_REQUIRED_FIELDS,
  REPORT_DIRECTORIES,
  SUBJECT_BATCH_SIZES,
  VALID_CORRECT_OPTIONS,
  VALID_STATUSES,
} from "./contentRules.mjs";
import {
  hasValue,
  normalizeText,
  parseCliArgs,
  readJsonFile,
  summarizeCounts,
  toBulletList,
  writeMarkdownReport,
} from "./contentUtils.mjs";

function detectContentType(items) {
  const firstItem = items[0] || {};

  if (
    "resource_type" in firstItem ||
    "prompt" in firstItem ||
    "model_answer" in firstItem
  ) {
    return "oral";
  }

  return "objective";
}

function isOverflowItem(item) {
  return item.batch_number == null && item.batch_position == null;
}

function validateObjective(items) {
  const errors = [];
  const warnings = [];
  const sourceNumberMap = new Map();
  const questionTextMap = new Map();
  const groupedBatchPositions = new Map();

  items.forEach((item, index) => {
    const label = `Item ${index + 1}`;

    for (const field of OBJECTIVE_REQUIRED_FIELDS) {
      if (!hasValue(item[field]) && item[field] !== null) {
        errors.push(`${label}: missing ${field}.`);
      }
    }

    if (!VALID_CORRECT_OPTIONS.has(item.correct_option)) {
      errors.push(`${label}: correct_option must be A, B, C, D, or null.`);
    }

    const overflow = isOverflowItem(item);

    if (!overflow) {
      if (item.batch_number == null) {
        errors.push(`${label}: missing batch_number for non-overflow item.`);
      }

      if (item.batch_position == null) {
        errors.push(`${label}: missing batch_position for non-overflow item.`);
      }
    }

    if (!hasValue(item.source_note)) {
      warnings.push(`${label}: source_note is empty.`);
    }

    if (!hasValue(item.explanation)) {
      warnings.push(`${label}: explanation is empty.`);
    }

    if (item.needs_review === true) {
      warnings.push(`${label}: needs_review is true.`);
    }

    if (Array.isArray(item.review_notes) && item.review_notes.length > 0) {
      warnings.push(`${label}: review_notes present (${item.review_notes.length}).`);
    }

    if (!VALID_STATUSES.has(item.status)) {
      warnings.push(`${label}: status "${item.status}" is outside draft/published/archived.`);
    }

    const optionValues = [
      item.option_a,
      item.option_b,
      item.option_c,
      item.option_d,
    ]
      .map((value) => normalizeText(value))
      .filter(Boolean);

    if (new Set(optionValues).size !== optionValues.length) {
      warnings.push(`${label}: duplicated option text detected.`);
    }

    if (hasValue(item.source_number)) {
      const seen = sourceNumberMap.get(item.source_number) || [];
      seen.push(index + 1);
      sourceNumberMap.set(item.source_number, seen);
    }

    if (hasValue(item.question_text)) {
      const normalizedQuestion = normalizeText(item.question_text);
      const seen = questionTextMap.get(normalizedQuestion) || [];
      seen.push(index + 1);
      questionTextMap.set(normalizedQuestion, seen);
    }

    if (!overflow && hasValue(item.batch_number) && hasValue(item.batch_position)) {
      const key = `${item.subject_slug || "unknown"}::${item.batch_number}`;
      const positions = groupedBatchPositions.get(key) || [];
      positions.push(item.batch_position);
      groupedBatchPositions.set(key, positions);
    }
  });

  for (const [sourceNumber, positions] of sourceNumberMap.entries()) {
    if (positions.length > 1) {
      warnings.push(
        `Duplicate source_number ${sourceNumber} found at items ${positions.join(", ")}.`,
      );
    }
  }

  for (const [, positions] of questionTextMap.entries()) {
    if (positions.length > 1) {
      warnings.push(`Duplicate question_text detected at items ${positions.join(", ")}.`);
    }
  }

  for (const [groupKey, positions] of groupedBatchPositions.entries()) {
    const sorted = [...positions].sort((left, right) => left - right);
    const missing = [];

    for (let expected = sorted[0]; expected <= sorted[sorted.length - 1]; expected += 1) {
      if (!sorted.includes(expected)) {
        missing.push(expected);
      }
    }

    if (missing.length) {
      warnings.push(`${groupKey}: batch_position gaps detected (${missing.join(", ")}).`);
    }
  }

  const subjectSummary = summarizeCounts(items, (item) => item.subject_slug || "missing");
  const batchSummary = summarizeCounts(
    items.filter((item) => item.batch_number != null),
    (item) => `${item.subject_slug || "missing"} batch ${item.batch_number}`,
  );

  return {
    type: "objective",
    errors,
    warnings,
    subjectSummary,
    batchSummary,
  };
}

function validateOral(items) {
  const errors = [];
  const warnings = [];
  const promptMap = new Map();

  items.forEach((item, index) => {
    const label = `Item ${index + 1}`;

    for (const field of ORAL_REQUIRED_FIELDS) {
      if (!hasValue(item[field])) {
        errors.push(`${label}: missing ${field}.`);
      }
    }

    if (item.resource_type !== "oral_prep") {
      errors.push(`${label}: resource_type must be oral_prep.`);
    }

    for (const field of ORAL_FORBIDDEN_FIELDS) {
      if (field in item) {
        errors.push(`${label}: oral item contains forbidden CBT field ${field}.`);
      }
    }

    if (!hasValue(item.key_points)) {
      warnings.push(`${label}: key_points is empty.`);
    }

    if (item.needs_review === true) {
      warnings.push(`${label}: needs_review is true.`);
    }

    if (Array.isArray(item.review_notes) && item.review_notes.length > 0) {
      warnings.push(`${label}: review_notes present (${item.review_notes.length}).`);
    }

    if (!VALID_STATUSES.has(item.status)) {
      warnings.push(`${label}: status "${item.status}" is outside draft/published/archived.`);
    }

    if (hasValue(item.prompt)) {
      const normalizedPrompt = normalizeText(item.prompt);
      const seen = promptMap.get(normalizedPrompt) || [];
      seen.push(index + 1);
      promptMap.set(normalizedPrompt, seen);
    }
  });

  for (const [, positions] of promptMap.entries()) {
    if (positions.length > 1) {
      warnings.push(`Duplicate prompt detected at items ${positions.join(", ")}.`);
    }
  }

  const audienceSummary = summarizeCounts(items, (item) => item.audience || "missing");

  return {
    type: "oral",
    errors,
    warnings,
    subjectSummary: audienceSummary,
    batchSummary: [],
  };
}

function renderReport({ sourceFile, validation }) {
  return `# Content Validation Report

## Source File

- \`${sourceFile}\`

## Detected Content Type

- ${validation.type}

## Blocking Errors

${toBulletList(validation.errors)}

## Warnings

${toBulletList(validation.warnings)}

## Summary Counts

${toBulletList(
  validation.subjectSummary.map(
    (entry) => `${entry.key}: ${entry.count} item${entry.count === 1 ? "" : "s"}`,
  ),
)}

## Batch Summary

${toBulletList(
  validation.batchSummary.map(
    (entry) => `${entry.key}: ${entry.count} item${entry.count === 1 ? "" : "s"}`,
  ),
)}

## Batch Rules Reference

${toBulletList(
  Object.entries(SUBJECT_BATCH_SIZES).map(
    ([subject, size]) => `${subject}: ${size} questions per batch`,
  ),
)}
`;
}

async function main() {
  const args = parseCliArgs();
  const sourceFile = args.file;

  if (!sourceFile) {
    console.error('Missing required argument: --file "path/to/file.json"');
    process.exitCode = 1;
    return;
  }

  const data = await readJsonFile(sourceFile);

  if (!Array.isArray(data)) {
    console.error("Validation failed: JSON root must be an array.");
    process.exitCode = 1;
    return;
  }

  const type = detectContentType(data);
  const validation =
    type === "oral" ? validateOral(data) : validateObjective(data);

  const report = renderReport({
    sourceFile,
    validation,
  });

  const reportPath = await writeMarkdownReport({
    directory: REPORT_DIRECTORIES.reports,
    prefix: "validation",
    sourceFile,
    content: report,
  });

  console.log(`Validation complete for ${path.basename(sourceFile)}`);
  console.log(`Detected type: ${validation.type}`);
  console.log(`Items: ${data.length}`);
  console.log(`Blocking errors: ${validation.errors.length}`);
  console.log(`Warnings: ${validation.warnings.length}`);
  console.log(`Report: ${reportPath}`);

  if (validation.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Validation failed: ${error.message}`);
  process.exitCode = 1;
});
