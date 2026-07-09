# Batch Progression Implementation Plan

## Summary

Move the app from module-wide general practice to fixed batch progression while preserving the current shared question-pool rule, Paystack unlock flow, and route structure.

Updated product defaults:
- Free users do not lock a module on page visit or route entry.
- The free module locks only after the user explicitly confirms `Start free batch`.
- A free user may attempt Batch 1 of exactly one module.
- If they fail the first attempt, they may retry the same batch once.
- The retry is consumed only when the second attempt is submitted.
- If the second attempt also fails, full access is required.
- If they pass Batch 1, Batch 2 still requires full access.

Implementation should remain incremental:
- Phase 1: batch-aware data model and server resolution
- Phase 2: dashboard, practice, review, and access flow wiring
- Phase 3: content/admin maturity and reporting polish

## Key Changes

### 1. Data model and database shape

Add batch identity to questions directly.
Reason:
- A batch is a fixed set of questions.
- Retry must reuse the same question set and only reshuffle display order.
- The current importer and question model are simple enough that `batch_number` on each question is the lowest-risk fit.

Recommended schema additions:
- `questions.batch_number integer`
- `questions.batch_position integer` or `sequence_in_batch integer`
- `subjects.batch_size integer`
- `subjects.pass_mark_percent integer default 70`

Recommended `subjects.batch_size` values:
- Public Financial Management / Financial Regulations: `30`
- Public Service Rules: `20`
- Current Affairs / General Knowledge: `20`

Keep pass logic as:
- `score_percent >= 70`
or equivalent
- `correct_answers / total_questions >= 0.7`

This yields:
- PFM: `21/30` passes
- PSR: `14/20` passes
- Current Affairs / General Knowledge: `14/20` passes

Add a dedicated per-user per-module progression table:
- `user_module_progress`

Recommended fields:
- `id`
- `user_id`
- `exam_pack_id`
- `subject_id`
- `current_batch_number`
- `highest_unlocked_batch_number`
- `selected_for_free_access boolean`
- `free_first_attempt_completed boolean`
- `free_retry_consumed boolean`
- `last_attempt_id`
- `last_attempted_at`
- timestamps

Required database guarantee:
- add a unique partial index enforcing one selected free module per user and exam pack
- shape:
  - unique `(user_id, exam_pack_id)`
  - where `selected_for_free_access = true`

Extend `attempts` instead of creating a separate batch-attempt table.
Add:
- `batch_number integer`
- `score_percent integer`
- `passed boolean`
- `retry_number integer`
- `is_free_attempt boolean`

Extend `attempt_answers` with:
- `display_order integer`

Reason:
- review should preserve the exact question order seen in that attempt even when retries reshuffle the same batch

### 2. Batch authoring and import model

Store batch number on each imported question.

Importer/content changes to plan:
- add `batch_number`
- optionally add `batch_position`
- keep `service_level` optional and non-blocking
- continue mapping by `subject_slug`

Dev-seed handling:
- Existing 9 dev questions should all continue working as `batch_number = 1`
- During development, undersized Batch 1 loads are allowed
- Production validation can later enforce complete batch counts before publishing

Config location recommendation:
- `subjects.batch_size` holds module-specific batch size
- `subjects.pass_mark_percent` holds pass threshold
- do not put batch size in frontend constants once batch mode is live
- do not make exam-pack config carry batch size unless future packs truly vary by module structure

### 3. Server-side batch resolution and enforcement

Do not let the frontend infer or force batch eligibility.

Add a dedicated server-side RPC such as:
- `start_practice_batch(subject_slug text)`

Responsibilities:
- check authenticated user
- resolve active exam pack
- resolve subject by slug
- check profile/onboarding completeness
- check paid/free access
- enforce one free selected module
- lock free module only after confirmed start
- enforce Batch 1-only rule for free users
- enforce retry rules
- resolve the eligible batch number
- return the eligible batch questions shuffled

Important behavioral rule:
- passive page load must not lock the free module
- only explicit confirmed start may lock it

Recommended server flow:
- Dashboard Start click opens confirmation modal for unpaid users with no free module selected
- User clicks `Start free batch`
- Frontend calls `start_practice_batch(subject_slug)`
- RPC either:
  - selects that module for free access and returns Batch 1 shuffled
  - or rejects if another module is already the selected free module
  - or returns paid-user eligible batch normally

Recommended RPC responsibilities by user type:

Free user:
- If no module is selected for free access:
  - only `start_practice_batch` may lock one
- If selected module differs from requested module:
  - reject with friendly locked-module response
- Eligible batch is always Batch 1
- First failed attempt:
  - allow retry
  - do not mark retry consumed yet
- Second submitted attempt on the same batch:
  - mark `free_retry_consumed = true`
  - if still failed, require unlock
- If Batch 1 is passed:
  - do not unlock Batch 2 for free users
  - next step is unlock full access

Paid user:
- Resolve the current unlocked batch from `user_module_progress`
- Retry same batch until passed
- Passing batch N unlocks batch N+1

Update `submit_attempt` to:
- validate that submitted questions belong to the resolved active batch
- compute `score`, `total_questions`, `score_percent`, `passed`
- persist `batch_number`, `retry_number`, `is_free_attempt`
- write `display_order` into `attempt_answers`
- update `user_module_progress`
- unlock next batch only when passed and paid access allows progression
- consume free retry only after second submitted attempt

Update or replace `get_practice_questions`:
- it should no longer be the main entry point for deciding what batch a user may start
- either keep it as a lower-level helper or fold its behavior into `start_practice_batch`

Update `get_candidate_summary` to add batch-access state needed by the UI:
- `has_paid_access`
- `free_module_subject_id`
- `free_module_subject_slug`
- `free_batch_number`
- `free_first_attempt_completed`
- `free_retry_consumed`

Update `get_module_progress` to return:
- `current_batch_number`
- `highest_unlocked_batch_number`
- `last_batch_score_percent`
- `last_batch_passed`
- `has_questions`
- `batch_size`
- `pass_mark_percent`

Update `get_attempt_review` to return:
- `batch_number`
- `score_percent`
- `passed`
- `retry_number`
- `display_order`
- `next_action` such as:
  - `retry_batch`
  - `unlock_full_access`
  - `proceed_next_batch`
  - `back_to_dashboard`

### 4. Frontend behavior changes

Files that will need changes later:
- `src/lib/appApi.js`
- `src/pages/Dashboard.jsx`
- `src/pages/Practice.jsx`
- `src/pages/Review.jsx`
- `src/pages/Access.jsx`
- `scripts/importQuestions.mjs`
- `content/questions/*.json`
- new migrations for schema and RPC updates

Dashboard behavior:
- Replace direct Start navigation for unpaid first-time users with:
  - confirmation modal
  - explicit `Start free batch`
  - then call `start_practice_batch`
- Module cards should show:
  - current batch
  - locked/unlocked state
  - passed/latest result
  - CTA:
    - `Start Batch 1`
    - `Retry Batch 1`
    - `Continue Batch 2`
    - `Unlock full access`
    - `Coming soon`
- If a free module is already selected:
  - other modules stay visible but blocked behind unlock
- Analytics can remain lightweight in Phase 1

Practice behavior:
- Stop using fixed `QUESTION_LIMIT = 30` as the authoritative model
- Practice should render the server-resolved batch payload
- Show:
  - module name
  - current batch number
  - actual batch question count
- Dev support:
  - if Batch 1 has only 3 dev questions, load and submit normally
  - show a small note that this is the available development batch

Review behavior:
- Show:
  - batch number
  - score percent
  - pass/fail state
  - retry status
- CTA logic:
  - passed paid user: `Proceed to next batch`
  - passed free user on Batch 1: `Unlock full access`
  - failed first free attempt: `Retry this batch`
  - failed second free attempt: `Unlock full access`
  - failed paid attempt: `Retry this batch`

Access behavior:
- Replace legacy free-question emphasis with batch-based access messaging
- Show:
  - free access covers Batch 1 of one selected module
  - one retry on failure
  - full access unlocks all modules, all batches, unlimited retries, review history, and progress tracking
- Keep Paystack flow unchanged

## Phase Plan

### Phase 1 - Batch foundation
- Add `batch_number` and optional `batch_position` to questions
- Add `batch_size` and `pass_mark_percent` to subjects
- Add `user_module_progress`
- Add unique partial index for one selected free module per user/exam pack
- Extend `attempts` with batch/result fields
- Extend `attempt_answers` with `display_order`
- Update importer and JSON schema to support batch fields
- Add `start_practice_batch(subject_slug)` and make server authoritative for batch resolution
- Update `submit_attempt`, `get_candidate_summary`, `get_module_progress`, and `get_attempt_review`

### Phase 2 - User flow wiring
- Add confirmation modal before locking the free module
- Wire dashboard module CTAs to `start_practice_batch`
- Update practice page to display current batch and render undersized dev batches safely
- Update review page to show pass/retry/unlock/proceed outcomes
- Update access page copy and free-module-lock messaging
- Preserve current routes and Paystack flow

### Phase 3 - Content/admin maturity
- Add stronger importer validation for production batch completeness
- Add admin support for batch number visibility and editing
- Add richer per-batch progress and history reporting
- Retire leftover legacy free-question-count UI language once batch access is fully live

## Test Plan

### Database and RPC
- Visiting a practice route does not lock a free module
- Clicking Start on dashboard does not lock a module until user confirms `Start free batch`
- Confirmed start locks exactly one free module
- Unique partial index prevents two selected free modules for one user/exam pack
- Free user receives Batch 1 only for the selected module
- Free user cannot start Batch 1 on a second module without paying
- First failed free attempt does not consume retry
- Second submitted attempt on the same free batch consumes the retry
- If second attempt fails, unlock is required
- If free user passes Batch 1, Batch 2 still requires full access
- Paid user can retry failed batches indefinitely
- Passing Batch N unlocks Batch N+1 only
- Retry returns same question IDs with different `display_order`
- Dev batches with fewer than target batch size still load and submit correctly

### Frontend behavior
- Dashboard shows batch-aware CTAs and current-batch labels
- Dashboard uses confirmation modal before free-module lock
- Practice shows current batch number and does not assume 30 questions
- Review shows pass/fail outcome and the correct next action
- Access explains batch-based free access and paid unlock
- No copy says `questions for this level`
- Grade level remains profile identity only

### Backward compatibility
- Existing 9 dev questions work as Batch 1 after import/backfill
- Existing paid entitlement flow remains unchanged
- Existing routes remain unchanged
- No secrets move into frontend code

## Assumptions and Defaults

- Batch number should live on each question.
- Batch size and pass mark should live on `subjects`, not the exam pack or frontend constants.
- Per-user per-module progression should live in a dedicated `user_module_progress` table.
- Free module lock occurs only after explicit confirmed start.
- The first module confirmed via `Start free batch` becomes the free module lock.
- Free retry is consumed only after the second submitted attempt for that same free batch.
- Existing dev seed questions should all be treated as Batch 1 until richer content exists.
- Server-side batch resolution is authoritative; frontend should reflect server decisions, not infer unlock state.
