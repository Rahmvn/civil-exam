# Accidental Import Cleanup Report

## 1. Purpose

This report documents the targeted cleanup of the accidental Public Financial Management Batch 1 draft import identified in the reconciliation step.

Cleanup scope was limited to rows matching all of the approved safety conditions:

- `subject_slug = public-financial-management`
- `batch_number = 1`
- `source_note = provided_client_content_reviewed_draft`
- `status = draft`
- `question_text` matching one of the 30 questions in:
  - `contents/import-ready/public-financial-management.batch1.cleaned.json`

No other rows were targeted.

---

## 2. Environment Cleaned

Environment cleaned:

- remote Supabase project

Supabase URL used:

- `https://beapcfiofyrhsxwxcmyd.supabase.co`

The service role key was not printed.

---

## 3. Preview Before Cleanup

Read-only preview result:

- Matching rows found: **30**
- Subject: `public-financial-management`
- Batch number: `1`
- Status summary:
  - `draft: 30`
- Source note summary:
  - `provided_client_content_reviewed_draft: 30`

Safety checks:

- matching count was exactly 30
- all matched rows were `draft`
- all matched rows had `source_note = provided_client_content_reviewed_draft`
- all matched rows had question text matching the cleaned file list
- no published rows were included in the target set

Because all safety checks passed, cleanup proceeded.

---

## 4. Cleanup Action Taken

Cleanup action:

- targeted delete of the exact 30 accidental draft rows only

Rows deleted:

- **30**

No broader delete condition was used beyond the validated target set.

---

## 5. Verification After Cleanup

Verification results:

- Remaining matching accidental draft rows: **0**
- Published PFM Batch 1 rows still present: **3**
- Published dev seed rows still present: **3**
- Published dev seed statuses:
  - `published`
- Remaining PFM Batch 1 draft rows: **0**

Conclusion:

- the accidental remote draft set was removed successfully
- published dev seed rows remain intact
- no published rows were deleted
- no unrelated draft rows remained in the same PFM Batch 1 bucket after cleanup

---

## 6. Additional Notes

This cleanup did **not**:

- import any new content
- publish any content
- change schema or migrations
- change app UI or frontend behavior
- modify Paystack or auth

This cleanup removed only the accidental remote draft rows that matched the approved criteria.

---

## 7. Bottom Line

- Preview count before cleanup: **30**
- Cleanup action taken: **delete exact accidental draft set**
- Rows deleted: **30**
- Verification count after cleanup: **0**
- Published PFM dev seed rows remain: **yes**
- Any issue encountered: **no**
