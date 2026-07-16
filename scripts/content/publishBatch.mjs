import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

import {
  ACTIVE_SUBJECT_SLUGS,
  DEV_SEED_SOURCE_MARKERS,
  REPORT_DIRECTORIES,
  SUBJECT_BATCH_SIZES,
} from "./contentRules.mjs";
import {
  createTimestamp,
  normalizeText,
  parseCliArgs,
  toBulletList,
  writeMarkdownReport,
} from "./contentUtils.mjs";

function hasDevSeedSource(sourceNote) {
  const normalized = normalizeText(sourceNote);
  return DEV_SEED_SOURCE_MARKERS.some((marker) => normalized.includes(normalizeText(marker)));
}

function collectDuplicateQuestionTexts(rows) {
  const seen = new Map();
  const duplicates = [];

  for (const row of rows) {
    const normalized = normalizeText(row.question_text);
    if (!normalized) {
      continue;
    }

    const matches = seen.get(normalized) ?? [];
    matches.push(row);
    seen.set(normalized, matches);
  }

  for (const matches of seen.values()) {
    if (matches.length > 1) {
      duplicates.push({
        questionText: matches[0].question_text,
        count: matches.length,
      });
    }
  }

  return duplicates;
}

function buildReport({
  targetUrl,
  subjectSlug,
  batchNumber,
  sourceNote,
  mode,
  archiveDevSeeds,
  state,
  checksPassed,
  errors,
  preview,
  changed,
  postPublish = null,
}) {
  return `# Batch Publish Report

## Target

- Supabase URL: \`${targetUrl}\`
- Subject: \`${subjectSlug}\`
- Batch: \`${batchNumber}\`
- Source note: \`${sourceNote}\`
- Mode: \`${mode}\`
- Archive dev seeds requested: \`${archiveDevSeeds ? "yes" : "no"}\`
- State: \`${state}\`

## Safety Check Result

- Checks passed: \`${checksPassed ? "yes" : "no"}\`

## Blocking Errors

${toBulletList(errors)}

## Preview Counts

- Reviewed draft count: ${preview.reviewedDraftCount}
- Reviewed published count before: ${preview.reviewedPublishedCount}
- Empty explanation count: ${preview.emptyExplanationCount}
- Duplicate reviewed question-text count: ${preview.duplicateCount}
- Dev seed published count: ${preview.devSeedPublishedCount}
- Expected batch size: ${preview.expectedBatchSize}

## Preview Status Summary

${toBulletList(
    Object.entries(preview.summary).map(([key, count]) => `${key} = ${count}`),
  )}

## Rows Changed

- Rows published: ${changed.rowsPublished}
- Dev seed rows archived: ${changed.devSeedRowsArchived}
- Anything changed: \`${changed.anythingChanged ? "yes" : "no"}\`

## Post-Publish Counts

${postPublish
    ? `- Reviewed published count: ${postPublish.reviewedPublishedCount}
- Reviewed draft count: ${postPublish.reviewedDraftCount}
- Dev seed published count: ${postPublish.devSeedPublishedCount}
- Dev seed archived count: ${postPublish.devSeedArchivedCount}
- Candidate-visible published count: ${postPublish.candidateVisiblePublishedCount}

### Post-Publish Status Summary

${toBulletList(
        Object.entries(postPublish.summary).map(([key, count]) => `${key} = ${count}`),
      )}`
    : "- Not applicable in dry-run mode."}

## Outcome

- ${state === "ALREADY_PUBLISHED"
    ? "Batch was already published before this run. No action needed."
    : changed.anythingChanged
      ? "Publish changes were applied."
      : "No database changes were applied."}
`;
}

function summarize(rows) {
  const map = new Map();

  for (const row of rows) {
    const key = `${row.status} | ${row.source_note}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  return Object.fromEntries([...map.entries()].sort((left, right) => left[0].localeCompare(right[0])));
}

async function loadBatchRows(admin, subjectId, batchNumber) {
  const { data, error } = await admin
    .from("questions")
    .select("id, question_text, status, source_note, batch_number, explanation")
    .eq("subject_id", subjectId)
    .eq("batch_number", batchNumber);

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function main() {
  const args = parseCliArgs();
  const subjectSlug = String(args.subject || "").trim();
  const batchNumber = Number(args.batch);
  const sourceNote = String(args["source-note"] || "").trim();
  const isDryRun = Boolean(args["dry-run"]);
  const isConfirm = Boolean(args.confirm);
  const archiveDevSeeds = Boolean(args["archive-dev-seeds"]);
  const targetUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!isDryRun && !isConfirm) {
    console.error("Refusing to run: pass either --dry-run or --confirm.");
    process.exitCode = 1;
    return;
  }

  if (isDryRun && isConfirm) {
    console.error("Refusing to run: choose only one mode, --dry-run or --confirm.");
    process.exitCode = 1;
    return;
  }

  if (!targetUrl || !serviceRoleKey) {
    console.error("Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    process.exitCode = 1;
    return;
  }

  if (!ACTIVE_SUBJECT_SLUGS.has(subjectSlug)) {
    console.error(`Invalid subject: ${subjectSlug || "(missing)"}.`);
    process.exitCode = 1;
    return;
  }

  if (!Number.isInteger(batchNumber) || batchNumber < 1) {
    console.error(`Invalid batch number: ${args.batch ?? "(missing)"}.`);
    process.exitCode = 1;
    return;
  }

  if (!sourceNote) {
    console.error("Missing required argument: --source-note.");
    process.exitCode = 1;
    return;
  }

  const admin = createClient(targetUrl, serviceRoleKey, {
    auth: { persistSession: false },
    realtime: { transport: WebSocket },
  });

  console.log(`Target Supabase URL: ${targetUrl}`);
  console.log(`Mode: ${isDryRun ? "dry-run" : "confirm"}`);
  console.log(`Subject: ${subjectSlug}`);
  console.log(`Batch: ${batchNumber}`);

  const { data: subject, error: subjectError } = await admin
    .from("subjects")
    .select("id, slug, name, is_active")
    .eq("slug", subjectSlug)
    .maybeSingle();

  if (subjectError) {
    throw subjectError;
  }

  if (!subject) {
    throw new Error(`Subject not found: ${subjectSlug}`);
  }

  const batchRows = await loadBatchRows(admin, subject.id, batchNumber);
  const reviewedDraftRows = batchRows.filter(
    (row) => row.status === "draft" && row.source_note === sourceNote,
  );
  const reviewedPublishedRows = batchRows.filter(
    (row) => row.status === "published" && row.source_note === sourceNote,
  );
  const duplicateReviewedRows = collectDuplicateQuestionTexts([
    ...reviewedDraftRows,
    ...reviewedPublishedRows,
  ]);
  const emptyExplanationCount = reviewedDraftRows.filter(
    (row) => !String(row.explanation ?? "").trim(),
  ).length;
  const devSeedPublishedRows = batchRows.filter(
    (row) => row.status === "published" && hasDevSeedSource(row.source_note),
  );
  const expectedBatchSize = SUBJECT_BATCH_SIZES[subjectSlug];
  const errors = [];
  const alreadyPublished =
    reviewedDraftRows.length === 0 &&
    reviewedPublishedRows.length === expectedBatchSize &&
    devSeedPublishedRows.length === 0 &&
    duplicateReviewedRows.length === 0;
  const state = alreadyPublished ? "ALREADY_PUBLISHED" : "READY_OR_BLOCKED";

  if (!subject.is_active) {
    errors.push(`Subject ${subjectSlug} is not active.`);
  }

  if (!alreadyPublished && reviewedDraftRows.length !== expectedBatchSize) {
    errors.push(
      `Reviewed draft row count ${reviewedDraftRows.length} does not match expected batch size ${expectedBatchSize}.`,
    );
  }

  if (!alreadyPublished && reviewedPublishedRows.length !== 0) {
    errors.push(`Reviewed rows already published: ${reviewedPublishedRows.length}.`);
  }

  if (duplicateReviewedRows.length !== 0) {
    errors.push(`Duplicate reviewed question_text groups detected: ${duplicateReviewedRows.length}.`);
  }

  const preview = {
    reviewedDraftCount: reviewedDraftRows.length,
    reviewedPublishedCount: reviewedPublishedRows.length,
    emptyExplanationCount,
    duplicateCount: duplicateReviewedRows.length,
    devSeedPublishedCount: devSeedPublishedRows.length,
    expectedBatchSize,
    summary: summarize(batchRows),
  };

  const changed = {
    rowsPublished: 0,
    devSeedRowsArchived: 0,
    anythingChanged: false,
  };

  let postPublish = null;

  if (errors.length === 0 && isConfirm && !alreadyPublished) {
    const reviewedIds = reviewedDraftRows.map((row) => row.id);
    const { data: publishedRows, error: publishError } = await admin
      .from("questions")
      .update({ status: "published" })
      .in("id", reviewedIds)
      .select("id");

    if (publishError) {
      throw publishError;
    }

    changed.rowsPublished = publishedRows?.length ?? 0;

    if (archiveDevSeeds && devSeedPublishedRows.length > 0) {
      const devSeedIds = devSeedPublishedRows.map((row) => row.id);
      const { data: archivedRows, error: archiveError } = await admin
        .from("questions")
        .update({ status: "archived" })
        .in("id", devSeedIds)
        .select("id");

      if (archiveError) {
        throw archiveError;
      }

      changed.devSeedRowsArchived = archivedRows?.length ?? 0;
    }

    changed.anythingChanged = changed.rowsPublished > 0 || changed.devSeedRowsArchived > 0;

    const postRows = await loadBatchRows(admin, subject.id, batchNumber);
    const reviewedPublishedAfter = postRows.filter(
      (row) => row.status === "published" && row.source_note === sourceNote,
    );
    const reviewedDraftAfter = postRows.filter(
      (row) => row.status === "draft" && row.source_note === sourceNote,
    );
    const devSeedPublishedAfter = postRows.filter(
      (row) => row.status === "published" && hasDevSeedSource(row.source_note),
    );
    const devSeedArchivedAfter = postRows.filter(
      (row) => row.status === "archived" && hasDevSeedSource(row.source_note),
    );

    postPublish = {
      reviewedPublishedCount: reviewedPublishedAfter.length,
      reviewedDraftCount: reviewedDraftAfter.length,
      devSeedPublishedCount: devSeedPublishedAfter.length,
      devSeedArchivedCount: devSeedArchivedAfter.length,
      candidateVisiblePublishedCount: postRows.filter((row) => row.status === "published").length,
      summary: summarize(postRows),
    };
  }

  const report = buildReport({
    targetUrl,
    subjectSlug,
    batchNumber,
    sourceNote,
    mode: isDryRun ? "dry-run" : "confirm",
    archiveDevSeeds,
    state,
    checksPassed: errors.length === 0,
    errors,
    preview,
    changed,
    postPublish,
  });

  const reportPath = await writeMarkdownReport({
    directory: REPORT_DIRECTORIES.reports,
    prefix: "publish-batch",
    sourceFile: `${subjectSlug}-batch${batchNumber}-${createTimestamp()}`,
    content: report,
  });

  console.log(`Reviewed draft rows: ${preview.reviewedDraftCount}`);
  console.log(`Reviewed published rows before: ${preview.reviewedPublishedCount}`);
  console.log(`Dev seed published rows: ${preview.devSeedPublishedCount}`);
  console.log(`Empty explanations: ${preview.emptyExplanationCount}`);
  console.log(`Duplicate reviewed question-text groups: ${preview.duplicateCount}`);
  console.log(`Report: ${path.relative(process.cwd(), reportPath)}`);

  if (errors.length > 0) {
    console.error("Publish checks failed.");
    process.exitCode = 1;
    return;
  }

  if (alreadyPublished) {
    console.log("Batch state: ALREADY_PUBLISHED");
    console.log("This batch is already published. No action needed.");
    if (isConfirm) {
      console.log("Confirm mode refused to republish an already-published batch.");
    } else {
      console.log("Dry-run complete. No database changes were applied.");
    }
    return;
  }

  if (isDryRun) {
    console.log("Dry-run complete. No database changes were applied.");
    return;
  }

  console.log(`Rows published: ${changed.rowsPublished}`);
  console.log(`Dev seed rows archived: ${changed.devSeedRowsArchived}`);
  console.log("Publish complete.");
}

main().catch((error) => {
  console.error(`Batch publish failed: ${error.message}`);
  process.exitCode = 1;
});
