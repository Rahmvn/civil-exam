# Batch Access Implementation Report

## Files Changed

- `supabase/migrations/20260709123000_batch_access_progression_policy.sql`
- `src/lib/appApi.js`
- `src/lib/errors.js`
- `src/pages/Dashboard.jsx`
- `src/pages/Practice.jsx`
- `src/pages/Review.jsx`
- `docs/BATCH_ACCESS_AND_PROGRESSION_POLICY.md`
- `docs/PRODUCT_BLUEPRINT.md`

## What Was Wrong Before

- Paid access was still partially tied to `current_batch_number`, which made progress behave like access control.
- Free and paid batch card states were still being inferred in the dashboard UI.
- Practice loading and submit logic were not batch-explicit for paid jump/retry flows.
- Review next-action handling was too narrow for the new batch model.
- Friendly UI behavior depended on frontend guesses more than backend state.

## Backend Changes

### New functions

- `get_batch_access_state(subject_slug, batch_number)`
- `get_module_batch_access(subject_slug?)`

### Updated functions

- `resolve_practice_batch_context_payload(...)`
- `resolve_practice_batch_context(...)`
- `start_practice_batch(subject_slug, batch_number?)`
- `get_practice_questions(subject_id, limit?, batch_number?)`
- `submit_attempt(mode, subject_id, answers, batch_number?)`
- `get_attempt_review(attempt_id?)`

## Access Policy Implemented

### Free users

- can start only `Batch 1`
- free module locks only after explicit start confirmation
- can retry the free batch once after first failure
- must unlock full access after passing the free batch
- must unlock full access after failing the retry
- cannot start another module once a free module is selected

### Paid users

- can start any published batch
- can retry any published batch
- can jump to later published batches
- recommendations use progress, but access does not require sequential passing

## Frontend Changes

### Dashboard

- now loads backend batch access rows through `getModuleBatchAccess()`
- derives module CTA/state from backend access data
- keeps free-batch confirmation before locking the free module
- links practice starts with explicit `?batch=N`

### Practice

- reloads explicit batch numbers safely
- uses backend batch resolution for the requested batch
- submits explicit `batch_number`
- keeps undersized development batches working

### Review

- handles:
  - `retry_free_batch`
  - `unlock_full_access`
  - `retry_or_next`
  - `next_batch`
  - `module_complete`
  - `review_only`
- links retry/next actions to explicit `?batch=N`

## Edge Cases Handled

- no published questions
- draft-only batches
- archived/unavailable batches
- free user visiting practice before explicit confirmation
- free user trying another module
- free user trying `Batch 2+`
- paid user with failed previous batch
- later published batches with gaps in earlier batch numbers

## Test Scenarios To Run

### Free

1. new free user can choose one module `Batch 1`
2. free module does not lock before confirmation
3. same free user is blocked from another module after selection
4. first failed free attempt returns `retry_free_batch`
5. second failed free attempt returns `unlock_full_access`
6. passing free `Batch 1` returns `unlock_full_access`

### Paid

1. paid user can start any published batch
2. paid user can retry a failed published batch
3. paid user can continue to another published batch even after a failure
4. unpaid/draft batches still show `Coming soon`

## Unresolved Risk

- The migration should be applied and verified against a local Supabase database before remote rollout.
- Existing UI still presents one primary CTA per module row rather than a full batch-grid view, so deeper per-batch navigation is recommendation-driven for now instead of exposing every batch card in the dashboard.
