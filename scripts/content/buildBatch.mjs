import path from "node:path";

import { REPORT_DIRECTORIES } from "./contentRules.mjs";
import {
  parseCliArgs,
  readJsonFile,
  toBulletList,
  writeMarkdownReport,
} from "./contentUtils.mjs";
import { detectContentType } from "./validateContent.mjs";
import { buildBatchAnalysis } from "./internalBatchAnalysis.mjs";

function renderBatchReport({ sourceFile, analysis }) {
  return `# Batch Build Report

## Source File

- \`${sourceFile}\`

## Batch Request

- Subject: \`${analysis.subjectSlug}\`
- Batch: ${analysis.batchNumber}

## Batch Size Summary

- Expected batch size: ${analysis.expectedBatchSize ?? "unknown"}
- Actual selected item count: ${analysis.actualCount}
- Batch state: ${analysis.batchState}
- Source number range: ${analysis.sourceRange}

## Blocking Errors

${toBulletList(analysis.errors)}

## Warnings

${toBulletList(analysis.warnings)}

## Questions Needing Review

${toBulletList(
  analysis.needsReviewItems.map((item) => `Position ${item}`),
)}

## Empty Explanation Count

- ${analysis.emptyExplanationItems.length}

## Review Note Flags

${toBulletList(
  analysis.reviewNoteItems.map(
    (item) => `Position ${item.position}: ${item.count} review note${item.count === 1 ? "" : "s"}`,
  ),
)}

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
    console.error("Batch build failed: JSON root must be an array.");
    process.exitCode = 1;
    return;
  }

  if (detectContentType(data) === "oral") {
    console.error("Batch build failed: oral prep content cannot be built as a CBT batch.");
    process.exitCode = 1;
    return;
  }

  const analysis = buildBatchAnalysis(data, subjectSlug, batchNumber);
  const report = renderBatchReport({ sourceFile, analysis });

  const reportPath = await writeMarkdownReport({
    directory: REPORT_DIRECTORIES.reports,
    prefix: `batch-build-${subjectSlug}-batch${batchNumber}`,
    sourceFile,
    content: report,
  });

  console.log(`Batch build analysis complete for ${path.basename(sourceFile)}`);
  console.log(`Subject: ${subjectSlug}`);
  console.log(`Batch: ${batchNumber}`);
  console.log(`Selected items: ${analysis.actualCount}`);
  console.log(`Batch state: ${analysis.batchState}`);
  console.log(`Blocking errors: ${analysis.errors.length}`);
  console.log(`Warnings: ${analysis.warnings.length}`);
  console.log(`Recommendation: ${analysis.recommendation}`);
  console.log(`Report: ${reportPath}`);

  if (analysis.actualCount === 0 || analysis.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Batch build failed: ${error.message}`);
  process.exitCode = 1;
});
