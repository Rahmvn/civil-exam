# Local PFM Batch 1 Candidate Flow Test

## 1. Scope

This report documents a local-only candidate-flow simulation for:

- `contents/import-ready/public-financial-management.batch1.cleaned.json`

The goal was to make the reviewed Public Financial Management Batch 1 content candidate-visible in local Supabase only, then verify the real batch-start, practice, submit, and review flow using a local test candidate.

Remote Supabase was not used or modified.

---

## 2. Local Environment Confirmation

Confirmed local Supabase API URL:

- `http://127.0.0.1:55421`

Environment safety:

- local Supabase status was read from `supabase status -o json`
- the local anon key and local service role key were used ephemerally
- the service role key was not printed
- remote Supabase was not touched

---

## 3. Before Visibility Change

Local PFM Batch 1 status/source mix before the simulation:

- `published | Development seed question - not official exam content` = `3`
- `draft | provided_client_content_reviewed_draft` = `30`

Meaning:

- the 30 cleaned reviewed rows already existed locally as `draft`
- the 3 old PFM dev seed rows were still the only published candidate-visible PFM Batch 1 rows

---

## 4. Local Simulation Changes Made

Local-only visibility changes:

- set the 30 cleaned reviewed PFM Batch 1 rows with `source_note = provided_client_content_reviewed_draft` from `draft` to `published`
- set the 3 published PFM dev seed rows with `source_note = Development seed question - not official exam content` from `published` to `draft`

Rows changed:

- cleaned reviewed rows published locally: `30`
- dev seed PFM rows hidden locally: `3`

No remote data was changed.

---

## 5. After Visibility Change

Local PFM Batch 1 status/source mix after the simulation:

- `published | provided_client_content_reviewed_draft` = `30`
- `draft | Development seed question - not official exam content` = `3`

Candidate-visible local PFM Batch 1 total:

- published PFM Batch 1 rows = `30`

Result:

- the cleaned reviewed PFM Batch 1 is now the only candidate-visible PFM Batch 1 content locally
- the old 3-question PFM dev seed content is hidden locally

---

## 6. Local Candidate Flow Simulation

Test candidate used:

- local-only user: `pfm.batch1.local.test@example.com`

Profile state for the test candidate:

- onboarding/profile completed
- service level set to `GL 13`
- organization set to `Federal Ministry of Finance`

### Dashboard-start state

Before starting the batch:

- `free_module_subject_slug = null`
- `has_paid_access = false`
- PFM module progress showed:
  - `has_questions = true`
  - `current_batch_number = 1`
  - `completed_attempts = 0`
  - `selected_for_free_access = false`

Expected dashboard CTA from the current frontend logic:

- `Start Batch 1`

### Start free batch state

`start_practice_batch("public-financial-management")` returned:

- question count = `30`
- batch number = `1`
- batch size = `30`
- pass mark percent = `70`
- free attempt = `true`

After start:

- `free_module_subject_slug = public-financial-management`
- `selected_for_free_access = true`

Expected dashboard CTA after confirmed start:

- `Continue Batch 1`

### Practice result

Practice batch load result:

- practice questions loaded = `30`
- batch metadata matched:
  - `Batch 1`
  - `30 questions`
  - `70% pass mark`

Undersized-dev-batch check:

- undersized note would show = `false`

Meaning:

- the old 3-question dev-batch behavior did not apply to this local PFM Batch 1 simulation

### Submit result

Submit test method:

- all 30 questions were answered using the stored correct options to verify the full pass path deterministically

Submit result:

- score = `30/30`
- score percent = `100`
- passed = `true`
- retry number = `0`
- free attempt = `true`
- next action = `unlock_full_access`

### Review result

Review query result:

- review answer rows = `30`
- batch number = `1`
- score percent = `100`
- passed = `true`
- next action = `unlock_full_access`

### Post-submit dashboard state

After submission:

- `trial_questions_used = 30`
- `free_module_subject_slug = public-financial-management`
- `free_first_attempt_completed = true`
- `free_retry_consumed = false`
- PFM module progress showed:
  - `completed_attempts = 1`
  - `last_score_percent = 100`
  - `last_batch_passed = true`
  - `selected_for_free_access = true`

Expected dashboard CTA after passing free Batch 1:

- `Unlock full access`

---

## 7. Candidate Flow Outcome

Result:

- candidate flow passed locally for the reviewed PFM Batch 1 content

Verified outcomes:

- local reviewed PFM Batch 1 became candidate-visible
- old PFM dev seed published rows were hidden locally
- free-module lock occurred only after confirmed batch start
- practice loaded 30 questions
- review returned 30 answer cards/rows
- pass/fail calculation worked
- free-user next action after passing Batch 1 was `unlock_full_access`

---

## 8. Issues Found

One legacy-model mismatch is still visible in summary data:

- `trial_question_limit` remains `20`
- `trial_questions_used` became `30` after one full free Batch 1 attempt

The batch flow itself still worked correctly, but this indicates an older free-question counter model is still present in summary data even though the product has moved to free-batch access.

---

## 9. Confirmation

- remote Supabase was not touched
- no new content was imported
- no database schema or migration was changed
- no app UI, frontend component, auth flow, Paystack logic, or raw content file was changed
