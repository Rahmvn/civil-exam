# Remote Content Rollout Plan

## 1. Purpose

This document defines the safe remote rollout path for the current Public Financial Management Batch 1 work.

It is planning only.

It does not:

- push migrations
- import remote content
- publish content
- change app UI
- change auth or Paystack

The goal is to move from validated local progress to a controlled remote draft import and later publish decision.

---

## 2. Current Local Status

Current confirmed local state:

- `contents/import-ready/public-financial-management.batch1.cleaned.json` exists
- the cleaned file passed local import-readiness checks
- local targeted importer dry-run passed
- local targeted importer import passed as `draft`
- local PFM Batch 1 candidate simulation passed with `30` visible questions
- local free-batch start, submit, and review flow worked
- legacy question-count trial counters were neutralized locally
- local summary now returns:
  - `trial_question_limit = null`
  - `trial_questions_used = null`

Local content validation status:

- PFM Batch 1 is structurally usable as draft import content
- questions `3`, `5`, `13`, and `22` still require human verification before publish

---

## 3. Remote Current Known Status

Known remote facts from prior inspection and cleanup:

- the accidental `30` remote draft PFM Batch 1 rows were deleted
- remote published PFM dev seed rows remain
- remote should not be assumed to have real reviewed PFM content published
- remote likely still needs the legacy counter neutralization migration applied
- remote candidate-visible PFM content is still likely the older dev seed set until a deliberate replacement step is approved

Important assumption boundary:

- do not assume remote and local summary behavior match until the legacy counter migration is applied remotely and verified

---

## 4. Remote Rollout Order

### Step 1: Read-only remote backup and state check

Before any push or import:

- confirm the target Supabase URL is the intended remote project
- confirm no local `127.0.0.1` env is active for this step
- run read-only verification queries only
- capture the results in a dated note or report before making changes

Checks:

- active subject row for `public-financial-management`
- current PFM Batch 1 counts by `status` and `source_note`
- current published dev seed row count
- confirmation that accidental draft rows are absent
- duplicate `question_text` check for PFM Batch 1
- current `get_candidate_summary()` legacy field behavior

### Step 2: Push only the legacy counter migration

Push only after confirming which migrations are pending.

Target migration:

- `supabase/migrations/20260709110000_neutralize_legacy_trial_summary.sql`

Do not combine this step with content import.

This step exists only to align remote summary behavior with the batch-based model already validated locally.

### Step 3: Verify remote summary behavior after migration

After the migration push:

- verify `get_candidate_summary()` still returns the expected batch-access fields
- verify:
  - `trial_question_limit = null`
  - `trial_questions_used = null`

Do not proceed to import until this is confirmed.

### Step 4: Run remote importer dry-run for cleaned PFM Batch 1

Run:

- targeted `--file`
- `--dry-run`

Use:

- `contents/import-ready/public-financial-management.batch1.cleaned.json`

Requirements:

- no writes
- clear confirmation of remote target env
- validation must pass before any real import step

### Step 5: Import cleaned PFM Batch 1 to remote as draft only

If dry-run passes:

- run targeted import for the cleaned PFM Batch 1 file
- import as `draft` only
- do not publish
- do not modify dev seed rows yet

### Step 6: Verify remote draft import

After import, verify:

- exactly `30` rows exist remotely with:
  - `subject_slug = public-financial-management`
  - `batch_number = 1`
  - `source_note = provided_client_content_reviewed_draft`
  - `status = draft`

Also verify:

- remote published dev seed rows still exist
- no unintended published rows were created
- no duplicate `question_text` rows were introduced

### Step 7: Stop at draft import

Do not publish at this stage.

Reason:

- questions `3`, `5`, `13`, and `22` still need human verification

This is the decision pause point.

### Step 8: Publish plan after human verification

Only after human verification is complete:

- publish the `30` cleaned reviewed PFM Batch 1 rows
- archive or hide the `3` published PFM dev seed rows
- verify candidate-visible PFM Batch 1 count becomes exactly `30`
- re-run candidate-facing verification on remote/staging

---

## 5. Safety Rules

- Never run import without first confirming the target env URL.
- Never print the service role key.
- Always run `--dry-run` first.
- Import as `draft` only.
- Publish as a separate later action.
- Roll out one reviewed batch at a time.
- Do not publish Current Affairs remotely until fact-checking is complete.
- Do not import oral prep into CBT tables.
- Do not push unrelated migrations together with this rollout.
- Do not archive or replace dev seed rows until the reviewed replacement batch is verified and approved.

---

## 6. Remote Verification Queries

These are read-only checks or safe verification descriptions for remote rollout.

### 6.1 Check canonical subject row

```sql
select id, slug, name, is_active, batch_size, pass_mark_percent
from public.subjects
where slug = 'public-financial-management';
```

Expected:

- one active canonical PFM subject row

### 6.2 Check PFM Batch 1 counts by status and source note

```sql
select
  s.slug,
  q.batch_number,
  q.status,
  q.source_note,
  count(*) as question_count
from public.questions q
join public.subjects s on s.id = q.subject_id
where s.slug = 'public-financial-management'
  and q.batch_number = 1
group by s.slug, q.batch_number, q.status, q.source_note
order by q.status, q.source_note;
```

### 6.3 Confirm accidental draft rows are absent before re-import

```sql
select count(*) as accidental_draft_count
from public.questions q
join public.subjects s on s.id = q.subject_id
where s.slug = 'public-financial-management'
  and q.batch_number = 1
  and q.source_note = 'provided_client_content_reviewed_draft'
  and q.status = 'draft';
```

Expected before new remote import:

- `0`

### 6.4 Confirm dev seed rows are still present

```sql
select
  q.status,
  q.source_note,
  count(*) as question_count
from public.questions q
join public.subjects s on s.id = q.subject_id
where s.slug = 'public-financial-management'
  and q.batch_number = 1
  and q.source_note = 'Development seed question - not official exam content'
group by q.status, q.source_note
order by q.status;
```

### 6.5 Verify summary RPC legacy fields after migration

Run with an authenticated test user and check:

```sql
select *
from public.get_candidate_summary();
```

Expected after migration:

- `trial_question_limit` is `null`
- `trial_questions_used` is `null`

### 6.6 Check duplicate question text risk

```sql
select
  q.question_text,
  count(*) as duplicate_count
from public.questions q
join public.subjects s on s.id = q.subject_id
where s.slug = 'public-financial-management'
  and q.batch_number = 1
group by q.question_text
having count(*) > 1
order by duplicate_count desc, q.question_text;
```

### 6.7 Verify exact remote draft import after Step 5

```sql
select
  q.status,
  q.source_note,
  count(*) as question_count
from public.questions q
join public.subjects s on s.id = q.subject_id
where s.slug = 'public-financial-management'
  and q.batch_number = 1
  and q.source_note = 'provided_client_content_reviewed_draft'
group by q.status, q.source_note
order by q.status;
```

Expected after draft import:

- `draft = 30`

---

## 7. Rollback / Cleanup Plan

If the remote draft import is wrong:

- delete only rows matching:
  - `subject_slug = public-financial-management`
  - `batch_number = 1`
  - `source_note = provided_client_content_reviewed_draft`
  - the exact `question_text` list from `contents/import-ready/public-financial-management.batch1.cleaned.json`

If rows were accidentally published:

- immediately archive or delete only the exact accidentally published reviewed rows
- do not touch the published dev seed rows unless the replacement step was intentional and approved

General rollback rule:

- never run a broad delete by subject alone
- never delete by batch alone
- always constrain by `source_note` and exact `question_text` set

---

## 8. Decision Gate

Do not proceed to remote publish until all of the following are true:

- PFM questions `3`, `5`, `13`, and `22` are verified by a human
- the cleaned file has final human approval
- the remote draft import has been verified successfully
- the dev seed replacement plan is explicitly approved

Until then:

- remote draft import is acceptable
- remote publish is not

---

## 9. Recommended Remote Commands Sequence

Use this order when ready:

1. Read-only remote verification queries
2. Confirm pending migrations
3. Push only `20260709110000_neutralize_legacy_trial_summary.sql`
4. Verify remote summary RPC fields are null
5. Run importer dry-run against remote env
6. Run targeted remote draft import
7. Verify exact remote draft row count
8. Stop and wait for human verification / publish approval

---

## 10. Next Codex Prompt

Use only when ready.

```text
Read docs/REMOTE_CONTENT_ROLLOUT_PLAN.md, docs/PFM_BATCH1_EXPLANATION_REVIEW.md, docs/ACCIDENTAL_IMPORT_CLEANUP_REPORT.md, and scripts/importQuestions.mjs first.

We are ready for the remote PFM Batch 1 draft rollout.

Do not publish anything yet.
Do not touch local Supabase.
Do not change app UI.
Do not change schema or auth or Paystack.

Task:
1. Confirm remote SUPABASE_URL target before doing anything.
2. Run read-only remote verification queries for:
   - PFM subject row
   - PFM Batch 1 status/source counts
   - accidental reviewed draft rows absent
   - dev seed rows present
   - duplicate question_text check
3. Confirm pending migrations.
4. Push only:
   - supabase/migrations/20260709110000_neutralize_legacy_trial_summary.sql
5. Verify remote get_candidate_summary returns:
   - trial_question_limit = null
   - trial_questions_used = null
6. Run:
   npm run import:questions -- --file "contents/import-ready/public-financial-management.batch1.cleaned.json" --dry-run
   against remote env only.
7. If dry-run passes, run the actual targeted import against remote env only.
8. Verify exactly 30 remote draft rows exist with:
   - subject_slug public-financial-management
   - batch_number 1
   - source_note provided_client_content_reviewed_draft
   - status draft
9. Do not publish.
10. Create a remote draft import report with verification results.

Report:
1. Remote target URL confirmed
2. Migration push result
3. Summary RPC verification result
4. Dry-run result
5. Import result
6. Draft row verification result
7. Confirmation that no publish was performed
```

---

## 11. Bottom Line

Safe current recommendation:

- remote migration first
- remote dry-run second
- remote draft import third
- human verification before publish

Do not jump directly from local success to remote publish.
