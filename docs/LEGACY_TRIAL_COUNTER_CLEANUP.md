# Legacy Trial Counter Cleanup

## 1. Cause of the Issue

The app has already moved to a batch-based free-access model, but one legacy summary RPC still exposed question-count trial fields:

- `trial_question_limit`
- `trial_questions_used`

That caused confusing local summary results such as:

- `trial_question_limit = 20`
- `trial_questions_used = 30`

This mismatch appeared because the old summary logic still counted submitted answers across attempts even though free access is no longer governed by a 20-question limit.

---

## 2. Files / Functions Changed

Changed:

- `supabase/migrations/20260709110000_neutralize_legacy_trial_summary.sql`

Removed:

- `src/lib/accessModel.js`

Affected database function:

- `public.get_candidate_summary()`

---

## 3. Whether an RPC Migration Was Needed

Yes.

The misleading values were produced by the database RPC itself, so a forward migration was the safest fix.

The new local-only migration keeps the summary shape stable for compatibility, but neutralizes the legacy fields by returning:

- `trial_question_limit = null`
- `trial_questions_used = null`

This avoids reinterpreting the old fields as batches and prevents the UI or future code from treating them as active product logic.

---

## 4. New Summary Behavior

After applying the local migration, `get_candidate_summary()` still returns:

- pack information
- paid-access state
- access expiry
- free-module subject info
- free first-attempt state
- free retry state

But it no longer reports misleading legacy question-count values.

Local retest confirmed:

Before start:

- `trial_question_limit = null`
- `trial_questions_used = null`

After submitting a full 30-question free Batch 1:

- `trial_question_limit = null`
- `trial_questions_used = null`

Batch-based source of truth remained intact:

- `free_module_subject_slug`
- `free_first_attempt_completed`
- `free_retry_consumed`
- paid access state

---

## 5. Local Candidate Flow Retest Result

Local Supabase URL used:

- `http://127.0.0.1:55421`

Local PFM Batch 1 visibility remained correct:

- `published | provided_client_content_reviewed_draft` = `30`
- `draft | Development seed question - not official exam content` = `3`

Retest results:

- Start free batch worked
- Practice loaded `30` questions
- Submit worked
- Review returned `30` answer rows
- Next action remained `unlock_full_access` after passing free Batch 1
- Summary no longer reported the old `20 vs 30` mismatch

---

## 6. Search Cleanup Result

Repository search terms checked:

- `trial_question_limit`
- `trial_questions_used`
- `free questions remaining`
- `free question`
- `question limit`

Current result:

- no live `src/` runtime usage remains for the old free-question counter model
- the old helper file was removed
- remaining matches are historical:
  - old migration files
  - `supabase/DATABASE.md`
  - earlier local test documentation describing the issue before cleanup
  - the new neutralizing migration itself

No active frontend batch flow now depends on the legacy question-counter model.

---

## 7. Lint / Build Result

- `npm run lint` passed
- `npm run build` passed

---

## 8. Confirmation

- remote Supabase was not touched
- no new content was imported
- no publish action was performed
- no Paystack logic was changed
- no auth logic was changed
- no app UI redesign was performed
