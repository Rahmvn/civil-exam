# Batch Access Local Validation Report

## Local Supabase Status

Local Supabase was active during validation.

- Project URL: `http://127.0.0.1:55421`
- Database container: `supabase_db_civil-exam-app`

No remote Supabase environment was touched.

## Migration Applied Locally

The new migration is present in local schema migrations:

- `20260709123000_batch_access_progression_policy`

Validation query confirmed:

- version found in `supabase_migrations.schema_migrations`

## RPCs Found Locally

The following RPCs/functions were confirmed in local `public` schema:

- `get_batch_access_state(requested_subject_slug text, requested_batch_number integer)`
- `get_module_batch_access(requested_subject_slug text)`
- `start_practice_batch(requested_subject_slug text, requested_batch_number integer)`
- `get_practice_questions(requested_subject_id uuid, requested_limit integer, requested_batch_number integer)`
- `submit_attempt(submitted_mode attempt_mode, submitted_subject_id uuid, submitted_answers jsonb, submitted_batch_number integer)`
- `get_attempt_review(requested_attempt_id uuid)`

## Frontend Signature Alignment

`src/lib/appApi.js` matches the current local RPC signatures:

- `getModuleBatchAccess(subjectSlug?)` -> `get_module_batch_access`
- `startPracticeBatch(subjectSlug, batchNumber?)` -> `start_practice_batch`
- `getPracticeQuestions({ subjectId, limit, batchNumber })` -> `get_practice_questions`
- `submitAttempt({ mode, subjectId, answers, batchNumber })` -> `submit_attempt`
- `getAttemptReview(attemptId?)` -> `get_attempt_review`

No signature mismatch was found between the frontend API helper layer and the new SQL migration.

## Local Content State Observed

At the start of validation, local content was sparse:

- `public-service-rules` batch 1 had `1` draft row
- `current-affairs` batch 1 had `1` draft row
- no active published batch data was available by default for these smoke checks

Because of that, smoke tests used rollback-only transaction scaffolds that temporarily:

- created local test users
- completed onboarding/profile fields
- temporarily promoted one local PSR draft question to `published`
- added a temporary local paid entitlement for the paid-user scenario

Each smoke test transaction ended with `ROLLBACK`, so no lasting local data changes were kept.

## Smoke Tests Run

### 1. Free user access state

Rollback-only transaction created:

- local authenticated test user
- completed profile
- temporary published `public-service-rules` batch 1 question

Result:

- `get_batch_access_state('public-service-rules', 1)`
  - `state = available`
  - `reason_code = free_batch_available`
  - `can_start = true`

### 2. Unpublished/draft batch state

Using the same rollback-only free-user test context:

- `get_batch_access_state('current-affairs', 1)`
  - `state = unavailable_not_published`
  - `reason_code = no_questions`
  - `can_start = false`

This confirms unpublished/draft-only content is not startable.

### 3. Module batch access listing

Using the same rollback-only free-user test context:

- `get_module_batch_access('public-service-rules')`
  - returned batch 1
  - `state = available`
  - `is_recommended = true`

### 4. Paid user access state

Rollback-only transaction created:

- local authenticated paid test user
- completed profile
- temporary active entitlement
- temporary published `public-service-rules` batch 1 question

Result:

- `get_batch_access_state('public-service-rules', 1)`
  - `state = available`
  - `reason_code = paid_access`
  - `can_start = true`

### 5. Paid user unpublished later batch

Using the same rollback-only paid-user test context:

- `get_batch_access_state('public-service-rules', 2)`
  - `state = unavailable_not_published`
  - `reason_code = not_published`
  - `can_start = false`

This confirms paid access is still limited by published content only.

## SQL / Runtime Errors Encountered

During validation, these environment-specific issues were encountered and resolved:

1. Host `psql` was not installed in PowerShell.
   - Switched to `docker exec ... psql` against the local Supabase Postgres container.

2. Local `.temp` directory did not exist.
   - Created it for rollback-only SQL smoke scripts.

3. Local auth insert initially tried to set generated `confirmed_at`.
   - Removed that explicit column from test inserts.

4. Local auth trigger auto-created `profiles` rows.
   - Adjusted the smoke script to update the generated profile instead of inserting a duplicate.

No unresolved SQL errors remained after those fixes.

## Lint / Build

- `npm run lint` passed
- `npm run build` passed

## Safety Assessment

Based on local validation:

- the migration is applied locally
- the new RPCs exist locally
- the frontend helper calls match current RPC signatures
- free and paid batch-access smoke checks behaved correctly
- unpublished/draft batches were not exposed as startable

It is reasonable to treat the migration as locally validated.

## Is It Safe To Push Remotely?

Yes, with the normal migration workflow, after final review.

This validation does **not** push anything remotely.

## Exact Next Command If Approved

If you want to apply pending migrations to remote later:

```bash
supabase db push
```

If you want to inspect pending remote migrations first:

```bash
supabase migration list
```
