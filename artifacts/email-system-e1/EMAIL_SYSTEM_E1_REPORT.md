# PromotionSure Email System Phase E1 Report

Implementation date: 10 August 2026

Status: implemented and verified locally; not deployed; no external dashboard configuration changed

## Outcome

PromotionSure application email now has a durable asynchronous dispatch core. Payment, access-review, refund, and dispute business paths enqueue an immutable logical email event after authoritative business state is committed. A bounded service-only worker resolves the current Auth email, checks suppression, renders approved source-controlled templates, sends through Resend with the event identity as the provider idempotency key, and records every attempt.

Resend delivery webhooks are verified against the raw request body using the Svix signature before parsing. Delivery state, provider events, and technical suppressions are persisted independently from dispatch acceptance.

Supabase Auth email remains on its existing SMTP lane. Campaigns remain on their existing direct, admin-controlled batch path.

## Existing Components Preserved

- `transactional_email_events` remains the single logical application-email event table.
- Existing deterministic event keys remain the database and Resend idempotency identity.
- Payment/access completion remains independent of email provider success.
- Canonical payment presentation remains the source for payment email facts.
- Current conservative refund/dispute/access-review wording remains intact.
- `sendWithResend` remains available to the existing campaign subsystem through a compatibility wrapper.
- Campaign test-before-send, recipient eligibility checks, opt-out filtering, history, and admin authorization are unchanged.
- Supabase Auth SMTP and Auth templates are untouched.

## Migration

Created:

`supabase/migrations/20260810054352_e1_production_email_core.sql`

The migration evolves `transactional_email_events`; it does not create a competing outbox/job table.

New event fields include:

- `template_key`, `category`, `priority`, and immutable `payload`
- `dispatch_status` and `delivery_status`
- `recipient_email_used`
- `attempt_count`, `max_attempts`, and `next_attempt_at`
- lease token/timestamps
- accepted/delivered/provider-event timestamps
- normalized last error code and existing bounded error message

New supporting tables:

- `transactional_email_attempts`: normalized immutable attempt history
- `email_provider_events`: deduplicated normalized provider delivery events
- `email_suppressions`: local technical suppression state

All email infrastructure tables remain RLS-enabled and server-controlled. Candidate roles cannot enqueue, claim, complete, inspect, or alter events or suppression.

## State Model

Dispatch states:

- `pending`
- `processing`
- `retrying`
- `accepted`
- `cancelled`
- `dead`

Delivery states:

- `unknown`
- `sent`
- `delivered`
- `delayed`
- `failed`
- `bounced`
- `complained`
- `suppressed`

Resend API acceptance changes dispatch to `accepted`; it does not claim mailbox delivery. Webhook state changes delivery independently.

## Claiming and Leases

`claim_transactional_email_events` atomically selects a bounded due batch with `FOR UPDATE SKIP LOCKED` and changes each row to `processing` in the same transaction.

Each claim has:

- a worker-generated UUID lease token
- `leased_at`
- bounded `lease_expires_at`

A live lease cannot be stolen. An expired processing lease is reclaimable. Accepted, cancelled, and dead events are not automatically reclaimed.

`complete_transactional_email_attempt` validates lease ownership and atomically writes the attempt plus the resulting event state. A crash after an ambiguous provider request is safe because the reclaimed worker retries with the same logical/provider idempotency key.

## Retry Policy

Default maximum: 6 total attempts.

Backoff after successive failures:

- 1 minute
- 5 minutes
- 15 minutes
- 1 hour
- 6 hours

The worker honors a valid provider `Retry-After` when it requires a longer delay, bounded to six hours.

Retryable:

- explicit provider timeout
- network failure
- HTTP 429
- provider 5xx
- missing provider message ID after apparent acceptance
- temporary recipient lookup failure

Permanent:

- non-429 provider 4xx
- invalid current recipient
- unsupported/invalid template
- active technical suppression

An administrator may retry a dead event through the existing diagnostics surface. The same event key and prior attempt history are retained, and exactly one additional attempt is authorized. Retry is refused while the recipient remains suppressed.

## Provider Adapter

Shared adapter:

`supabase/functions/_shared/email/provider.ts`

It accepts provider-neutral send inputs and encapsulates:

- sender and Reply-To configuration
- Resend request shape
- deterministic `Idempotency-Key`
- bounded `AbortController` timeout
- HTTP/retry classification
- `Retry-After`
- normalized provider message ID result

Default timeout: 8 seconds. Configurable from 1 to 30 seconds through `EMAIL_PROVIDER_TIMEOUT_MS`.

Campaigns reuse the compatibility adapter but remain outside the E1 queue.

## Dispatcher

Function:

`process-email-dispatch`

Properties:

- POST only
- protected by the server-only `EMAIL_DISPATCH_SECRET`
- bounded configurable batch, default 20 and maximum 50
- sequential Resend requests, below current provider request-rate capacity
- current recipient resolved from Supabase Auth immediately before dispatch
- active local suppression checked immediately before rendering/sending
- no body, secret, or unnecessary customer data logging
- structured logs keyed by application event ID and provider message ID

Priority is persisted now. Lower numeric priority runs first. E1 transactional producers use critical priority `10`; future service/engagement mail can use lower queue precedence without schema redesign.

No permanent worker, Redis, or external queue was introduced.

## Recipient Resolution

`user_id` is the durable identity. The dispatcher resolves the current email from `auth.users` through the service-role Auth Admin API immediately before sending and records the normalized address in `recipient_email_used` after the attempt.

`profiles.email` remains useful for current admin search/display compatibility but is not the dispatch authority. E1 does not add a new Auth/profile synchronization mechanism.

## Rendering

Shared source-controlled primitives:

- `supabase/functions/_shared/email/layout.ts`
- `supabase/functions/_shared/email/render.ts`
- `supabase/functions/_shared/email/templates/payment.ts`

Every application template produces subject, preheader, HTML, and plain text. Dynamic values are escaped in HTML. The layout uses restrained email-safe table markup, inline styles, no webfonts, and no promotional hero.

Migrated template keys:

- `payment_success`
- `payment_access_issue`
- `refund_pending`
- `refund_processed`
- `refund_failed`
- `payment_disputed`
- `payment_dispute_resolved`

Payment confirmation uses the canonical payment presentation, including plan/module labels, duration, amount, module list, extension/mixed outcome facts, and canonical access date wording.

## Producer Cutover

Updated producers:

- `verify-paystack-payment`
- `paystack-webhook`
- `admin-reconcile-support-payment`

They now wait only for the durable database enqueue, never for Resend network delivery.

Event identity:

- payment confirmation: fulfilled order/provider reference
- paid access issue: authoritative order/provider reference
- refund/dispute: normalized email type plus deterministic Paystack provider-event fingerprint

Verification/webhook/reconciliation races return the same logical event. Duplicate Paystack or verification calls do not clone mail.

## Historical Cutover Policy

No historical email is made eligible for automatic resend.

At migration time:

- historical `sent` becomes dispatch `accepted`, delivery `unknown`
- historical `failed` becomes dispatch `dead`
- historical `skipped` becomes dispatch `cancelled`
- historical `pending` becomes dispatch `cancelled`

Legacy-shaped inserts default to cancelled dispatch. Only `enqueue_transactional_email_event` creates a new dispatchable `pending` event. This permits schema-first rollout without a window where an old synchronous sender and the new worker could both send.

## Resend Webhook

Function:

`resend-webhook`

Handled events:

- `email.sent`
- `email.delivered`
- `email.delivery_delayed`
- `email.failed`
- `email.bounced`
- `email.complained`
- `email.suppressed`

The raw body is read first. Svix ID, timestamp, and signature are checked before JSON parsing. Signatures older/newer than five minutes are rejected. Provider event identity is unique, so replay is safe.

Provider events use a monotonic state precedence plus provider timestamps. An older/lower `sent` event cannot overwrite `delivered`. Later permanent outcomes can supersede earlier delivery states. Every valid event remains stored even when it does not change the summary.

If a webhook arrives before worker acceptance is persisted, the provider event is initially stored uncorrelated. `complete_transactional_email_attempt` back-correlates it by provider message ID in the acceptance transaction and applies its delivery state.

Unknown legitimate provider-message events are retained without changing unrelated email jobs.

## Suppression

Local technical suppression is created or refreshed for:

- hard bounce
- complaint
- provider suppression

Suppression is distinct from `email_preferences.marketing_opted_out`. Critical transactional mail is not controlled by marketing opt-out.

A suppressed recipient is marked visibly as suppressed/cancelled and is not sent or retried indefinitely. Suppression rows are server-controlled. No candidate suppression-management UI was added.

## Admin Diagnostics

The existing diagnostics panel now distinguishes:

- Pending
- Processing
- Retrying
- Accepted
- Sent
- Delivered
- Delayed
- Failed
- Bounced
- Complained
- Suppressed
- Dead
- Cancelled

Rows expose recipient used, event/template, business/payment reference, attempts, last attempt, next retry, provider message ID, last error, dispatch/delivery state, and accepted/delivered timestamps.

A minimal Retry action is shown only for dead events. Database authorization and suppression checks remain authoritative. No Admin Email Center redesign was performed.

## Campaign Compatibility

Admin campaigns remain on their existing direct/manual batch path in E1. They reuse the timeout-capable Resend adapter, while preserving:

- test-before-send
- admin authorization
- recipient eligibility revalidation
- marketing opt-out exclusion
- campaign/recipient history
- existing provider idempotency keys

Full campaign queue migration remains E2 scope.

## Secrets and Configuration

Documented server-only variables:

- `RESEND_API_KEY`
- `TRANSACTIONAL_EMAIL_FROM`
- `TRANSACTIONAL_EMAIL_REPLY_TO`
- `EMAIL_DISPATCH_SECRET`
- `RESEND_WEBHOOK_SECRET`
- optional `EMAIL_DISPATCH_BATCH_SIZE`
- optional `EMAIL_PROVIDER_TIMEOUT_MS`

No secret is exposed through `VITE_*`, frontend code, database rows, logs, or tests.

## Required Manual Supabase Setup

Do these only during an approved production rollout:

1. Generate a long random `EMAIL_DISPATCH_SECRET` and store it as a Supabase Edge Function secret.
2. Store `RESEND_WEBHOOK_SECRET` after the Resend webhook is created.
3. Confirm existing `RESEND_API_KEY`, `TRANSACTIONAL_EMAIL_FROM`, and `TRANSACTIONAL_EMAIL_REPLY_TO` secrets.
4. Apply migrations before deploying queue producers.
5. Deploy `process-email-dispatch` and `resend-webhook` with gateway JWT verification disabled; both enforce their own service/signature authentication.
6. Deploy updated `verify-paystack-payment`, `paystack-webhook`, and `admin-reconcile-support-payment` functions.
7. In Supabase Cron, create a one-minute POST job to:
   `https://<project-ref>.supabase.co/functions/v1/process-email-dispatch`
8. Add `Authorization: Bearer <EMAIL_DISPATCH_SECRET>` through the dashboard's secure header/secret mechanism. Do not place the literal secret in a committed migration.
9. Keep the job batch bounded by `EMAIL_DISPATCH_BATCH_SIZE`; begin with 20 and adjust against observed provider/account capacity.
10. Verify the first run in Cron history, Edge logs, and Admin Email diagnostics.

Supabase Cron uses `pg_cron` and supports invoking Edge Functions: <https://supabase.com/docs/guides/cron>

## Required Manual Resend Setup

1. Create a webhook endpoint:
   `https://<project-ref>.supabase.co/functions/v1/resend-webhook`
2. Subscribe only to:
   `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`, `email.complained`, `email.suppressed`.
3. Store the returned signing secret as `RESEND_WEBHOOK_SECRET` in Supabase secrets.
4. Send a Resend test event and confirm a 200 response plus a matching `email_provider_events` row.
5. Confirm invalid-signature attempts return 401 in Edge logs.

Resend event reference: <https://resend.com/docs/webhooks/event-types>

## Verification Results

- Local migration reset: passed
- Complete database suite: 20 files, 537 tests passed
- E1 database queue/lease/provider/suppression tests: passed
- Email worker/provider/webhook integration: passed against mocked Resend
- Existing Edge payment integration: passed
- Unit tests: 137 passed
- Admin desktop + paid desktop + Access/bundle E2E: 52 passed
- Lint: passed
- Production build: passed
- Local database advisors at warning/error level: no issues found

The Resend mock covers 2xx acceptance, 429 with Retry-After, 5xx, timeout, network failure, permanent 4xx, missing message ID, and same-key retry. Webhook tests cover invalid/stale signatures, malformed signed payload, replay, sent/delivered/delayed/failed, bounce, complaint, provider suppression, unknown provider message, out-of-order state, and suppression-before-send.

## Retention

No E1 audit data is deleted automatically. Provider payload storage is normalized and minimal. A future reviewed retention policy may archive old provider-event and attempt rows while retaining logical event/payment support history; no deletion schedule is introduced now.

## Unresolved Operational Risks

- Production migration/function/Cron/webhook deployment still requires an approved operator rollout.
- DMARC external verification remains pending.
- The Resend free-plan daily/monthly limits require operational monitoring. E1 provides configurable batch capacity and priority but deliberately does not hard-code current plan limits as business rules.
- Existing campaigns still use snapshotted recipient addresses until E2 migration; their existing send-time eligibility checks remain in place.
- Provider-event retention needs a future policy after real volume is observed.

## Scope Exclusions Preserved

E1 does not add welcome, expiry, practice-result, inactivity, incomplete-checkout automation, candidate preferences/unsubscribe UI, arbitrary compose, selected-user bulk send, campaign scheduling, or an Admin Email Center redesign.
