# Authentication Schema Relationship Audit

Date: 2026-07-18

Scope: local migrations only. No hosted data was read.

## Findings

- `public.profiles.id` references `auth.users.id ON DELETE CASCADE`.
- `public.handle_new_user()` creates the initial profile when the pending Auth user is inserted. Email verification does not create a second profile.
- `public.ensure_my_profile()` is an authenticated, idempotent recovery path and remains unchanged.
- Candidate history references the profile or Auth user through attempts, attempt answers, entitlements, module entitlements, payment orders, module progress, oral attempts, support requests, submission keys, and sanitized error events.
- Several candidate-owned relationships cascade. Deleting an Auth user can therefore remove useful test, payment, access, support, or attempt history.
- Admin content and audit relationships must also be inspected before considering an administrator disposable.

## Cleanup policy

No automatic stale-user cleanup is authorized. A future policy may expose `STALE_UNVERIFIED_ACCOUNT_AGE_DAYS`, with a product-approved value in the 7-30 day planning range. Candidates with identities, payments, access, attempts, support history, useful QA history, audit references, or admin-created content must not be automatically deleted.

Any hosted cleanup requires an approved read-only audit, backup, written row-by-row plan, and separate destructive approval. Auth and application records must be handled together; changing only `profiles.email` is not sufficient anonymization.

## Hosted audit status

The read-only script is prepared at `supabase/audit/inspect_auth_test_users.sql`. It has not been run. Its placeholder emails must be replaced only in an approved operator session. Real modules, practice sets, questions, payments, and candidate records remain untouched.
