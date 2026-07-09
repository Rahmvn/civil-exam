import { SUBJECT_BATCH_SIZES } from "./contentRules.mjs";
import {
  findDuplicateNumbers,
  findMissingSequentialNumbers,
} from "./contentUtils.mjs";
import { validateItems } from "./validateContent.mjs";

export function buildBatchAnalysis(items, subjectSlug, batchNumber) {
  const selectedItems = items.filter(
    (item) => item.subject_slug === subjectSlug && item.batch_number === batchNumber,
  );

  const expectedBatchSize = SUBJECT_BATCH_SIZES[subjectSlug] ?? null;
  const validation = validateItems(selectedItems);
  const positions = selectedItems
    .map((item) => item.batch_position)
    .filter((value) => value != null)
    .sort((left, right) => left - right);

  const sourceNumbers = selectedItems
    .map((item) => item.source_number)
    .filter((value) => value != null)
    .sort((left, right) => left - right);

  const duplicatePositions = findDuplicateNumbers(positions);
  const missingPositions = findMissingSequentialNumbers(positions);
  const wrongSubjectItems = selectedItems
    .filter((item) => item.subject_slug !== subjectSlug)
    .map((item) => item.source_number ?? "?");
  const wrongBatchItems = selectedItems
    .filter((item) => item.batch_number !== batchNumber)
    .map((item) => item.source_number ?? "?");
  const emptyExplanationItems = selectedItems
    .filter((item) => !item.explanation || !String(item.explanation).trim())
    .map((item) => item.batch_position ?? item.source_number ?? "?");
  const needsReviewItems = selectedItems
    .filter((item) => item.needs_review === true)
    .map((item) => item.batch_position ?? item.source_number ?? "?");
  const reviewNoteItems = selectedItems
    .filter((item) => Array.isArray(item.review_notes) && item.review_notes.length > 0)
    .map((item) => ({
      position: item.batch_position ?? item.source_number ?? "?",
      count: item.review_notes.length,
    }));

  const errors = [...validation.errors];
  const warnings = [...validation.warnings];

  if (duplicatePositions.length) {
    errors.push(`Duplicate batch_position values detected (${duplicatePositions.join(", ")}).`);
  }

  if (missingPositions.length) {
    errors.push(`Missing batch_position values detected (${missingPositions.join(", ")}).`);
  }

  if (wrongSubjectItems.length) {
    errors.push(`Selected items include wrong subject_slug values at source numbers ${wrongSubjectItems.join(", ")}.`);
  }

  if (wrongBatchItems.length) {
    errors.push(`Selected items include wrong batch_number values at source numbers ${wrongBatchItems.join(", ")}.`);
  }

  let batchState = "unknown";
  if (expectedBatchSize == null) {
    batchState = "unknown";
  } else if (selectedItems.length === expectedBatchSize) {
    batchState = "full";
  } else if (selectedItems.length < expectedBatchSize) {
    batchState = "undersized";
  } else {
    batchState = "oversized";
  }

  let recommendation = "not ready";
  if (errors.length === 0 && warnings.length > 0) {
    recommendation = "structurally ready but needs review";
  }
  if (errors.length === 0 && warnings.length === 0 && selectedItems.length > 0) {
    recommendation = "import-ready candidate";
  }

  return {
    selectedItems,
    subjectSlug,
    batchNumber,
    expectedBatchSize,
    actualCount: selectedItems.length,
    batchState,
    sourceRange:
      sourceNumbers.length > 0
        ? `${sourceNumbers[0]}-${sourceNumbers[sourceNumbers.length - 1]}`
        : "none",
    duplicatePositions,
    missingPositions,
    emptyExplanationItems,
    needsReviewItems,
    reviewNoteItems,
    errors,
    warnings,
    recommendation,
  };
}
