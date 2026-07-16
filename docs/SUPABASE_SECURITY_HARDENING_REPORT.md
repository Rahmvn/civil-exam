# Supabase Security Hardening Report

Date: 2026-07-16

Scope: Data API privileges, public RPC privileges, `SECURITY DEFINER` safety,
RLS performance, query indexes, Paystack callback construction, and local
regression verification. No remote deployment was performed.

## 1. Findings Verified Or Rejected

| Audit finding | Result | Verification |
| --- | --- | --- |
| Browser tables relied on implicit Data API grants | Verified | The clean pre-fix catalog gave `anon` and `authenticated` full DML privileges on almost every `public` table. Current Supabase guidance requires explicit grants as automatic exposure is being removed. |
| Public `SECURITY DEFINER` functions remained anonymous-callable | Verified | `ensure_my_profile`, candidate catalog/progress/payment RPCs, batch RPCs, review RPCs, support/admin RPCs, and several helpers inherited `PUBLIC` or explicit `anon` execution. |
| Core candidate query paths lacked indexes | Verified | Attempts by user/time and pack/subject/batch, review answers by user/question, published objective batches, audit-log ordering, and per-user error-rate checks lacked matching indexes. |
| `attempt_answers(attempt_id)` needed another index | Rejected | The existing unique `(attempt_id, question_id)` index already supports predicates beginning with `attempt_id`. |
| Payment, module entitlement, support, and oral response paths needed the suggested indexes | Rejected as duplicates | Existing indexes already cover `payment_orders(user_id, created_at desc)`, module access, `support_requests(user_id, created_at desc)`, practice sets, oral attempts, and oral responses. |
| RLS repeatedly evaluated `auth.uid()` / `is_admin()` and some policies targeted `PUBLIC` | Verified | The final pre-fix catalog contained 32 policies, including public-role policies on payment/module/support/error tables and unwrapped helper calls. |
| Paystack callback trusted inbound `Origin` | Verified | `initialize-paystack-payment` fell back from `APP_URL` to `request.headers.get("origin")`. |

The fixes do not change prices, entitlement decisions, free/paid progression,
published question content, answer-key behavior, or payment verification.

## 2. Migration Files

- `supabase/migrations/20260717010000_data_api_and_rpc_privilege_hardening.sql`
- `supabase/migrations/20260717020000_rls_and_query_performance_hardening.sql`

Both are forward-only migrations after the existing `20260717000000` tip. No
previous migration was edited.

## 3. Exact Table Grants

`anon` receives no table privileges in `public`.

`authenticated` receives `SELECT` on:

```text
public.profiles
public.subjects
public.exam_packs
public.attempts
public.attempt_answers
public.questions
public.oral_questions
public.admin_audit_logs
public.support_requests
public.app_error_events
```

`authenticated` receives column-level `UPDATE` only on:

```text
public.profiles(phone_number, state_code, organization_name)
```

Candidate/admin rows remain constrained by RLS. Question and oral-question
reads are admin-only under RLS; candidate practice content remains RPC-only.

No authenticated table privilege is granted on payment orders, entitlements,
module entitlements, module offerings, progression internals, practice sets,
oral attempts/responses, or submission idempotency keys.

`service_role` receives explicit `SELECT, INSERT, UPDATE, DELETE` on the trusted
Edge Function and local operational-tooling tables:

```text
public.profiles
public.exam_packs
public.subjects
public.questions
public.entitlements
public.attempts
public.attempt_answers
public.module_offerings
public.module_entitlements
public.payment_orders
public.user_module_progress
public.practice_sets
public.oral_questions
public.oral_attempts
public.oral_responses
```

Default privileges for migration-owned future `public` tables, sequences, and
functions are revoked. A transactional pgTAP probe confirms new objects remain
private until a migration grants them explicitly.

## 4. Function Privileges

Every exact public-schema function signature is first revoked from `PUBLIC`,
`anon`, `authenticated`, and `service_role`. Supported entry points are then
granted explicitly.

Authenticated candidate/shared/admin signatures (63):

```text
admin_archive_oral_question(uuid)
admin_archive_question(uuid)
admin_create_module(text,text,integer,integer,text,integer,integer,text)
admin_create_module_typed(text,text,integer,integer,text,integer,integer,text,text)
admin_create_oral_question_revision(jsonb)
admin_create_practice_set(uuid,integer)
admin_create_question_revision(jsonb)
admin_delete_draft_oral_question(uuid)
admin_delete_draft_question(uuid)
admin_delete_empty_module(uuid)
admin_delete_empty_module_v2(uuid)
admin_delete_empty_practice_set(uuid)
admin_delete_empty_practice_set_v2(uuid)
admin_get_practice_set_validation(uuid)
admin_get_practice_set_validation_v2(uuid)
admin_import_oral_questions(uuid,jsonb,text,text)
admin_import_questions(uuid,jsonb,text,text)
admin_publish_oral_question_revision(uuid)
admin_publish_question_revision(uuid)
admin_save_oral_question(jsonb)
admin_save_question(jsonb)
admin_transition_practice_set(uuid,text)
admin_transition_practice_set_v2(uuid,text)
admin_update_module(uuid,text,integer,integer,text,integer,integer,text,boolean)
admin_update_module_v2(uuid,text,integer,integer,text,integer,integer,text,boolean)
admin_update_oral_question_revision(jsonb)
admin_update_practice_set(uuid,integer)
admin_update_question_revision(jsonb)
advance_oral_attempt(uuid,uuid,text,text)
create_support_request(text,text,text,text,text)
ensure_my_profile()
get_active_oral_attempt(text,integer)
get_active_pack()
get_admin_content_modules()
get_admin_content_modules_v2()
get_admin_practice_sets(uuid)
get_admin_practice_sets_v2(uuid)
get_admin_question_counts()
get_admin_support_requests(integer)
get_attempt_review(uuid)
get_batch_access_state(text,integer)
get_candidate_summary()
get_module_access_catalog()
get_module_batch_access(text)
get_module_progress()
get_oral_attempt_review(uuid)
get_oral_attempt_state(uuid)
get_oral_practice_set_access(text)
get_payment_history(integer)
get_practice_questions(uuid,integer,integer)
get_review_queue(integer)
get_subject_performance()
has_active_entitlement(uuid)
has_active_module_entitlement(uuid,uuid)
is_admin()
record_app_error(text,text,text,integer)
save_oral_response_draft(uuid,uuid,text)
save_oral_self_rating(uuid,text)
start_or_resume_oral_attempt(text,integer,integer)
start_practice_batch(text,integer)
submit_attempt(attempt_mode,uuid,jsonb,integer)
submit_attempt_idempotent(attempt_mode,uuid,jsonb,integer,uuid)
update_support_request(uuid,text,text)
```

The only `service_role` RPC is:

```text
activate_module_purchase(text,jsonb)
```

Anonymous execution is intentionally required by no repository RPC. Internal
helpers and trigger functions retain owner execution only and are not Data API
entry points.

## 5. SECURITY DEFINER Review

The final catalog contains 81 `SECURITY DEFINER` functions and one invoker
trigger helper (`touch_updated_at`). All 81 privileged functions now have the
fixed `search_path = public, pg_temp` configuration.

The definer functions were retained in these reviewed categories:

- Candidate RPCs must read answer keys or internal progression/access tables that direct candidate table privileges intentionally cannot access.
- Admin RPCs assert `is_admin()` before performing privileged content/support actions and writing audit rows.
- Authorization helpers must bypass profile/entitlement RLS safely to avoid recursion and evaluate the caller from `auth.uid()`.
- Payment activation is service-only and runs only after server-side provider validation.
- Trigger functions maintain cross-table invariants, timestamps, lifecycle state, profile creation, and audit records.
- Internal builders/validators are not executable by API roles and are reached only from reviewed privileged entry points.

No function body, pricing rule, entitlement rule, or practice-access rule was
changed by the privilege migration.

## 6. Indexes Added

| Index | Supporting query/policy |
| --- | --- |
| `attempts_user_started_idx (user_id, started_at desc)` | Browser recent-attempt history. |
| `attempts_user_pack_subject_batch_completed_idx (user_id, exam_pack_id, subject_id, batch_number, completed_at desc)` | Module progress, latest subject score, review selection, and batch progression. |
| `attempts_subject_id_idx (subject_id)` | Subject FK checks and admin empty-module validation. |
| `attempt_answers_user_question_answered_idx (user_id, question_id, answered_at desc)` | Review queue, weak-question counts, and direct queue-attempt matching. |
| `attempt_answers_question_id_idx (question_id)` | Question FK checks and safe content deletion/revision checks. |
| `questions_pack_subject_batch_status_position_idx (exam_pack_id, subject_id, batch_number, status, batch_position)` | `start_practice_batch`, `get_practice_questions`, and published-batch discovery. |
| `admin_audit_logs_created_idx (created_at desc)` | Admin audit timeline. |
| `app_error_events_user_created_idx (user_id, created_at desc)` | Per-user hourly error-report limit. |

`CREATE INDEX IF NOT EXISTS` is used, and the clean catalog confirmed no
equivalent pre-existing index for these paths.

## 7. RLS Policies

All 32 existing application policies were recreated with unchanged command and
row predicates. The affected tables are:

```text
admin_audit_logs, app_error_events, attempt_answers, attempts, entitlements,
exam_packs, module_entitlements, module_offerings, oral_attempts,
oral_questions, oral_responses, payment_orders, practice_sets, profiles,
questions, subjects, support_requests, user_module_progress
```

Semantic equivalence:

- `auth.uid()` became `(select auth.uid())` without changing ownership comparisons.
- `public.is_admin()` became `(select public.is_admin())` without changing admin authorization.
- Policies formerly targeting `PUBLIC` now target `authenticated`; anonymous evaluation previously returned false because `auth.uid()` was null and `is_admin()` was false.
- Existing `USING` and `WITH CHECK` predicates remain in place for insert/update/all policies.
- Service-role behavior is unchanged because `service_role` bypasses RLS and now has explicit table privileges only where required.

## 8. Paystack Callback Hardening

`supabase/functions/initialize-paystack-payment/index.ts` no longer reads the
request `Origin` for `callback_url`. The shared validator in
`supabase/functions/_shared/payment-callback.js` now:

- Requires configured `APP_URL`.
- Requires an absolute HTTP/HTTPS URL.
- Rejects credentials, query strings, and fragments.
- Requires HTTPS except for explicit `localhost`, `127.0.0.1`, or `::1` development URLs.
- Builds `/payment/verify` from that trusted base.
- Returns HTTP 500 with a clear configuration error for missing/invalid server configuration.

Payment verification, webhook HMAC validation, reference ownership, amount,
currency, and entitlement activation logic were not changed. Callback query
parameters remain navigation input only and are not proof of payment.

## 9. Role Test Results

| Role/flow | Result |
| --- | --- |
| Anonymous table access | Pass: no profile, attempt, answer, or other `public` table privilege. |
| Anonymous RPC access | Pass: zero executable public-schema functions. |
| Authenticated profile | Pass: own profile read and permitted column update privileges retained; `role` is not updatable. |
| Authenticated objective candidate | Pass: start, submit, review, own-attempt isolation, idempotent submission, and progression tests. |
| Authenticated oral candidate | Pass: start/resume, draft, advance, timeout, review, self-rating, and internal-table isolation. |
| Authenticated admin | Pass: objective/oral module, set, question lifecycle, import, validation, archive/delete, audit, and support workflows. |
| Sensitive direct tables | Pass: payment orders, practice-set internals, oral attempts/responses, entitlement/access internals remain RPC-only. |
| Service payment activation | Pass: `activate_module_purchase` is service-only. |

## 10. Free/Paid Regression Results

The pgTAP progression suite confirms:

- Paid candidates retain access to all eligible published batches.
- Module purchasers receive only the purchased module.
- Free candidates can choose one module and retain the existing single retry.
- Other modules remain locked according to existing reason codes.
- Attempt review does not cross candidate ownership.
- Payment history returns normalized fulfilled/attention records through the RPC.
- Objective and oral answer guidance remains hidden until the existing review point.

## 11. Database Reset And Lint

- `supabase db reset --local --yes`: pass from an empty local database through both new migrations.
- `supabase migration list --local`: local migration history includes `20260717010000` and `20260717020000` in order.
- `npm run test:db`: pass, 7 files and 205 tests.
- `supabase db lint --local --level warning --fail-on error`: pass with no errors.

The lint command reports pre-existing warnings: volatility annotations on oral
payload/admin read functions and unused variables/parameters in admin helpers.
They were not changed because this task does not authorize behavior-affecting
function rewrites. The installed CLI is 2.78.1, so `supabase db advisors` is not
available locally (it requires 2.81.3 or newer).

## 12. Frontend And Edge Results

- `npm run test:unit`: pass, 49 tests including 5 callback validation tests.
- `npm run test:edge`: pass, including authenticated initialization, hostile `Origin`, trusted callback, lifecycle, verification, replay, fulfillment, and webhook signature checks.
- `npm run lint`: pass.
- `npm run build`: pass. Vite emits the existing advisory that the main minified chunk exceeds 500 kB.

## 13. Remote Steps Still Required

No remote command was run. Deployment should be performed in this order:

1. Configure production `APP_URL` as the trusted HTTPS application base URL.
2. Apply the two new database migrations to the target project.
3. Deploy `initialize-paystack-payment` with the shared callback helper.
4. Run remote Security/Performance Advisors with a current Supabase CLI or dashboard.
5. Smoke-test candidate profile, free/paid objective and oral flows, admin content/support, payment initialization, verification, and webhook replay.

## 14. Risks And Unresolved Questions

- Any external client not present in this repository that directly reads RPC-only tables will receive `42501` after migration and must move to a supported RPC.
- The trusted `service_role` retains explicit DML on operational tables used by Edge Functions and local tooling; its key must remain server-only.
- Existing database lint warnings should be addressed in a separate behavior-focused change with dedicated regression tests.
- The production project should be checked for extra functions/tables created outside this migration history before rollout; the local inventory can only prove repository-managed objects.

References: [Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api),
[Data API exposure breaking change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically),
and [Supabase RLS performance guidance](https://supabase.com/docs/guides/database/postgres/row-level-security#rls-performance-recommendations).
