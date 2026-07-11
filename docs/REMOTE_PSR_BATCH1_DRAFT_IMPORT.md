# Remote PSR Batch 1 Draft Import

## 1. Scope

This report documents the remote verification state for:

- `contents/import-ready/public-service-rules.batch1.cleaned.json`

This check covered only the current draft-import status of reviewed Public Service Rules Batch 1 rows.

It did not:

- publish any content
- delete any content
- archive any content
- touch PFM
- touch Current Affairs
- touch Oral Prep

---

## 2. Remote URL Confirmed

Confirmed remote Supabase URL:

- `https://beapcfiofyrhsxwxcmyd.supabase.co`

The service role key was not printed.

---

## 3. Remote Subject Verification

Confirmed canonical PSR subject row:

- slug: `public-service-rules`
- active: `true`
- batch size: `20`
- pass mark percent: `70`

---

## 4. Batch 1 Status Check

Remote Public Service Rules Batch 1 status/source state:

- `archived | dev_seed_gl07` = `11`
- `archived | dev_seed_gl08` = `1`
- `draft | PLACEHOLDER — sample for testing only; not a real exam question. Replace via admin before launch.` = `1`
- `draft | provided_client_content_reviewed_draft` = `20`
- `published | Development seed question - not official exam content` = `3`

Reviewed PSR Batch 1 draft rows confirmed:

- count = `20`
- `subject_slug = public-service-rules`
- `batch_number = 1`
- `source_note = provided_client_content_reviewed_draft`
- `status = draft`

Reviewed PSR Batch 1 published rows confirmed:

- count = `0`

Result:

- no reviewed PSR Batch 1 rows were published accidentally

---

## 5. Dev Seed Status

Old PSR dev seed rows still exist remotely.

Status summary:

- `published | Development seed question - not official exam content` = `3`

Historical archived seed rows also remain:

- `archived | dev_seed_gl07` = `11`
- `archived | dev_seed_gl08` = `1`

No seed rows were changed in this verification task.

---

## 6. Candidate Visibility Assessment

Candidate-visible PSR Batch 1 rows are still only the currently published rows.

Published candidate-visible PSR Batch 1 count:

- `3`

Meaning:

- the 20 reviewed PSR Batch 1 rows are still safe in `draft`
- candidates would still only see the published PSR rows unless a separate publish step is approved later

---

## 7. Duplicate Reviewed Question Text Check

Reviewed PSR Batch 1 duplicate `question_text` check result:

- duplicate reviewed question-text groups = `0`

Meaning:

- no duplicate reviewed PSR Batch 1 `question_text` rows were detected among the 20 reviewed draft items

---

## 8. Confirmation

- nothing was published
- nothing was deleted
- nothing was archived
- no remote content outside PSR Batch 1 verification was touched
- no app code, schema, migration, Paystack, or auth change was made in this task
