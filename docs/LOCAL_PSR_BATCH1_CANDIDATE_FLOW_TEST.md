# Local PSR Batch 1 Candidate Flow Test

## 1. Scope

This report documents a local-only candidate-flow simulation for:

- `contents/import-ready/public-service-rules.batch1.cleaned.json`

The goal was to make the reviewed Public Service Rules Batch 1 content candidate-visible in local Supabase only, then verify the real batch-start, practice, submit, and review flow using a local test candidate.

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

## 3. Before Local Simulation

Local PSR Batch 1 status/source mix before the simulation:

- `published | Development seed question - not official exam content` = `3`
- `draft | provided_client_content_reviewed_draft` = `20`
- `draft | PLACEHOLDER — sample for testing only; not a real exam question. Replace via admin before launch.` = `1`

Meaning:

- the 20 cleaned reviewed rows already existed locally as `draft`
- the 3 old PSR dev seed rows were still the only published candidate-visible PSR Batch 1 rows
- one placeholder draft row existed locally but was not candidate-visible

---

## 4. Local Simulation Changes Made

Local-only visibility changes:

- set the 20 cleaned reviewed PSR Batch 1 rows with `source_note = provided_client_content_reviewed_draft` from `draft` to `published`
- set the 3 published PSR dev seed rows with `source_note = Development seed question - not official exam content` from `published` to `draft`

Rows changed:

- cleaned reviewed rows published locally: `20`
- dev seed PSR rows hidden locally: `3`

No remote data was changed.

---

## 5. After Local Simulation

Local PSR Batch 1 status/source mix after the simulation:

- `published | provided_client_content_reviewed_draft` = `20`
- `draft | Development seed question - not official exam content` = `3`
- `draft | PLACEHOLDER — sample for testing only; not a real exam question. Replace via admin before launch.` = `1`

Candidate-visible local PSR Batch 1 total:

- published PSR Batch 1 rows = `20`

Verification result:

- cleaned PSR Batch 1 rows remaining in `draft` = `0`
- published PSR dev seed rows remaining = `0`

Meaning:

- the cleaned reviewed PSR Batch 1 is now the only candidate-visible PSR Batch 1 content locally
- the old 3-question PSR dev seed content is hidden locally

---

## 6. Local Candidate Flow Simulation

Test candidate used:

- local-only temporary user created and deleted after the test

Profile state for the test candidate:

- onboarding/profile completed
- service level set to `GL 13`
- organization set to `Federal Civil Service Commission`

### Dashboard-start state

Before starting the batch:

- `free_module_subject_slug = null`
- `has_paid_access = false`
- PSR module progress showed:
  - `has_questions = true`
  - `current_batch_number = 1`
  - `completed_attempts = 0`
  - `selected_for_free_access = false`

Expected dashboard CTA from the current frontend logic:

- `Start Batch 1`

### Start free batch state

`start_practice_batch("public-service-rules")` returned:

- question count = `20`
- batch number = `1`
- batch size = `20`
- pass mark percent = `70`
- free attempt = `true`

After start:

- `free_module_subject_slug = public-service-rules`
- `selected_for_free_access = true`

Expected dashboard CTA after confirmed start:

- `Continue Batch 1`

### Practice result

Practice batch load result:

- practice questions loaded = `20`
- batch metadata matched:
  - `Batch 1`
  - `20 questions`
  - `70% pass mark`

Undersized-dev-batch check:

- undersized note would show = `false`

Meaning:

- the old 3-question dev-batch behavior did not apply to this local PSR Batch 1 simulation

### Submit result

Submit test method:

- all 20 questions were answered using the stored correct options to verify the full pass path deterministically

Submit result:

- score = `20/20`
- score percent = `100`
- passed = `true`
- retry number = `0`
- free attempt = `true`
- next action = `unlock_full_access`

### Review result

Review query result:

- review answer rows = `20`
- batch number = `1`
- score percent = `100`
- passed = `true`
- next action = `unlock_full_access`

### Post-submit dashboard state

After submission:

- `free_module_subject_slug = public-service-rules`
- PSR module progress showed:
  - `completed_attempts = 1`
  - `last_score_percent = 100`
  - `last_batch_passed = true`

Expected dashboard CTA after passing free Batch 1:

- `Unlock full access`

---

## 7. Candidate Flow Outcome

Result:

- candidate flow passed locally for the reviewed PSR Batch 1 content

Verified outcomes:

- local reviewed PSR Batch 1 became candidate-visible
- old PSR dev seed published rows were hidden locally
- free-module lock occurred only after confirmed batch start
- practice loaded 20 questions
- review returned 20 answer cards/rows
- pass/fail calculation worked
- free-user next action after passing Batch 1 was `unlock_full_access`

---

## 8. Issues Found

- no new PSR batch-flow issue was found during this local simulation
- one placeholder draft row still exists locally for PSR Batch 1, but it remained non-published and did not affect candidate-visible content

---

## 9. Confirmation

- remote Supabase was not touched
- no new content was imported
- no remote publish occurred
- no app code, schema, or migration was changed in this task
