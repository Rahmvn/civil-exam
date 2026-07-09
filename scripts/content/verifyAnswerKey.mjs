import path from "node:path";

import { REPORT_DIRECTORIES } from "./contentRules.mjs";
import {
  addUniqueNote,
  parseCliArgs,
  readJsonFile,
  toBulletList,
  writeJsonFile,
  writeMarkdownReport,
} from "./contentUtils.mjs";

const MATCH_NOTE =
  "Matches provided answer key; official/source verification still recommended before publishing.";

function createMismatchNote(cleanedOption, convertedOption) {
  return `Mismatch with provided answer key: cleaned has ${cleanedOption}, converted answer key has ${convertedOption}. Human review required.`;
}

const MISSING_MATCH_NOTE = "No matching converted answer-key item found. Human review required.";

function buildConvertedLookup(items) {
  const lookup = new Map();

  for (const item of items) {
    const key = `${item.subject_slug}::${item.source_number}`;
    if (!lookup.has(key)) {
      lookup.set(key, item);
    }
  }

  return lookup;
}

function renderReport({
  cleanedFile,
  convertedFile,
  totalChecked,
  matchedCount,
  answerMatchCount,
  mismatchCount,
  missingConvertedItemCount,
  mismatches,
  missingMatches,
}) {
  return `# Answer Key Verification Report

## Cleaned File

- \`${cleanedFile}\`

## Converted File

- \`${convertedFile}\`

## Summary

- Total cleaned items checked: ${totalChecked}
- Matched converted items: ${matchedCount}
- Answer matches: ${answerMatchCount}
- Mismatches: ${mismatchCount}
- Missing converted items: ${missingConvertedItemCount}

## Mismatches

${toBulletList(
    mismatches.map(
      (item) =>
        `Source ${item.source_number} (${item.subject_slug}): cleaned=${item.cleaned_option}, converted=${item.converted_option}`,
    ),
  )}

## Missing Converted Items

${toBulletList(
    missingMatches.map(
      (item) => `Source ${item.source_number} (${item.subject_slug})`,
    ),
  )}

## Verification Note

- This script verifies answer-key alignment only.
- It does not prove official legal or source correctness.
- It does not grant publish approval.
`;
}

async function main() {
  const args = parseCliArgs();
  const cleanedFile = args.cleaned;
  const convertedFile = args.converted;

  if (!cleanedFile || !convertedFile) {
    console.error(
      'Missing required arguments: --cleaned "path/to/cleaned.json" --converted "path/to/review.json"',
    );
    process.exitCode = 1;
    return;
  }

  const cleanedItems = await readJsonFile(cleanedFile);
  const convertedItems = await readJsonFile(convertedFile);

  if (!Array.isArray(cleanedItems) || !Array.isArray(convertedItems)) {
    console.error("Answer-key verification failed: both JSON roots must be arrays.");
    process.exitCode = 1;
    return;
  }

  const convertedLookup = buildConvertedLookup(convertedItems);
  const mismatches = [];
  const missingMatches = [];
  let matchedCount = 0;
  let answerMatchCount = 0;

  const updatedItems = cleanedItems.map((item) => {
    const key = `${item.subject_slug}::${item.source_number}`;
    const convertedItem = convertedLookup.get(key);
    const nextItem = {
      ...item,
      needs_review: true,
    };

    if (!convertedItem) {
      nextItem.review_notes = addUniqueNote(item.review_notes, MISSING_MATCH_NOTE);
      missingMatches.push({
        subject_slug: item.subject_slug,
        source_number: item.source_number,
      });
      return nextItem;
    }

    matchedCount += 1;

    if (item.correct_option === convertedItem.correct_option) {
      nextItem.review_notes = addUniqueNote(item.review_notes, MATCH_NOTE);
      answerMatchCount += 1;
      return nextItem;
    }

    const mismatchNote = createMismatchNote(item.correct_option, convertedItem.correct_option);
    nextItem.review_notes = addUniqueNote(item.review_notes, mismatchNote);
    mismatches.push({
      subject_slug: item.subject_slug,
      source_number: item.source_number,
      cleaned_option: item.correct_option,
      converted_option: convertedItem.correct_option,
    });
    return nextItem;
  });

  await writeJsonFile(cleanedFile, updatedItems);

  const report = renderReport({
    cleanedFile,
    convertedFile,
    totalChecked: cleanedItems.length,
    matchedCount,
    answerMatchCount,
    mismatchCount: mismatches.length,
    missingConvertedItemCount: missingMatches.length,
    mismatches,
    missingMatches,
  });

  const reportPath = await writeMarkdownReport({
    directory: REPORT_DIRECTORIES.reports,
    prefix: "answer-key-verification",
    sourceFile: path.basename(cleanedFile),
    content: report,
  });

  console.log(`Answer-key verification complete for ${path.basename(cleanedFile)}`);
  console.log(`Total checked: ${cleanedItems.length}`);
  console.log(`Matched converted items: ${matchedCount}`);
  console.log(`Answer matches: ${answerMatchCount}`);
  console.log(`Mismatches: ${mismatches.length}`);
  console.log(`Missing converted items: ${missingMatches.length}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(`Answer-key verification failed: ${error.message}`);
  process.exitCode = 1;
});
