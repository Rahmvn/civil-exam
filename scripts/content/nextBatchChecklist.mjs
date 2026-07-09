import path from "node:path";

import {
  REPORT_DIRECTORIES,
  SUBJECT_BATCH_SIZES,
} from "./contentRules.mjs";
import {
  parseCliArgs,
  toBulletList,
  writeMarkdownReport,
} from "./contentUtils.mjs";

function normalizeBatchNumber(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function createChecklist({ subjectSlug, batchNumber, expectedSize }) {
  const convertedSource = `contents/converted/${subjectSlug}.review.json`;
  const cleanedOutput = `contents/import-ready/${subjectSlug}.batch${batchNumber}.cleaned.json`;
  const subjectToken = subjectSlug.toUpperCase().replace(/-/g, "_");

  const reportNames = [
    `docs/${subjectToken}_BATCH${batchNumber}_PREPARATION_REPORT.md`,
    `docs/${subjectToken}_BATCH${batchNumber}_ANSWER_KEY_VERIFICATION.md`,
    `docs/LOCAL_${subjectToken}_BATCH${batchNumber}_IMPORT_TEST.md`,
    `docs/LOCAL_${subjectToken}_BATCH${batchNumber}_CANDIDATE_FLOW_TEST.md`,
    `docs/REMOTE_${subjectToken}_BATCH${batchNumber}_DRAFT_IMPORT.md`,
    `docs/REMOTE_${subjectToken}_BATCH${batchNumber}_PUBLISH_REPORT.md`,
  ];

  const commands = [
    `npm run content:build-batch -- --file "${convertedSource}" --subject ${subjectSlug} --batch ${batchNumber}`,
    `npm run content:export-import-ready -- --file "${convertedSource}" --subject ${subjectSlug} --batch ${batchNumber}`,
    `npm run content:check-import-ready -- --file "${cleanedOutput}"`,
    `npm run import:questions -- --file "${cleanedOutput}" --dry-run`,
    `npm run import:questions -- --file "${cleanedOutput}"`,
  ];

  const safetyGates = [
    "Confirm local Supabase URL before any local import.",
    "Confirm remote Supabase URL before any remote import.",
    "Never print the service role key.",
    "Run dry-run before actual import.",
    "Import as draft before any publish step.",
    "Stop if the selected batch count does not match the expected batch size unless the batch is intentionally undersized draft content.",
    "Do not publish without human approval.",
    "Archive old dev seeds instead of deleting them.",
  ];

  const stages = [
    "Stage A - prepare cleaned batch file",
    "Stage B - verify against the provided answer key",
    "Stage C - check importer compatibility",
    "Stage D - local draft import test",
    "Stage E - local candidate-flow simulation",
    "Stage F - remote draft import",
    "Stage G - controlled publish after approval",
  ];

  return {
    convertedSource,
    cleanedOutput,
    reportNames,
    commands,
    safetyGates,
    stages,
    expectedSize,
  };
}

function renderChecklistReport({ subjectSlug, batchNumber, checklist }) {
  return `# Batch Checklist

## Subject

- \`${subjectSlug}\`

## Batch

- ${batchNumber}

## Expected Size

- ${checklist.expectedSize}

## Converted Source File

- \`${checklist.convertedSource}\`

## Expected Cleaned Output File

- \`${checklist.cleanedOutput}\`

## Standard Lifecycle

${toBulletList(checklist.stages)}

## Commands To Run

${toBulletList(checklist.commands.map((command) => `\`${command}\``))}

## Expected Report Files

${toBulletList(checklist.reportNames.map((name) => `\`${name}\``))}

## Safety Gates

${toBulletList(checklist.safetyGates)}
`;
}

async function main() {
  const args = parseCliArgs();
  const subjectSlug = typeof args.subject === "string" ? args.subject.trim() : "";
  const batchNumber = normalizeBatchNumber(args.batch);

  if (!subjectSlug || batchNumber === null) {
    console.error('Missing required arguments: --subject subject-slug --batch 1');
    process.exitCode = 1;
    return;
  }

  const expectedSize = SUBJECT_BATCH_SIZES[subjectSlug];

  if (!expectedSize) {
    console.error(`Unknown subject slug: ${subjectSlug}`);
    process.exitCode = 1;
    return;
  }

  const checklist = createChecklist({ subjectSlug, batchNumber, expectedSize });
  const reportContent = renderChecklistReport({ subjectSlug, batchNumber, checklist });
  const reportPath = await writeMarkdownReport({
    directory: REPORT_DIRECTORIES.reports,
    prefix: `batch-checklist-${subjectSlug}-batch${batchNumber}`,
    sourceFile: path.basename(checklist.convertedSource),
    content: reportContent,
  });

  console.log(`Batch checklist ready for ${subjectSlug}`);
  console.log(`Batch: ${batchNumber}`);
  console.log(`Expected size: ${expectedSize}`);
  console.log(`Converted source: ${checklist.convertedSource}`);
  console.log(`Expected cleaned output: ${checklist.cleanedOutput}`);
  console.log("Commands:");
  for (const command of checklist.commands) {
    console.log(`- ${command}`);
  }
  console.log("Safety gates:");
  for (const gate of checklist.safetyGates) {
    console.log(`- ${gate}`);
  }
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(`Batch checklist failed: ${error.message}`);
  process.exitCode = 1;
});
