# Local PFM Batch 1 Import Test

## 1. Purpose

This report documents the local-only import test for:

- `contents/import-ready/public-financial-management.batch1.cleaned.json`

The goal was to validate the targeted importer workflow safely against local Supabase only.

No remote import was performed in this task.
No publish action was performed.

---

## 2. Local Supabase Environment Confirmation

Local Supabase was confirmed running via `supabase status`.

Confirmed local API URL:

- `http://127.0.0.1:55421`

Important note:

- the local stack in this environment is using port `55421`, not `54321`
- the import test used the actual running local Project URL from `supabase status -o json`
- the local service role key was used ephemerally and was not printed

Environment safety:

- `SUPABASE_URL` was overridden in-session to the local API URL
- `SUPABASE_SERVICE_ROLE_KEY` was overridden in-session to the local service role key
- the project `.env` remote URL was not used for the actual import test

---

## 3. Dry-Run Result

Command run:

- `npm run import:questions -- --file "contents/import-ready/public-financial-management.batch1.cleaned.json" --dry-run`

Result:

- dry-run completed successfully
- no database writes were performed in the fixed dry-run path
- selected file count: 30 questions
- subject count:
  - `public-financial-management: 30`
- batch count:
  - `public-financial-management batch 1: 30`
- status count:
  - `draft: 30`

Dry-run warning:

- the file is an import-ready pipeline file and should be imported as draft first, with publishing handled separately

---

## 4. Actual Local Import Result

Command run:

- `npm run import:questions -- --file "contents/import-ready/public-financial-management.batch1.cleaned.json"`

Result:

- import completed against local Supabase only
- imported rows: **30**
- skipped rows: **0**
- failed rows: **0**

Importer output summary after local import:

- Public Financial Management Batch 1 total local rows: 33
- This total is consistent with:
  - 30 newly imported draft rows
  - 3 existing published dev seed rows

---

## 5. Local Database Verification

Read-only verification after import confirmed:

- matching local draft rows with:
  - `subject_slug = public-financial-management`
  - `batch_number = 1`
  - `source_note = provided_client_content_reviewed_draft`
  - `status = draft`
  - `question_text` matching the cleaned file
- matching draft row count: **30**

Published dev seed verification:

- published dev seed rows still present: **3**
- published dev seed statuses:
  - `published`

Published status safety:

- no imported rows were published accidentally
- imported cleaned-file rows are all `draft`

Duplicate check:

- duplicate question texts in local PFM Batch 1: **none**

Local PFM Batch 1 totals after import:

- total rows in local PFM Batch 1: **33**
  - 30 draft cleaned-file rows
  - 3 published dev seed rows

---

## 6. Candidate Visibility Assessment

Assessment:

- the 30 imported cleaned rows are **not likely visible to candidates**
- reason:
  - they remain `draft`
  - draft rows are not meant to appear in normal candidate flows until published

Published dev seed visibility:

- the 3 published dev seed rows remain the likely visible PFM Batch 1 content in local testing

---

## 7. Issues Encountered

One minor issue occurred during verification:

- the first verification script used `require(...)` inside ESM evaluation and failed
- this was corrected immediately with an ESM-safe version

No import data issue occurred after the import command itself.

---

## 8. Bottom Line

- Local Supabase URL confirmed: `http://127.0.0.1:55421`
- Dry-run result: passed
- Import result: passed
- Rows inserted/updated: **30 imported**
- Matching draft rows present after import: **30**
- Published dev seed rows remain: **yes, 3**
- No accidental publish occurred
- Remote Supabase was not touched in this task
