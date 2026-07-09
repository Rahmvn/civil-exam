# Remote PFM Batch 1 Draft Import

## 1. Scope

This report documents the controlled remote draft rollout for:

- `contents/import-ready/public-financial-management.batch1.cleaned.json`

This rollout covered only:

- the legacy trial-counter neutralization migration
- the remote draft import of cleaned Public Financial Management Batch 1

It did not:

- publish any content
- archive dev seed rows
- delete any content
- import PSR
- import Current Affairs
- import Oral Prep

---

## 2. Remote URL Confirmed

Confirmed remote Supabase URL:

- `https://beapcfiofyrhsxwxcmyd.supabase.co`

The service role key was not printed.

---

## 3. Pending Migration Check

Before applying anything, remote pending migrations were checked.

Result:

- only one migration was pending remotely:
  - `20260709110000_neutralize_legacy_trial_summary.sql`

No other pending migration was applied in this rollout.

---

## 4. Migration Push Result

Applied migration:

- `supabase/migrations/20260709110000_neutralize_legacy_trial_summary.sql`

Result:

- migration push succeeded

Purpose:

- neutralize the old question-count trial summary fields so remote summary behavior matches the batch-based free-access model already validated locally

---

## 5. Summary RPC Verification

Remote `get_candidate_summary()` was verified after the migration using a temporary authenticated test user.

Confirmed:

- `trial_question_limit = null`
- `trial_questions_used = null`

Batch-based summary fields still worked and remained present:

- `has_paid_access`
- `free_module_subject_slug`
- `free_first_attempt_completed`
- `free_retry_consumed`

The temporary verification user was removed after the check.

---

## 6. Pre-Import Remote Checks

Read-only remote checks were completed before import.

### Canonical PFM subject row

Confirmed:

- slug: `public-financial-management`
- active: `true`
- batch size: `30`
- pass mark percent: `70`

### PFM Batch 1 counts before import

Remote PFM Batch 1 status/source state before import:

- `archived | dev_seed_gl07` = `11`
- `archived | dev_seed_gl08` = `1`
- `published | Development seed question - not official exam content` = `3`

### Accidental reviewed draft rows

Confirmed absent before import:

- `draft | provided_client_content_reviewed_draft` = `0`

### Published PFM dev seed rows

Confirmed still present before import:

- `published | Development seed question - not official exam content` = `3`

### Duplicate question text check

Confirmed:

- no duplicate PFM Batch 1 `question_text` rows were present before import

---

## 7. Dry-Run Result

Command run:

- `npm run import:questions -- --file "contents/import-ready/public-financial-management.batch1.cleaned.json" --dry-run`

Result:

- dry-run succeeded
- no database writes were performed
- total questions: `30`
- subject: `public-financial-management`
- batch: `1`
- status: `draft`

Dry-run notes:

- importer warned correctly that draft rows will not be visible to candidates until published
- importer warned that the file is an import-ready pipeline file and should be published separately after review

---

## 8. Remote Draft Import Result

Command run:

- `npm run import:questions -- --file "contents/import-ready/public-financial-management.batch1.cleaned.json"`

Result:

- imported: `30`
- skipped: `0`
- failed: `0`

Import behavior:

- rows were imported as `draft`
- no rows were published

---

## 9. Post-Import Verification

Read-only verification after import confirmed:

- `draft | provided_client_content_reviewed_draft` = `30`
- `published | provided_client_content_reviewed_draft` = `0`
- `published | Development seed question - not official exam content` = `3`

Exact checks satisfied:

- subject slug is `public-financial-management`
- batch number is `1`
- source note is `provided_client_content_reviewed_draft`
- status is `draft`
- matching cleaned-file `question_text` rows imported = `30`
- no duplicate question text issue detected

Historical remote PFM Batch 1 rows still present:

- `archived | dev_seed_gl07` = `11`
- `archived | dev_seed_gl08` = `1`

---

## 10. Published Dev Seed Status

Published PFM dev seed rows remain:

- `3`

Status:

- still `published`

No dev seed rows were archived, deleted, or replaced in this rollout.

---

## 11. Candidate Visibility Assessment

Candidate-visible published PFM Batch 1 rows after import:

- `3`

Meaning:

- the newly imported reviewed PFM Batch 1 rows are not yet candidate-visible because they remain `draft`
- candidate-visible PFM content is still only the existing published dev seed set

This matches the rollout safety rule:

- import draft first
- publish separately after human approval

---

## 12. Issues Encountered

No blocking rollout issue occurred.

One expected caution remains:

- questions `3`, `5`, `13`, and `22` match the provided answer key, but still require official/source verification before publishing

This did not block draft import, but it still blocks publish readiness.

---

## 13. Confirmation

- remote URL was confirmed before action
- service role key was not printed
- migration was applied successfully
- dry-run was performed before import
- import was draft-only
- no content was published
- no dev seed rows were archived
- no rows were deleted in this rollout
