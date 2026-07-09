# Remote PSR Batch 1 Publish Report

## 1. Scope

This report documents the current verified remote state for Public Service Rules Batch 1 after reconciling the reusable `content:publish-batch` dry-run output.

This task did not:

- publish any content
- archive any content
- delete any content
- change app UI
- change frontend code
- change schema
- create migrations
- change Paystack
- change auth logic
- import new content
- touch PFM
- touch Current Affairs
- touch Oral Prep

---

## 2. Remote URL Confirmed

Confirmed remote Supabase URL:

- `https://beapcfiofyrhsxwxcmyd.supabase.co`

The service role key was not printed.

---

## 3. Reconciled Batch State

The latest `content:publish-batch` dry-run confirmed that Public Service Rules Batch 1 was already in the published end state before this task.

Classification returned by the script:

- `ALREADY_PUBLISHED`

This is not a script bug.

It means the publish preconditions for a completed live batch were already true before this reconciliation run:

- reviewed draft rows = `0`
- reviewed published rows = expected batch size
- published dev seed rows = `0`
- empty explanation count = `0`
- duplicate reviewed question-text groups = `0`

---

## 4. Verified Remote Counts

Verified remote Public Service Rules Batch 1 counts:

- reviewed PSR Batch 1 published rows = `20`
- reviewed PSR Batch 1 draft rows = `0`
- old PSR dev seed published rows = `0`
- old PSR dev seed archived rows = `3`
- candidate-visible PSR Batch 1 count = `20`
- duplicate reviewed question-text groups = `0`

Additional PSR Batch 1 rows still present but not candidate-visible:

- `archived | dev_seed_gl07` = `11`
- `archived | dev_seed_gl08` = `1`
- `draft | PLACEHOLDER — sample for testing only; not a real exam question. Replace via admin before launch.` = `1`

Meaning:

- the reviewed PSR Batch 1 is already the live candidate-visible batch
- the old 3-question PSR dev seed set is already hidden from candidate-visible published content

---

## 5. Dry-Run Reconciliation Result

Dry-run command used:

```bash
npm run content:publish-batch -- --subject public-service-rules --batch 1 --source-note provided_client_content_reviewed_draft --archive-dev-seeds --dry-run
```

Dry-run result:

- state: `ALREADY_PUBLISHED`
- rows published: `0`
- dev seed rows archived: `0`
- database writes performed: `0`

Outcome:

- no action needed
- no publish command was run in this task
- no database write was performed in this task

---

## 6. Unrelated Subject Safety

No unrelated subject was touched in this reconciliation task.

Specifically unchanged:

- `public-financial-management`
- `current-affairs`

No PFM, Current Affairs, or Oral Prep data was modified.

---

## 7. Lint / Build Result

- `npm run lint` passed
- `npm run build` passed

---

## 8. Confirmation

- the database was already in the published PSR Batch 1 state before this task
- this task only verified and documented that state
- no publish happened in this task
- no archive happened in this task
- no delete happened in this task
- no database write happened in this task
- no app UI or frontend code was changed outside the publish-script improvement
