# Importer Alignment Report

> Policy update, July 16, 2026: objective explanations and references are now optional. Findings below that described empty explanations as blocking have been updated; file-path findings remain applicable.

## 1. Purpose

This report compares the current local content-pipeline import-readiness rules against the actual behavior of the existing question importer.

Files inspected:

- `scripts/importQuestions.mjs`
- `scripts/content/checkImportReady.mjs`
- `scripts/content/contentRules.mjs`
- `contents/import-ready/public-financial-management.batch1.json`

This is an inspection-only report.

No import was run.
No Supabase write was performed.

---

## 2. Existing Importer Input Paths

The current importer does **not** read from `contents/import-ready/`.

It reads only from:

- `content/questions/`

Specifically:

- `const contentDir = path.join(projectRoot, "content", "questions");`

Implication:

- `contents/import-ready/public-financial-management.batch1.json` is not discoverable by the importer in its current location.
- Even if the JSON shape were valid, the importer would not consume it unless:
  - the file is copied/moved into `content/questions/`, or
  - the importer is changed to accept `contents/import-ready/`, or
  - a separate import command is created for import-ready files.

---

## 3. Existing Importer Expected JSON Shape

The importer expects an array of objective question objects.

From `validateQuestion(record, sourceFile, context)`, the effective expected shape is:

- `subject_slug`
- `question_text`
- `option_a`
- `option_b`
- `option_c`
- `option_d`
- `correct_option`
- `status`
- `explanation`

Optional or defaulted fields:

- `reference_note`
- `source_note`
- `difficulty`
  - defaults to `medium`
- `service_level`
  - optional
- `batch_number`
  - defaults to `1` with warning if missing
- `batch_position`
  - optional, but validated if present

Ignored extra fields:

- `source_number`
- `needs_review`
- `review_notes`

These extra fields are not rejected by the importer; they are simply not used in the insert/update payload.

---

## 4. Existing Importer Required Fields

The importer treats these as required and blocking:

- `subject_slug`
- `question_text`
- `option_a`
- `option_b`
- `option_c`
- `option_d`
- `correct_option`
- `status`

Important detail:

- `explanation` and `reference_note` are optional for every objective-question status.
- When omitted, they are normalized to empty strings.

---

## 5. Whether Empty Explanations Are Blocking

No. Empty explanations are non-blocking and may be reported for editorial awareness.

Reason:

In `validateQuestion`, `explanation` is not included in the importer `requiredFields` list.

- `const requiredFields = [ ... "correct_option", "status" ];`

The importer still normalizes optional guidance consistently:

- blank explanation and reference values become empty strings

Result:

- A record with `explanation: ""` is accepted when its required question fields are valid.
- This applies to draft, review, and published input records.

---

## 6. Whether Draft Status Changes Validation Behavior

Only partially.

What draft status does:

- it is accepted as a valid status
- it adds a warning:
  - status `"draft"` will not be visible to candidates until published

What draft status does **not** do:

- it does not relax the `explanation` requirement
- it does not relax required field validation
- it does not bypass structural checks

So `draft` is valid, but it is **not** a weaker validation mode.

---

## 7. Whether `needs_review` and `review_notes` Are Ignored, Accepted, or Rejected

They are effectively **accepted but ignored**.

The importer:

- does not validate them
- does not reject them
- does not write them to the database

Implications:

- `needs_review: true` does not block import
- `review_notes: []` or populated review notes do not block import
- those fields are lost during actual import because they are not part of the inserted/updated payload

---

## 8. Whether `contents/import-ready/public-financial-management.batch1.json` Is Compatible

### Structural Compatibility

Partially compatible.

Compatible fields:

- `subject_slug`
- `source_number`
- `batch_number`
- `batch_position`
- `question_text`
- `option_a`
- `option_b`
- `option_c`
- `option_d`
- `correct_option`
- `reference_note`
- `source_note`
- `status`
- `needs_review`
- `review_notes`

Incompatible content detail:

- all `explanation` fields are empty strings

Since the importer requires non-empty `explanation`, the file would be rejected if placed in the importer’s active input directory.

### Path Compatibility

Not compatible.

The file currently lives at:

- `contents/import-ready/public-financial-management.batch1.json`

The importer only scans:

- `content/questions/`

So in its current location, it will not be consumed at all.

### Final Compatibility Result

`contents/import-ready/public-financial-management.batch1.json` is **not currently consumable** by the existing importer.

One reason:

1. wrong input path

---

## 9. Mismatch Between `checkImportReady` and `importQuestions.mjs`

### Match

These parts mostly align:

- objective array shape
- required options A-D
- valid `correct_option` values
- subject slug must be one of the active subjects
- batch number and batch position should be present
- duplicate position and duplicate question checks are reasonable
- oral prep should not pass objective import checks
- dev seed markers should not be treated as clean import-ready content

### Explanation Policy

`checkImportReady` behavior:

- empty explanations are warnings only
- file can still be classified as `DRAFT_IMPORT_CANDIDATE`

`importQuestions.mjs` behavior:

- empty explanations are accepted

The checker and importer are aligned.

### Mismatch 2 - Status Set

`checkImportReady` allows:

- `draft`
- `published`
- `archived`

`importQuestions.mjs` allows:

- `draft`
- `review`
- `published`

This means:

- `archived` passes the checker
- but `archived` would be rejected by the importer

### Mismatch 3 - Input Path Assumption

`checkImportReady` checks a file directly at any path you pass in.

`importQuestions.mjs` does not accept an arbitrary file path. It only reads all JSON files from:

- `content/questions/`

So a file may be checker-approved but still not importable operationally.

### Mismatch 4 - Difficulty

The importer validates:

- `difficulty`

It defaults to `medium` if absent, so this is not a blocking mismatch for the current PFM batch file.

Still, the checker does not currently mention importer defaulting behavior for `difficulty`.

---

## 10. Can PFM Batch 1 Be Consumed as a Local Draft Import Candidate?

Not by the **existing** importer as-is.

Answer:

- **No**, not currently.

Why:

1. the importer does not read from `contents/import-ready/`
2. the importer rejects empty `explanation`

If the file were copied into `content/questions/` without further changes, it would still fail because all 30 explanations are empty.

---

## 11. Recommended Next Step

Recommended next step:

- **update checker rules**
- **create a separate local draft import command**
- **clean content first**

Recommended order:

1. Keep `checkImportReady` status rules aligned with the importer:
   - `draft`
   - `review`
   - `published`
2. Decide whether import-ready files should:
   - stay in `contents/import-ready/` and use a separate import command, or
   - be copied into `content/questions/` as a deliberate pre-import step.
4. Clean PFM Batch 1 explanations before attempting any local draft import through the current importer.

Most practical option:

- create a separate local draft import command later that reads from `contents/import-ready/`
- keep the current importer unchanged for now
- tighten the checker so it reflects current importer reality, not future desired behavior

---

## 12. Bottom Line

The checker currently says PFM Batch 1 is a `DRAFT_IMPORT_CANDIDATE`, but the real importer would still reject it.

Main blockers:

- empty explanations
- wrong input directory for the current importer

So the safe conclusion is:

- do **not** proceed with local import yet through the existing importer
- align the checker with the importer
- clean or fill explanations first
