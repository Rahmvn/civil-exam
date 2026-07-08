# Database reference

Current Supabase shape for the Civil Service Promotion Exam app, and how the
migration chain should be applied safely.

## Migration state

There are now **six** migration files in this repo:

| File | Purpose | Expected status on the live project |
|---|---|---|
| `20260620190000_promo_exam_v1.sql` | Base schema, RLS, exam pack seed, old placeholder subjects/questions | Already live, but not tracked remotely by the CLI |
| `20260706230000_grade_band_signup_gating.sql` | Interim server-side grade-band gating migration | May still be pending remotely |
| `20260707120000_subject_performance_rpc.sql` | Adds `get_subject_performance()` | May still be pending remotely |
| `20260707183000_service_level_app_v1.sql` | Final app restructure: service level lock, onboarding fields, 3 real modules, review/progress RPCs | New pending migration |
| `20260707213000_profile_recovery.sql` | Restores missing `profiles` rows for signed-in users | New pending migration |
| `20260708090000_dev_sample_questions.sql` | Development-only sample questions for testing practice/review/paywall flow | Manual/dev seed via migration push |

## Safe apply order

Because the base migration was applied outside normal CLI tracking, do this once before any `db push`:

```bash
supabase link --project-ref beapcfiofyrhsxwxcmyd
supabase migration repair --status applied 20260620190000
supabase db push
```

What this does:

- `migration repair` tells the CLI that the base migration is already live.
- `db push` then applies the remaining migrations in timestamp order:
  - `20260706230000_grade_band_signup_gating.sql`
  - `20260707120000_subject_performance_rpc.sql`
  - `20260707183000_service_level_app_v1.sql`
  - `20260707213000_profile_recovery.sql`
  - `20260708090000_dev_sample_questions.sql`

Do **not** skip the repair step. If you do, the CLI will try to re-run the base schema and fail on existing tables/types.

## Final model after all migrations

The app is now centered on exact account-level `service_level` identity, not client-selected grade-band filters.

### Profiles

`profiles` is created automatically from `auth.users` by `handle_new_user()`.

Important fields:

- `full_name`
- `email`
- `phone_number`
- `state_code`
- `service_level`
- `organization_name`
- `onboarding_completed_at`
- `role`

Rules:

- `service_level` is the account identity for the candidate.
- Once a non-admin user has a `service_level`, it is locked by the `protect_profile_identity()` trigger.
- Non-admin users also cannot clear `onboarding_completed_at` after setup is complete.

### Service levels

The frontend currently treats these as exact values:

- `GL 07`
- `GL 08`
- `GL 09`
- `GL 10`
- `GL 11`
- `GL 12`
- `GL 13`
- `GL 14`
- `GL 15`
- `GL 16`
- `GL 17`
- `Permanent Secretary`

This is app-level controlled today rather than a database enum.

### Subjects / modules

Candidate-facing modules are now exactly:

- `Public Financial Management (Financial Regulations)`
- `Public Service Rules`
- `Current Affairs / General Knowledge`

The old placeholder subjects are not deleted, but they are marked inactive by the final migration and should no longer appear in candidate flows.

`subjects.slug` is now used by the frontend route structure.

### Questions

`questions` keeps the core MCQ shape but now uses:

- `service_level` instead of `grade_band`
- `reference_note` for candidate-visible references
- `source_note` for internal/admin provenance

Level logic:

- `service_level is null` means the question is shared/common and can appear for any eligible candidate.
- Non-null `service_level` means the question is only for that exact account level.

Content rules:

- Only `published` questions are served to candidates.
- Published questions must include `explanation`.
- Admin audit logging still records question changes.

### Attempts and answers

`attempts.service_level` stores the caller’s locked level at submission time.

Practice is now:

- module-scoped
- level-scoped
- unseen-first
- 30 questions by default

`attempt_answers` still stores per-question correctness and time spent.

### Entitlements

The payment model is unchanged structurally:

- one active pack per user per exam pack
- Paystack reference drives activation
- active entitlement unlocks the full pack until `active_until`

## Candidate RPCs

### `get_candidate_summary()`

Returns:

- active pack details
- price
- trial limit
- used trial count
- paid access status
- access expiry

### `get_practice_questions(requested_subject_id, requested_limit default 30)`

Now:

- requires a module/subject id
- derives the caller’s `service_level` from `profiles`
- blocks practice if onboarding is incomplete
- serves only active, published questions for that subject and level
- orders questions unseen-first, then random within seen/unseen groups
- never returns the answer key

### `submit_attempt(submitted_mode, submitted_subject_id, submitted_answers)`

Now:

- derives and stores the caller’s `service_level`
- validates each answered question against the active pack, selected module, and locked level
- enforces the free-trial limit server-side
- returns review data including:
  - `correct_option`
  - `explanation`
  - `reference_note`

### `get_module_progress()`

Per active module:

- completed attempts
- mastered attempts
- last score percent
- weak-question count
- whether published questions exist for the caller’s level

Mastery is `70%+`.

### `get_review_queue(requested_limit default 12)`

Returns recently missed questions with:

- question text and options
- correct option
- explanation
- reference
- times missed
- last reviewed timestamp

### `get_attempt_review(requested_attempt_id default null)`

Returns the latest completed attempt, or a requested attempt, with full review detail for each answered question.

### `get_subject_performance()`

Still returns per-module correct and total counts, but now only across active subjects.

## Admin-facing behavior

Admins still manage the question bank directly through table CRUD plus the existing audit log flow.

Important candidate-facing changes reflected in admin data entry:

- questions should target one of the three active modules
- questions should target one exact `service_level` or be shared (`null`)
- `reference_note` is preferred for published quality

## RLS summary

The broad access model is unchanged:

| Table | Read | Write |
|---|---|---|
| `profiles` | own row, or any if admin | own row with restrictions, or any if admin |
| `exam_packs` | active packs, or any if admin | admin only |
| `subjects` | active subjects, or any if admin | admin only |
| `questions` | admin only directly | admin only |
| `entitlements` | own rows, or any if admin | admin/service-role flow |
| `attempts` | own rows, or any if admin | own rows |
| `attempt_answers` | own rows, or any if admin | own rows |
| `admin_audit_logs` | admin only | system only |

Candidates still never read `questions` directly; all candidate access goes through security-definer RPCs.

## Notes and cautions

- This document reflects the **intended final state after all six migrations are applied**.
- The development sample-question migration adds original sample MCQs for flow testing only. They are not official exam questions.
- The old `20260706230000_grade_band_signup_gating.sql` file is still part of the chain; it is not the final model, but it is safe because `20260707183000_service_level_app_v1.sql` supersedes it.
- The base seed still inserts placeholder questions in the earliest migration, but the final migration downgrades them to `draft` so they stop appearing in candidate practice.
- If you want a fully cleaner historical chain later, that is a separate migration hygiene exercise. For now, the current sequence is acceptable and should converge to the correct final schema.

## Dev flow note

To test the app end-to-end, apply the migrations so the sample questions are inserted:

```bash
supabase db push
```

The sample seed currently includes:

- published sample questions for `GL 07` across all three live modules
- a few published sample questions for `GL 08` to verify level scoping

This is enough to test:

- dashboard module availability
- practice start and question loading
- scoring and review
- explanations and references
- the free 20-question limit
- the upgrade/paywall prompt for unpaid users

To retest the 20-question limit cleanly, use a fresh test account or clear that test user's attempt data in the database.
