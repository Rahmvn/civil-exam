# Accidental Import Reconciliation

## 1. Purpose

This report documents the inspection-only reconciliation of the possible accidental importer write that happened before the `--dry-run` flag handling was fixed.

Scope:

- inspect environment resolution
- inspect current database state with read-only queries only
- compare database rows against the cleaned Public Financial Management Batch 1 file
- recommend next action without changing any data

No cleanup was performed.
No import was performed during this inspection.
No publish action was performed.

---

## 2. Environment Resolution Findings

### Importer env loading behavior

The importer loads:

1. `.env`
2. `.env.local`

and uses:

- `SUPABASE_URL` or fallback `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Active env files found

Found:

- `.env`

Not found during inspection:

- `.env.local`

### Shell override check

No shell-level environment override was present for:

- `SUPABASE_URL`
- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Supabase URL used

The resolved URL was:

- `https://beapcfiofyrhsxwxcmyd.supabase.co`

The service role key was intentionally not printed.

### Environment most likely affected

Most likely affected environment:

- **remote Supabase project**

Reason:

- the importer target URL is a hosted Supabase project URL
- no local override was present
- no local `127.0.0.1` Supabase URL was active

Conclusion:

- the accidental write most likely affected the remote Supabase project tied to `https://beapcfiofyrhsxwxcmyd.supabase.co`

---

## 3. Database Inspection Performed

Read-only/select queries were used to inspect:

- active `public-financial-management` subject row
- question rows in `batch_number = 1`
- rows matching the cleaned file’s `question_text`
- rows with:
  - `source_note = provided_client_content_reviewed_draft`
  - `status = draft`
- existing development seed rows for the same subject and batch
- duplicate question text conditions within PFM Batch 1

Comparison file:

- `contents/import-ready/public-financial-management.batch1.cleaned.json`

---

## 4. Matching Rows Found

### Matching cleaned-file questions in database

Matching rows found:

- **30**

These rows matched the cleaned file on:

- `question_text`
- `batch_number = 1`
- `subject_slug = public-financial-management`
- `source_note = provided_client_content_reviewed_draft`
- `status = draft`

Also confirmed:

- `correct_option` values matched the cleaned file
- `explanation` values matched the cleaned file

### Status of matching rows

Matching row statuses:

- `draft: 30`
- `published: 0`
- `review: 0`

Conclusion:

- the accidental import appears to have inserted or updated all 30 cleaned PFM Batch 1 items as draft rows

---

## 5. Does It Match the Cleaned File Count?

Yes.

Cleaned file count:

- 30

Matching database rows:

- 30

Conclusion:

- the database currently contains a full draft copy of the cleaned PFM Batch 1 set

---

## 6. Existing Dev Seed Questions

Development seed rows for the same subject and batch were inspected.

Found:

- **3** development seed questions

Statuses:

- `published`

Conclusion:

- the existing development seed questions were **left alone**
- they were not overwritten by the accidental import

---

## 7. Duplicate Question Check

Total `public-financial-management` Batch 1 rows currently found:

- **45**

Status summary:

- `archived: 12`
- `published: 3`
- `draft: 30`

Duplicate question text check within PFM Batch 1:

- **no duplicates found**

Conclusion:

- the 30 accidental draft rows do not currently create duplicate question text rows inside PFM Batch 1

---

## 8. Would Users See These Rows?

The 30 matching imported rows are all `draft`.

Based on current importer behavior and existing product flow:

- draft questions are not meant to be visible to candidates
- the importer itself warns that draft rows will not be visible until published

Therefore:

- the accidental PFM draft rows are **not likely user-visible**

However:

- the 3 existing published dev seed rows for PFM remain visible as before

Conclusion:

- the accidental rows are likely not showing up to users directly
- the older published dev seed rows are still the user-visible PFM content

---

## 9. Reconciliation Assessment

### What likely happened

The first attempted `--dry-run` execution most likely ran through the live importer path before the flag bug was fixed.

Most likely effect:

- 30 cleaned PFM Batch 1 rows were inserted or updated into the remote Supabase project as `draft`

### Current risk level

Risk is moderate but contained:

- data appears to be draft only
- no duplicates were found
- published dev seeds were not overwritten
- candidate visibility is likely unchanged

---

## 10. Recommended Reconciliation Action

Recommended next action:

- **investigate further**
- then **archive/delete accidental remote draft data** if confirmed not intentionally wanted yet

Reason:

- the affected environment is likely remote, not local
- the data was written accidentally
- even though it is draft-only, it should be reconciled intentionally rather than ignored

Suggested next operational step:

1. confirm whether the remote draft rows should be retained as intentional staging data
2. if not, remove or archive the 30 accidental draft rows in a deliberate cleanup step
3. keep the published dev seed rows unchanged until a proper content replacement plan is approved

### Is immediate emergency cleanup required?

Likely no.

Reason:

- rows are draft
- rows are not likely visible to users
- no destructive overwrite of the published dev seed rows was detected

---

## 11. Bottom Line

- Environment likely affected: **remote Supabase**
- Supabase URL used: `https://beapcfiofyrhsxwxcmyd.supabase.co`
- Matching cleaned PFM draft rows found: **30**
- Matching row status: **all draft**
- Cleaned file count match: **yes**
- Existing published dev seed rows overwritten: **no**
- Duplicate question texts created: **no**
- Likely user-visible: **no, because the accidental rows are draft**

Recommended action:

- **investigate further and then clean up the accidental remote draft data intentionally**
