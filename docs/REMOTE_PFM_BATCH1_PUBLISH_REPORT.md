# Remote PFM Batch 1 Publish Report

## 1. Scope

This report documents the controlled remote publish step for Public Financial Management Batch 1.

Scope of this task:

- publish the `30` reviewed PFM Batch 1 rows
- hide the `3` old published PFM dev seed rows by archiving them

This task did not:

- change app UI
- change frontend code
- change schema
- create migrations
- change Paystack
- change auth logic
- import new content
- touch PSR
- touch Current Affairs
- touch Oral Prep
- delete rows

---

## 2. Remote URL Confirmed

Confirmed remote Supabase URL:

- `https://beapcfiofyrhsxwxcmyd.supabase.co`

The service role key was not printed.

---

## 3. Pre-Publish Preview

Read-only checks were run before any write.

### Reviewed PFM Batch 1 draft rows

Confirmed:

- reviewed draft rows = `30`
- all reviewed rows were `draft`
- all reviewed rows used:
  - `source_note = provided_client_content_reviewed_draft`
- reviewed rows with empty explanations = `0`
- reviewed rows already published = `0`
- duplicate reviewed question text rows = `0`

### Published PFM dev seed rows

Confirmed:

- currently published PFM dev seed rows = `3`

### Unrelated subject snapshot before publish

Observed unchanged baseline for non-target subjects:

- `public-service-rules`
  - `archived | dev_seed_gl07` = `11`
  - `archived | dev_seed_gl08` = `1`
  - `published | Development seed question - not official exam content` = `3`
  - `draft | PLACEHOLDER — sample for testing only; not a real exam question. Replace via admin before launch.` = `1`
- `current-affairs`
  - `archived | dev_seed_gl07` = `11`
  - `archived | dev_seed_gl08` = `1`
  - `published | Development seed question - not official exam content` = `3`
  - `draft | PLACEHOLDER — sample for testing only; not a real exam question. Replace via admin before launch.` = `1`

All required preview conditions were satisfied, so publish proceeded.

---

## 4. Publish Action Taken

Scoped publish action:

- updated the `30` reviewed PFM Batch 1 rows from `draft` to `published`
- updated the `3` currently published PFM dev seed rows from `published` to `archived`

Rows changed:

- reviewed rows published: `30`
- current dev seed rows archived: `3`

Write safety:

- updates were constrained to exact row IDs after preview validation
- no delete was performed
- no other subject or batch was targeted

Note:

- a true SQL transaction was not available in the current shell/tool path, so the operation was performed as tightly scoped sequential updates after exact preview validation

---

## 5. Post-Publish Verification

Read-only verification after publish confirmed:

### Target reviewed PFM rows

- reviewed PFM Batch 1 published rows = `30`
- reviewed PFM Batch 1 draft rows = `0`
- reviewed PFM Batch 1 published duplicates = `0`

### Current dev seed PFM rows

- old current PFM dev seed published rows = `0`
- old current PFM dev seed archived rows = `3`

### Historical archived dev seed rows

Historical archived PFM seed rows already present before this task still remain:

- `dev_seed_gl07` / `dev_seed_gl08` archived rows = `12`

These were not changed by this publish step.

### Candidate-visible PFM count

- candidate-visible published PFM Batch 1 rows = `30`

Meaning:

- the reviewed PFM Batch 1 is now the candidate-visible published batch
- the old published dev seed rows are no longer candidate-visible

---

## 6. Unrelated Subject Verification

Confirmed unchanged after publish:

- `public-service-rules` counts remained unchanged
- `current-affairs` counts remained unchanged

No PSR, Current Affairs, or Oral Prep data was modified.

---

## 7. App Flow Verification

Remote verification was run with a temporary authenticated test candidate.

### Dashboard-like batch readiness

Confirmed through `get_module_progress()`:

- subject slug = `public-financial-management`
- `has_questions = true`
- `batch_size = 30`
- `pass_mark_percent = 70`
- `current_batch_number = 1`

### Practice load

Confirmed through `start_practice_batch("public-financial-management")`:

- practice loaded `30` questions
- batch number = `1`
- batch size = `30`
- undersized dev-batch note would show = `false`

### Submit and review

Confirmed:

- submit score = `30/30`
- submit `total_questions = 30`
- review returned `30` answer rows
- next action remained `unlock_full_access` for the free-user pass path

The temporary verification user was removed after the check.

---

## 8. Lint / Build Result

- `npm run lint` passed
- `npm run build` passed

---

## 9. Confirmation

- no unrelated subjects were touched
- no rows were deleted
- no new content was imported in this task
- no schema change happened
- no migration was created
- no app UI or frontend code was changed
- no Paystack logic was changed
- no auth logic was changed
