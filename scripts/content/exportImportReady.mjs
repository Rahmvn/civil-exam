import path from "node:path";

import {
  IMPORT_READY_DIRECTORY,
  REPORT_DIRECTORIES,
} from "./contentRules.mjs";
import {
  parseCliArgs,
  readJsonFile,
  toBulletList,
  writeJsonFile,
  writeMarkdownReport,
} from "./contentUtils.mjs";
import { detectContentType } from "./validateContent.mjs";
import { buildBatchAnalysis } from "./internalBatchAnalysis.mjs";

function prepareExportItems(items) {
  return items.map((item) => ({
    ...item,
    status: "draft",
    source_note:
      item.source_note === "provided_client_content_pending_review"
        ? "provided_client_content_reviewed_draft"
        : item.source_note,
  }));
}

function renderExportReport({
  sourceFile,
  subjectSlug,
  batchNumber,
  outputFile,
  analysis,
  exported,
}) {
  return `# Import-Ready Export Report

## Source File

- \`${sourceFile}\`

## Export Request

- Subject: \`${subjectSlug}\`
- Batch: ${batchNumber}

## Export Decision

- Exported: ${exported ? "yes" : "no"}
- Output file: \`${outputFile}\`

## Blocking Errors

${toBulletList(analysis.errors)}

## Warnings

${toBulletList(analysis.warnings)}

## Batch Summary

- Selected item count: ${analysis.actualCount}
- Batch state: ${analysis.batchState}
- Empty explanation count: ${analysis.emptyExplanationItems.length}
- Needs review count: ${analysis.needsReviewItems.length}

## Recommendation

- ${analysis.recommendation}
`;
}

async function main() {
  const args = parseCliArgs();
  const sourceFile = args.file;
  const subjectSlug = args.subject;
  const batchNumber = Number.parseInt(args.batch, 10);

  if (!sourceFile || !subjectSlug || Number.isNaN(batchNumber)) {
    console.error(
      'Missing required arguments: --file "path/to/review.json" --subject subject-slug --batch 1',
    );
    process.exitCode = 1;
    return;
  }

  const data = await readJsonFile(sourceFile);

  if (!Array.isArray(data)) {
    console.error("Export failed: JSON root must be an array.");
    process.exitCode = 1;
    return;
  }

  if (detectContentType(data) === "oral") {
    console.error("Export failed: oral prep content cannot be exported as CBT import-ready JSON.");
    process.exitCode = 1;
    return;
  }

  const analysis = buildBatchAnalysis(data, subjectSlug, batchNumber);
  const outputFile = path.join(
    IMPORT_READY_DIRECTORY,
    `${subjectSlug}.batch${batchNumber}.json`,
  );

  let exported = false;

  if (analysis.actualCount === 0) {
    analysis.errors.push("Selected item count is 0.");
  }

  if (analysis.errors.length === 0) {
    const exportItems = prepareExportItems(analysis.selectedItems);
    await writeJsonFile(outputFile, exportItems);
    exported = true;
  }

  const report = renderExportReport({
    sourceFile,
    subjectSlug,
    batchNumber,
    outputFile,
    analysis,
    exported,
  });

  const reportPath = await writeMarkdownReport({
    directory: REPORT_DIRECTORIES.reports,
    prefix: `export-import-ready-${subjectSlug}-batch${batchNumber}`,
    sourceFile,
    content: report,
  });

  console.log(`Import-ready export complete for ${path.basename(sourceFile)}`);
  console.log(`Subject: ${subjectSlug}`);
  console.log(`Batch: ${batchNumber}`);
  console.log(`Selected items: ${analysis.actualCount}`);
  console.log(`Exported: ${exported ? "yes" : "no"}`);
  console.log(`Blocking errors: ${analysis.errors.length}`);
  console.log(`Warnings: ${analysis.warnings.length}`);
  console.log(`Output: ${outputFile}`);
  console.log(`Report: ${reportPath}`);

  if (!exported) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Export failed: ${error.message}`);
  process.exitCode = 1;
});
