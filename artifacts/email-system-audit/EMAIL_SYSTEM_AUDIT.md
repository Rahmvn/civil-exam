# PromotionSure Email System Phase E0 Audit

Audit date: 2026-08-09

Scope: read-only repository discovery and architecture assessment

Implementation status: no email-system code, migration, package, configuration, deployment, or provider change was made

## 1. Executive summary

PromotionSure currently has two independent email delivery lanes and one operator-driven campaign subsystem:

1. **Supabase Auth email** handles account confirmation and password recovery. The repository defines six-digit OTP behavior and version-controlled confirmation/recovery HTML, but it cannot prove the production SMTP provider, hosted templates, hosted redirect allowlist, production rate limits, or actual delivery health.
2. **Application email through Resend's HTTP API** sends payment confirmation, paid-but-access-unresolved, refund, and dispute messages. Sending is initiated inside Paystack verification/webhook Edge Functions after relevant payment state changes. Events are recorded in `transactional_email_events`, deduplicated by a unique event key, and also use the same key as Resend's provider idempotency key.
3. **Admin campaigns through the same Resend sender** support three manually prepared follow-up scenarios: incomplete checkout, practised-but-unpaid, and not-started/unpaid. Campaigns snapshot recipients, require a test send, revalidate important eligibility before each batch, send up to 25 recipients per Edge invocation, and record per-recipient outcomes.

The present system has several strong foundations worth preserving: server-only provider access, backend-derived recipients for production messages, Paystack signature verification, payment/entitlement idempotency, provider idempotency keys, database audit records, campaign test-before-send, admin authorization, recipient revalidation, opt-out-aware campaign selection, and backend-authoritative payment state.

It is not yet a production-standard email platform as a whole. The largest gaps are:

- No durable worker or automatic retry path exists for application transactional email. A claimed event that fails, is skipped, or is interrupted remains permanently claimed.
- Application email sends occur synchronously inside payment verification/webhook requests. Mail failure is isolated from payment state, but provider latency still extends those requests.
- There is no Resend delivery webhook, bounce/complaint ingestion, suppression synchronization, or delivered-state tracking.
- The current payment email detail lookup is behind the duration-pricing model. For `pricing_plan` bundle purchases it can fall back to generic `your access`; for extensions it can return no expiry because the extended entitlement retains its original `payment_order_id`.
- Successful access granted through the admin support-reconciliation function does not invoke the purchase-confirmation email path.
- The campaign system is manually advanced and manually retried. It is not scheduled automation.
- Campaign recipient revalidation checks the current profile, but delivery still uses the snapshotted `recipient_email`; profile email changes are not synchronized.
- `email_preferences` is service-role-only and no candidate-facing opt-out/unsubscribe path was found. Campaign content contains no unsubscribe link.
- Auth production delivery configuration, DNS authentication, provider suppression, and sender-domain reputation cannot be verified from this repository.
- Transactional and engagement messages share one Resend transport and sender configuration.

The provisional direction is to preserve the two-lane Auth/application split, Resend adapter, payment event keys, and campaign records, while adding a small durable application-email dispatch layer and provider event ingestion. This is provisional and depends on external checks of Supabase Auth SMTP, Resend account/domain state, DNS, volumes, and legal/product decisions about engagement consent.

## 2. Audit method and evidence status

Repository-wide discovery covered source, Edge Functions, migrations, tests, configuration examples, workflows, and operator documents. Search terms included email/mail/SMTP/providers/templates/OTP/recovery/payment/receipt/reminder/expiry/webhook/cron/queue/outbox.

Evidence labels used below:

- **Active runtime**: imported, invoked, routed, or represented by current database migrations and UI.
- **Referenced conditional**: runtime path exists but depends on environment or operator action.
- **Test-only**: assertions/fixtures, not production behavior.
- **Documentation-only**: intent or runbook statements, not proof of deployed state.
- **Not implemented**: no runtime implementation found.
- **External unknown**: cannot be established without a hosted dashboard, provider, DNS, or production log check.

Important documentation caveat: `docs/EMAIL_SYSTEM_REVIEW_AND_PLAN.md` is planning material and is partly stale. It says the Resend idempotency header and admin email diagnostics are absent, but both now exist in runtime code at `supabase/functions/_shared/transactional-email.ts:217` and `src/pages/Admin.jsx:1556`. This audit treats current code and latest migrations as authoritative.

## 3. Current architecture diagrams

### 3.1 Authentication/security email

```text
Candidate browser
  | signUp / resend / resetPasswordForEmail
  v
Supabase Auth
  | hosted Auth template + hosted SMTP configuration
  v
Recipient mailbox

Repository controls:
  local OTP settings + confirmation/recovery source templates

External controls:
  production SMTP, hosted template contents, sender, DNS, limits, logs
```

Evidence: `src/pages/Auth.jsx:169`, `src/pages/Auth.jsx:198`, `src/pages/Auth.jsx:239`, `src/pages/Auth.jsx:261`, `supabase/config.toml:45-65`, and `supabase/templates/`.

### 3.2 Payment transactional email

```text
Candidate -> initialize-paystack-payment -> payment_orders + payment_order_items
          -> Paystack checkout

Paystack charge.success webhook --------+
                                         |
Candidate PaymentVerify -> verify API ---+-> validate local order/provider payload
                                            -> record provider success
                                            -> activate_module_purchase()
                                            -> payment_order fulfilled + entitlement(s)
                                            -> claim transactional_email_events row
                                            -> Resend HTTP API
                                            -> mark sent / failed / skipped

If candidate verification sees paid-but-fulfillment-failed:
  mark fulfillment failed -> access-issue email
```

The email send is best-effort relative to business state but synchronous in the Edge request. Evidence: `supabase/functions/verify-paystack-payment/index.ts:103-142`, `supabase/functions/paystack-webhook/index.ts:95-114`, and `supabase/functions/_shared/transactional-email.ts:245-293`.

### 3.3 Refund/dispute email

```text
Signed Paystack refund/dispute webhook
  -> fingerprint event body
  -> apply_paystack_post_payment_event()
  -> unique payment_provider_events row + payment/access state transition
  -> only when event_applied = true, claim email event
  -> Resend API
```

Evidence: `supabase/functions/paystack-webhook/index.ts:58-92` and `supabase/migrations/20260720070841_paystack_post_payment_lifecycle.sql:16-261`.

### 3.4 Admin engagement campaigns

```text
Admin UI
  -> admin-only SQL: calculate scenario / snapshot recipients
  -> admin edits copy and recipient inclusion
  -> authenticated admin Edge Function sends test
  -> campaign status must be tested
  -> atomic tested -> sending claim
  -> service-role eligibility revalidation
  -> up to 25 pending recipients, sequential Resend API calls
  -> per-recipient sent/failed records
  -> admin UI invokes subsequent batches/retries manually
```

Evidence: `src/pages/Admin.jsx:1640-1830`, `src/pages/Admin.jsx:2590-2708`, `supabase/functions/admin-email-campaign/index.ts:173-323`, and `supabase/migrations/20260802101830_complete_prioritized_email_campaigns.sql`.

### 3.5 What does not exist

No runtime database trigger sends email. No application email outbox worker, Supabase Cron email job, `pg_cron` email job, Vercel Cron, provider automation, Resend webhook receiver, bounce processor, complaint processor, or candidate-facing email preferences UI was found. The scheduled GitHub workflow at `.github/workflows/quality.yml:7` runs quality/load tests, not product email jobs.

## 4. Existing email inventory

| Email/capability | Trigger | Runtime location | Sender/recipient | Transport/template | Retry/dedupe/tracking | Status |
|---|---|---|---|---|---|---|
| Account confirmation OTP | Email/password signup or resend | `src/pages/Auth.jsx:198`, `:261`; `supabase/config.toml:53-64` | Hosted Auth sender (unknown) -> signup address | Supabase Auth SMTP; `supabase/templates/confirmation.html` source | Supabase-managed; local resend cooldown/rate assumptions; hosted logs unknown | Active runtime, hosted configuration externally conditional |
| Password recovery OTP | Recovery request/resend | `src/pages/Auth.jsx:169`, `:268`; `supabase/config.toml:64` | Hosted Auth sender (unknown) -> submitted account email | Supabase Auth SMTP; `supabase/templates/recovery.html` source | Supabase-managed; hosted details unknown | Active runtime, hosted configuration externally conditional |
| Email change confirmation | Supabase config has `double_confirm_changes = true` | `supabase/config.toml:54` | Unknown | Supabase Auth hosted template | Unknown | Capability configured locally, no app email-change flow found |
| Magic link / passwordless OTP | None found | None | N/A | N/A | N/A | Not currently implemented by app |
| User invite | None found | None | N/A | N/A | N/A | Not currently implemented |
| Reauthentication email | None found | None | N/A | N/A | N/A | Not currently implemented |
| Payment confirmation | Verified payment followed by successful entitlement activation | Verify and webhook functions; shared transactional utility | Profile email; configured `TRANSACTIONAL_EMAIL_FROM` or default | Resend API; hard-coded text+HTML | Unique event key + Resend idempotency; no retry; DB diagnostics | Active, conditional on `RESEND_API_KEY` |
| Paid but access unresolved | Candidate verification catches fulfillment failure | `verify-paystack-payment/index.ts:132-142` | Profile email | Resend API; hard-coded text+HTML | Same event model; no retry | Active, verify path only |
| Refund pending/processed/failed | Newly applied signed Paystack post-payment event | `paystack-webhook/index.ts:58-84` | Profile email | Resend API; hard-coded text+HTML | Payment event and email event dedupe | Active, conditional on matching event/order/provider config |
| Dispute opened/reminded/resolved | Newly applied signed Paystack post-payment event | Same as above | Profile email | Resend API; hard-coded text+HTML | Payment event and email event dedupe | Active |
| Incomplete-checkout support check-in | Admin creates/tests/sends campaign | Admin UI, campaign Edge Function, campaign SQL | Snapshotted candidate email | Resend API; DB subject/body; text + escaped paragraph HTML | Provider idempotency per recipient; manual retry/batches; per-recipient status | Active manual engagement workflow |
| Practised-but-unpaid check-in | Admin campaign | Same | Same | Same | Same | Active manual engagement workflow |
| Getting-started check-in | Admin campaign | Same | Same | Same | Same | Active manual engagement workflow |
| Campaign test email | Admin enters test address | `admin-email-campaign/index.ts:82-159` | Admin-selected test address | Resend API | Fresh random key permits repeated tests; admin audit | Active, admin-only |
| Transactional email diagnostics | Admin opens Payments view | `src/pages/Admin.jsx:1556`, `appApi.js:858`; diagnostics SQL | N/A | Database read | Filtered/paginated, no retry action | Active read-only operator capability |
| Campaign administration/history | Admin opens Users view | `src/pages/Admin.jsx:1640+`, `appApi.js:913-984` | N/A | Database + Edge Function | Test gate, inclusion control, recipient outcomes, audit | Active |
| Welcome/onboarding automation | None | None | N/A | N/A | N/A | Not currently implemented; manual getting-started campaign is not an automated welcome flow |
| Access-expiring reminder | None | None | N/A | N/A | N/A | Not currently implemented |
| Access-expired notice | None | None | N/A | N/A | N/A | Not currently implemented |
| Product announcement/promotional campaign | No generic campaign type | None | N/A | N/A | N/A | Not currently implemented |
| Support-request notifications | None found | Support is in-app/admin queue only | N/A | N/A | N/A | Not currently implemented |

## 5. Authentication email audit

### 5.1 Verified from repository

- Email/password signup is active through `supabase.auth.signUp` (`src/pages/Auth.jsx:198`).
- Email confirmations are enabled locally (`supabase/config.toml:53`).
- Confirmation and recovery use six-digit OTPs with local expiry 3600 seconds and local max frequency one minute (`supabase/config.toml:56-58`).
- Confirmation and recovery HTML source templates are version controlled at `supabase/templates/confirmation.html` and `supabase/templates/recovery.html`.
- Both templates interpolate only `{{ .Token }}`, contain the PromotionSure logo, security copy, and a branded footer.
- Verification uses `supabase.auth.verifyOtp` with type `email` or `recovery` (`src/pages/Auth.jsx:239`).
- Recovery uses `resetPasswordForEmail`, verifies the OTP, stores a short-lived browser authorization marker, then calls `updateUser({password})` (`src/pages/Auth.jsx:169`; `src/pages/ResetPassword.jsx:52`).
- Signup/recovery resend is exposed after an application cooldown (`src/pages/Auth.jsx:258-285`). Supabase remains the authoritative send/rate-limit layer.
- OAuth callback and Auth redirect handling validate a safe `returnTo`; local callback origins are listed in `supabase/config.toml:45-49`.
- Double confirmation for email changes is enabled locally (`supabase/config.toml:54`), but no UI/API that changes a user's email was found.
- No app call to `signInWithOtp`, invite APIs, magic-link generation, or reauthentication email was found.
- Local templates are source files; repository documentation explicitly says they are not automatically synchronized to hosted Supabase (`docs/AUTH_IDENTITY_VERIFICATION_SPEC.md:34`).

### 5.2 Requires Supabase Dashboard check

- Whether production custom SMTP is configured, enabled, and healthy.
- SMTP provider, host/port, username identity, sender name/address, and whether credentials recently tested. Do not return credential values.
- Whether the hosted confirmation/recovery templates exactly match repository versions.
- Hosted templates for email change, magic link, invite, and reauthentication, even if currently unused.
- Production Site URL and complete redirect allowlist.
- Production Auth email rate limits, CAPTCHA/Turnstile enforcement, abuse controls, and recent rate-limit events.
- Recent Auth delivery errors and whether messages are being sent through Supabase default SMTP.
- The hosted project's actual `enable_confirmations`, OTP length, OTP expiry, and double-confirm settings.

Local `supabase/config.toml` is development configuration, not proof of hosted production state.

## 6. Existing provider and transport audit

### 6.1 Providers found

**Supabase Auth SMTP**

- Used indirectly by Supabase Auth. No SMTP package or direct SMTP connection exists in app code.
- Provider identity and production configuration are external unknowns.
- Repository docs recommend custom SMTP, but recommendation is not deployment evidence.

**Resend**

- Called directly with `fetch("https://api.resend.com/emails")`; no Resend SDK/package is installed (`package.json`).
- Shared adapter: `sendWithResend` in `supabase/functions/_shared/transactional-email.ts:203`.
- Required secret: `RESEND_API_KEY`.
- Optional/configured sender: `TRANSACTIONAL_EMAIL_FROM`.
- Supported but missing from `.env.example`: `TRANSACTIONAL_EMAIL_REPLY_TO`.
- Default sender: `PromotionSure <team@auth.promotionsure.com.ng>` (`transactional-email.ts:3`).
- `.env.example` instead proposes `PromotionSure <support@promotionsure.com.ng>` (`.env.example:29`). Actual deployed sender is therefore an external unknown.
- Reply-To defaults to `promotionsureapp@gmail.com` (`transactional-email.ts:4`, `:222`).
- Sends both plain text and HTML.
- Non-2xx responses throw the provider message; provider message is truncated to 500 characters when stored for transactional/campaign recipients.
- There is no explicit request timeout, abort signal, retry/backoff, or special 429 handling.
- Every real application send includes a provider idempotency key. Transactional mail uses its DB event key; campaigns use campaign+recipient. Test messages intentionally use random keys.
- No Resend webhook endpoint, delivery/bounce/complaint tracking, suppression sync, or provider-independent status adapter exists.
- `sendWithResend` is a narrow shared adapter, but table fields and campaign code name `resend` directly. Provider independence is partial.

No SendGrid, Postmark, Brevo, Mailgun, SES, Nodemailer, or other application delivery provider was found in active runtime code.

### 6.2 Environment/configuration status

`.env.example` documents `RESEND_API_KEY` and `TRANSACTIONAL_EMAIL_FROM`; it correctly keeps secrets out of `VITE_*`. `TRANSACTIONAL_EMAIL_REPLY_TO` is consumed but not documented. No actual environment values were inspected or reported.

If `RESEND_API_KEY` is missing, transactional payment mail creates an event and marks it `skipped`; campaign test/send treats the skip as an error. Payment/access state continues (`transactional-email.ts:208-209`, `:263-275`).

## 7. Current template system

### 7.1 Auth templates

- Files: `supabase/templates/confirmation.html`, `supabase/templates/recovery.html`.
- Format: HTML only in repository; Supabase may produce a text alternative externally, unknown.
- Variable: `{{ .Token }}`.
- Layout: table-based, inline CSS, max-width 520px, logo URL, responsive width behavior. Appropriate basic email HTML, though client rendering has not been demonstrated here.
- Branding: substantially more complete than application email templates.

### 7.2 Payment/review templates

- Hard-coded functions inside `transactional-email.ts:25-151`.
- Subjects:
  - `Payment confirmed for <access>`
  - `Payment received - access review needed`
  - `Refund is being processed`
  - `Refund processed`
  - `Refund could not be completed`
  - `Payment dispute under review`
  - `Payment dispute resolved`
- Variables include access/module name, amount/currency, provider reference, and expiry where available.
- Both text and HTML are generated.
- Dynamic values and copy inserted into HTML are escaped (`transactional-email.ts:6-13`).
- Templates are simple fragments with no shared branded wrapper, preheader, logo, footer primitive, or tested responsive layout.
- The phrase `Module:` is used in review emails even where a multi-module plan label may be involved.
- Critical data-model mismatch: `getPaymentEmailDetails` only treats `bundle_offer` specially and only returns a slug for `single_module` (`transactional-email.ts:351-352`). Current purchases use `pricing_plan`. A pricing-plan bundle can therefore have no subject name and fall back to `your access`.
- Extension expiry mismatch: duration extensions update an existing entitlement and retain its original `payment_order_id` while recording new order IDs in metadata (`20260808140406_duration_pricing_activation.sql:110-141`). The email lookup searches only `module_entitlements.payment_order_id = current order.id` (`transactional-email.ts:336-342`), so extension confirmation may show `Not available` for expiry.
- Multi-module expiry mismatch: the email lookup takes one entitlement with `limit(1)` rather than using the order's authoritative `access_expires_at` or presenting per-module outcomes. Mixed new-module/extension purchases can therefore show one arbitrary new entitlement expiry, while an all-extension purchase can show none.

### 7.3 Campaign templates

- Subject/body are stored in `email_campaigns` and initialized from SQL defaults in `20260802101830_complete_prioritized_email_campaigns.sql`.
- Admins can edit subject and body while draft/tested; edits reset the test gate (`20260802095125_admin_update_email_campaign_copy.sql`).
- Supported personalization is only `{{first_name}}`; fallback is `there` for recipients and `Candidate` in tests (`admin-email-campaign/index.ts:24-38`, `:95`).
- Plain text is authoritative. HTML is generated by escaping all text, splitting paragraphs, and converting line breaks (`admin-email-campaign/index.ts:40-45`). This prevents arbitrary HTML injection.
- No branded wrapper, logo, unsubscribe link, preference link, or provider-hosted template is used.
- Campaign and payment templates duplicate basic paragraph construction and do not share a layout.

## 8. Sender identity and deliverability evidence

Addresses found:

| Identity | Use | Evidence/status |
|---|---|---|
| `PromotionSure <team@auth.promotionsure.com.ng>` | Default Resend From | Active fallback in `transactional-email.ts:3` |
| `PromotionSure <support@promotionsure.com.ng>` | Proposed Resend From | Example configuration only, `.env.example:29` |
| `promotionsureapp@gmail.com` | Default Reply-To, support contact, admin test default | Runtime in shared sender and public/support UI |
| Supabase Auth From address | Auth mail | External unknown; not in local Auth config |

Auth and application sender alignment cannot be proven. Transactional and engagement campaign mail definitely share `sendWithResend` and therefore the same `TRANSACTIONAL_EMAIL_FROM` configuration. That coupling can mix reputation and suppression concerns.

### Manual external deliverability checks required

- SPF record(s) and whether there is more than one SPF TXT record.
- DKIM selectors and passing status for every sending domain/subdomain.
- DMARC policy, aggregate-report address, alignment mode, and observed pass rate.
- Resend verified-domain status and actual envelope/return-path behavior.
- Supabase Auth SMTP From/envelope domains and their SPF/DKIM/DMARC alignment.
- Existence and monitoring of the Reply-To mailbox.
- Current bounce, complaint, block, suppression, and provider rejection rates.
- Whether `auth.promotionsure.com.ng`, `promotionsure.com.ng`, or another subdomain is intended for transactional versus engagement traffic.

## 9. Payment and email integration audit

### 9.1 End-to-end payment state

1. The authenticated candidate calls `initialize-paystack-payment`.
2. Backend retrieves authoritative plan/module data and price; the client cannot define the final amount.
3. A `payment_orders` row and `payment_order_items` snapshots are created before Paystack initialization (`initialize-paystack-payment/index.ts:516-561`).
4. `checkout_key` identifies equivalent live checkout context. A partial unique index prevents multiple pending initializing/initialized rows for the same user/pack/key (`20260801144030_bundle_offers_and_multi_module_orders.sql:83-88`). Existing initialized checkout data can be resumed.
5. Paystack success arrives either through a signed webhook or authenticated candidate verification.
6. Provider data is environment/user/order/amount/currency validated, then `recordModulePaymentStatus` records provider success and marks fulfillment pending (`paystack.ts:326-380`).
7. `activate_module_purchase` locks the order and affected user/module scopes, creates or extends entitlements idempotently, and marks the order fulfilled (`20260808140406_duration_pricing_activation.sql:1-219`).
8. Only after activation returns does the success email path execute.

### 9.2 Precise answers H1-H7

**H1. Authoritative successful verification point**

Paystack transaction status `success`, obtained from the Paystack verify API or a valid signed `charge.success` webhook, after local order ownership/context/amount/currency/environment validation. `payment_orders.provider_status = 'success'` and `paid_at` record that fact. A signed event without a local order is ignored (`paystack-webhook/index.ts:116-122`).

**H2. Authoritative access-granted point**

Successful completion of service-role SQL function `public.activate_module_purchase`, which creates/extends all relevant `module_entitlements` and updates the order to `status='active'`, `fulfillment_status='fulfilled'` (`20260808140406_duration_pricing_activation.sql:200-218`). Access checks also require entitlement `status='active'` and `expires_at > now()`.

**H3. Can payment be successful while access is unresolved?**

Yes. `provider_status='success'` can coexist with `fulfillment_status='pending'` or `'failed'`. The candidate and admin attention flows explicitly represent this.

**H4. What drives `Payment needs attention` on `/access`?**

`get_payment_history` assigns `record_type='attention'` for refund pending/disputed, processing provider states, or provider success with fulfillment not fulfilled (`20260808140406_duration_pricing_activation.sql:274-280`). Frontend `partitionPaymentRecords` uses that record type (`src/lib/paymentDisplay.js:99`).

**H5. Is that state suitable as an immediate email trigger?**

Not as one undifferentiated trigger. Processing states (`ongoing`, `pending`, `processing`, `queued`) may be temporary and belong to normal payment convergence. Paid-but-fulfillment-failed is materially different and is appropriate for an access-issue message. Refund/dispute states already use provider events. A future trigger must distinguish categories and apply delay/state rechecks.

**H6. Are verification/webhooks idempotent?**

Largely yes for business state:

- `activate_module_purchase` row/advisory locks the order and module scopes and records applied duration-plan order IDs, preventing repeated extension (`20260808140406_duration_pricing_activation.sql:74-141`).
- Provider references are unique.
- Equivalent live checkout initialization uses `checkout_key` and a partial unique index.
- Refund/dispute event body hashes and provider-object uniqueness dedupe post-payment events (`20260720070841_paystack_post_payment_lifecycle.sql:16-37`, `:120-142`).
- Email event keys and Resend idempotency keys prevent duplicate same-type/reference sends.

The plain charge-success webhook itself does not create a `payment_provider_events` row, but idempotent activation and email event keys protect repeated delivery.

**H7. Risks of direct email attachment**

- Duplicate email: controlled for current event types by DB and provider idempotency.
- Payment latency: yes; Resend is awaited synchronously after business state. There is no timeout.
- Mail outage causing payment failure: candidate verification catches/absorbs email outcomes. Transactional sender itself converts provider exceptions into a failed result. Webhook success email therefore does not make fulfilled state roll back, but a stalled fetch can delay webhook response.
- Transactional inconsistency: possible in email tracking. A crash after event claim but before send leaves `pending` permanently; a crash after provider acceptance but before status update leaves a pending record. There is no recovery worker.

Additional gap: webhook fulfillment failures are marked and returned as webhook failure, but the access-issue email is only sent by the candidate verification catch path. If the candidate never verifies and activation keeps failing, no access-issue message is emitted by the webhook path.

Admin support reconciliation (`supabase/functions/admin-reconcile-support-payment/index.ts`) can verify a previously unresolved order and call `activateModulePurchase`, but it does not call `sendPaymentSuccessEmail`. Access can therefore be granted through that authoritative recovery path without a confirmation email event.

Post-payment bundle nuance: `apply_paystack_post_payment_event` was originally written against a single `target_entitlement`. Full refunds and accepted disputes update all rows by `payment_order_id`, but dispute creation/reminders pause only that selected entitlement (`20260720070841_paystack_post_payment_lifecycle.sql:143-193`). For a multi-module order, payment review state is order-wide while access pausing can be only one module. This is primarily a payment/entitlement correctness issue, but email copy that says module access may be paused cannot reliably summarize the full bundle until the underlying behavior is clarified.

## 10. Incomplete/abandoned payment handling

Repository data can distinguish:

- **Initialized/preparing**: `payment_orders.status='pending'`, `provider_status='initializing'` or `'initialized'`.
- **Provider processing**: `ongoing`, `pending`, `processing`, `queued`.
- **Final unsuccessful**: `abandoned`, `cancelled/canceled`, `declined`, `failed`, `reversed`, `timeout`; recorded by verification/webhook where observed.
- **Provider successful**: `provider_status='success'`, `paid_at`.
- **Successful and fulfilled**: order active + fulfillment fulfilled + entitlement(s).
- **Successful but unresolved**: provider success + fulfillment pending/failed.

The order includes user, reference, purchase target/snapshot, amount/currency, creation/update/provider-check timestamps, and the user profile provides an email. Equivalent live attempts share a deterministic `checkout_key` and may be resumed. Different targets/durations can create separate simultaneous attempts. There is no explicit parent attempt/session that links all of a user's different checkout attempts.

The current manual payment-check-in campaign identifies users with at least one pending initializing/initialized/processing order whose latest checkout is 30 minutes to 30 days old (`20260802101830_complete_prioritized_email_campaigns.sql:142-224`). It excludes paid/access-owning/opted-out/internal/recently-contacted users. It does **not** send automatically.

A genuine future incomplete-payment follow-up should additionally:

- Re-verify or age/converge provider state before contact, rather than treating every stale local pending state as abandonment.
- Collapse multiple attempts per user and identify the most relevant recoverable checkout.
- Exclude paid, active access, refunded/disputed, final failed/declined transactions, and internal/test accounts.
- Apply a deliberate delay, frequency cap, preference/suppression check, and idempotent campaign/event key.
- Decide whether a checkout URL remains safe/valid; current campaign copy only offers support and does not embed a resume token.
- Re-evaluate the exact segment immediately before send, not merely paid/access/opt-out status.

## 11. Entitlement and expiry model

- Authoritative per-module expiry is `module_entitlements.expires_at`; effective active access requires `status='active'` and expiry in the future.
- A duration-pricing order also stores `payment_orders.access_starts_at` and the maximum resulting `access_expires_at` for order/history display.
- Modules in the same purchase can have different expiry dates because an existing entitlement extends from `greatest(now(), existing.expires_at)` while a new module starts from now (`20260808140406_duration_pricing_activation.sql:110-166`).
- Extension is idempotent by storing applied pricing-plan order IDs in entitlement metadata.
- Complete and Pick N purchases operate on authoritative `payment_order_items`; each module is processed separately.
- Legacy non-duration purchases can use the exam-pack `active_until` model; legacy full-access entitlements remain represented separately.
- No scheduler was found that changes a row from active to expired when time passes. Expiration is enforced at query time by `expires_at > now()`. Therefore row `status='active'` alone is not enough.

The database already contains the essential facts for future expiring/expired messages: user, subject, expiry, status, and order metadata. What is missing is notification state/dedupe, preference/suppression policy, timezone/send-window policy, scheduling, and careful handling of per-module versus grouped expiry. Query logic must use effective access and avoid notifying about an older entitlement when a newer overlapping entitlement exists.

## 12. Practice/activity data

Existing data can establish:

- Objective first/last start from `attempts.started_at`.
- Objective completion from `attempts.completed_at`.
- Question activity from `attempt_answers.answered_at`.
- Objective retry/progression context from attempts and `user_module_progress`, including `last_attempted_at`, `last_attempt_id`, free-attempt completion, and retry-consumed flags (`20260708133000_batch_progression_phase1.sql:158-170`).
- Oral first/last activity from `oral_attempts.started_at/updated_at/completed_at` and response timestamps/status (`20260715150000_oral_practice_foundation.sql:65-127`).
- Per-module aggregate progress through existing progress RPCs.
- Whether a user returned after starting can be inferred from multiple attempts or later answer/attempt timestamps, but there is no explicit product-session/return event.

The current campaign segmentation uses counts and `max(completed_at/updated_at/started_at)` across objective and oral attempts (`20260802101830_complete_prioritized_email_campaigns.sql:121-174`). This is sufficient for a coarse manually reviewed `practised recently but unpaid` segment.

Missing for responsible automated behavioral follow-up:

- Explicit lifecycle event/eligibility history and notification dedupe.
- Reliable distinction between deliberate pause, abandoned practice, completed batch, and a session affected by technical failure.
- Send-window/frequency policy and candidate consent/preferences.
- A single normalized `last_meaningful_practice_activity` definition shared across objective/oral modes.
- Evidence of user return attributable to a message.

## 13. Scheduling and background jobs

No production product-email scheduler was found.

- No Supabase Cron or `pg_cron` email job appears in migrations.
- No scheduled Edge Function invocation is configured.
- No Vercel Cron configuration was found.
- `.github/workflows/quality.yml:7-8` has a nightly cron, but it runs repository tests/load checks only. It has no email responsibility and no production application credentials for email dispatch in the workflow.
- Payment email is event-driven inside Edge requests.
- Campaign sending is operator-driven from Admin. The UI loops up to ten Edge invocations to advance 25-recipient batches (`src/pages/Admin.jsx:2673-2683`).

Campaign batch execution has campaign-level mutual exclusion and recipient provider idempotency. There is no scheduler monitoring, stalled-job recovery, lease expiry, or automatic retry policy.

## 14. Reliability assessment

| Property | Rating | Repository evidence and exact limitation |
|---|---|---|
| Durable | Partial | Transactional events and campaign recipients persist. Transactional sends are not queued; a pending claim has no worker/recovery lease. |
| Asynchronous | Missing | Resend is awaited in payment/webhook requests; campaigns are awaited in admin requests. |
| Retryable | Partial | Campaign failed recipients can be manually reset/retried. Transactional failed/skipped/pending events cannot be reclaimed because `event_key` remains unique. |
| Idempotent | Good | Unique event key plus Resend `Idempotency-Key`; campaign per-recipient keys; idempotent payment activation and post-payment event keys. |
| Observable | Partial | Admin transactional diagnostics and campaign recipient states exist. No provider delivery/bounce/complaint events or alerts. |
| Provider-independent | Partial | Shared `sendWithResend` is a narrow adapter and DB has a provider column, but URL/result semantics and campaign status writes are Resend-specific. |
| Secure | Good | Provider secret is server-only; production recipients are backend-derived; admin route checks JWT and profile role; email tables are service-role-only. |
| Suppressible | Partial | Campaign selection/revalidation checks `email_preferences.marketing_opted_out`; no candidate write path, global/provider suppression, or transactional suppression policy. |
| Testable | Partial | Source tests, DB pgTAP coverage, Auth mocked E2E, campaign UI paths. No mocked Resend behavioral integration for timeout/429/webhooks found. |
| Auditable | Good/Partial | Email event, campaign recipient, and admin audit records exist. Transactional events omit retry history and delivery outcomes; campaign audit writes are best-effort. |

## 15. Failure-mode analysis: behavior today

| Failure/event | Current behavior |
|---|---|
| Provider times out | No explicit timeout. Fetch waits until platform/network termination. If fetch rejects, transactional event becomes failed; campaign recipient becomes failed. A process-level termination can leave pending/sending state. |
| Provider returns 429 | Treated as a generic non-2xx. No `Retry-After` handling/backoff. Transactional event becomes failed and cannot retry; campaign recipient can be manually retried. |
| Provider returns 500 | Same as 429. |
| Recipient hard-bounces | Provider may accept initial API request, so local state becomes sent. No webhook ingestion; bounce is not reflected locally. **Not handled.** |
| Recipient reports spam | No complaint webhook/suppression ingestion. **Not handled.** |
| Payment webhook retries | Payment activation is idempotent; success email event key prevents duplicate send; post-payment event fingerprint prevents duplicate state/email. |
| Payment verification runs twice | Reuses order; activation recognizes applied order; same email event key prevents duplicate. |
| Entitlement succeeds but email fails | Entitlement remains fulfilled. Email event records failed/skipped; user receives no automatic retry. Correct business isolation, incomplete communication recovery. |
| Email succeeds but process crashes before recording success | DB event may remain pending. No recovery. If a future retry were added with same key, Resend idempotency could suppress duplicate, but no current retry path exists. |
| Process crashes after claim before provider call | Event remains pending and unique, permanently blocking current send path. **Not handled.** |
| Campaign process crashes while status is sending | Outer catch only runs for caught exceptions in the same process. Hard termination can leave campaign `sending`; no lease/reaper. **Not handled.** |
| Scheduled job executes twice | No email scheduler exists. For a hypothetical duplicate campaign invocation, tested->sending claim allows one; for transactional event, unique event key allows one. |
| User changes email | No app email-change flow/sync trigger found. Transactional lookup uses `profiles.email`; campaign sends to snapshotted address even though revalidation checks current profile. **Partially/not handled.** |
| Two payment attempts exist simultaneously | Same checkout key is resumed/uniquely constrained; different checkout keys may coexist. Payment and emails are keyed by provider reference, so each genuine successful order can produce its own confirmation. Campaign logic collapses eligibility at user level but does not model attempt relationships. |
| Resend secret missing | Transactional event marked skipped without affecting payment; campaign test/send fails visibly. No automatic recovery after secret restoration. |
| Email event DB insert fails | Send is not attempted; caller's surrounding email catch prevents payment rollback in current paths. No retry. |
| Email status update fails after provider accepted | Error bubbles into sender catch, which attempts another status update; that can also fail. Provider idempotency protects repeat provider calls only if one is later attempted. No current recovery. |
| Webhook fulfillment fails | Order becomes fulfillment failed and webhook returns error, allowing provider retry. No access-issue email from webhook path; candidate verify path can send one later. |

## 16. Security audit

### 16.1 Positive controls

- Application provider secrets are Edge Function environment variables, not browser variables (`.env.example:24-30`).
- `admin-email-campaign` has `verify_jwt=false` at the platform config level but authenticates the bearer token in code and separately checks `profiles.role='admin'` (`admin-email-campaign/index.ts:48-60`, `:331-337`). This pattern is intentional for current JWT compatibility but must remain tested.
- Non-test production recipients and campaign copy originate from service-role database reads; ordinary candidates cannot choose recipients, subjects, or HTML.
- An admin can choose a test recipient and edit campaign subject/plain text by design. HTML is escaped.
- `transactional_email_events`, `email_preferences`, `email_campaigns`, and recipients have RLS and are revoked from anon/authenticated; service role access is isolated in Edge Functions/RPCs.
- Admin SQL RPCs call `public.is_admin()` and system revalidation is service-role-only.
- Paystack webhook HMAC signature is verified over the raw body before parsing/processing (`paystack-webhook/index.ts:45-54`; `payment-validation.js:168`).
- Post-payment webhook replays are deduplicated by body fingerprint and provider object keys.
- Paystack success must match a locally created order and validated metadata; an arbitrary signed success event is insufficient.
- Provider payloads are sanitized before storage; unit tests cover sensitive Paystack fields.

### 16.2 Risks and limitations

- Error messages returned by Resend can be stored and shown in admin diagnostics. They are bounded but not normalized; verify they never include provider-sensitive details.
- Admin audit metadata records test recipient email. This is restricted operational PII, not a public leak, but retention/access policy is undefined.
- Transactional diagnostics expose recipient email, payment reference, provider message ID, and errors to admins. Appropriate authorization exists; retention and least-privilege operator policy are external/process questions.
- Provider errors and payment references are logged to Edge logs. No full email body or provider secret is logged in reviewed code.
- `profiles.email` is copied on user creation. No auth-user email-update sync trigger was found. This can create stale-recipient and identity-consistency risk if email change is enabled externally.
- Campaign opt-out data cannot be set by candidates through any found runtime path. An operator/service role could set it, but that is insufficient for scalable engagement compliance.

No open email-relay path for arbitrary candidates was found.

## 17. Deliverability readiness

| Area | Repository conclusion |
|---|---|
| Sending domain | Candidate domains are referenced, but deployed From is unknown because environment overrides code default. |
| SPF/DKIM/DMARC | External unknown. No DNS evidence in repository. |
| From alignment | External unknown for both Auth SMTP and Resend. |
| Reply-To | Runtime defaults to `promotionsureapp@gmail.com`; mailbox existence/monitoring unknown. |
| Transactional vs engagement separation | Missing in code: both application classes share one From/transport. Auth may be separate, externally unknown. |
| Bounce handling | Missing locally. |
| Complaint handling | Missing locally. |
| Suppression | Partial campaign DB opt-out; no provider suppression sync or candidate management. |
| Unsubscribe | Missing from campaign content and candidate UI/API. |
| Delivery-status tracking | API acceptance only (`sent` means accepted by Resend), not delivered. |
| Reputation monitoring | External unknown. |

The repository cannot establish production deliverability merely from the presence of sender addresses or successful API acceptance.

## 18. Email classification and preference implications

| Email | Classification | Present? | Preference/suppression implications |
|---|---|---|---|
| Account confirmation | Authentication/security | Yes | Must not depend on marketing opt-out; provider safety suppression still matters. |
| Password reset | Authentication/security | Yes | Same; security/rate-limit controls are primary. |
| Email change / reauthentication | Authentication/security | Config capability/no app flow | Same. |
| Purchase confirmation | Transactional | Yes | Expected consequence of purchase; not marketing opt-out, but hard-bounce/global suppression must be honored safely. |
| Paid-but-access-problem | Transactional/service-critical | Yes | Must be delivered where possible; should not be blocked by marketing opt-out. |
| Refund/dispute updates | Transactional/service-critical | Yes | Same. |
| Welcome/getting started | Service/lifecycle or engagement depending copy/timing | Manual campaign only | Should have clear preference and frequency policy; consent/legal basis must be reviewed. |
| Incomplete-payment follow-up | Service/lifecycle or engagement | Manual campaign | Not a payment receipt. Requires opt-out, suppression, careful eligibility, frequency cap, and non-coercive copy. |
| Started-practising follow-up | Engagement | Manual campaign | Requires preference/opt-out and frequency safeguards. |
| Access expiring | Service/lifecycle | No | Usually service-relevant; still needs notification preference policy and dedupe. |
| Access expired | Service/lifecycle | No | Same; avoid repeated sales pressure without consent. |
| Product announcements | Marketing/promotional | No | Requires explicit marketing rules, unsubscribe, suppression, and likely sender/reputation separation. |
| Promotional campaigns | Marketing/promotional | No | Same, with strongest consent/compliance requirements. |

`marketing_opted_out` currently governs all three manual follow-up scenarios. A final model may need more precise preference categories without allowing users to suppress security or critical transaction messages.

## 19. Does PromotionSure need an outbox/queue?

### Option 1: keep the current architecture

Improve templates/configuration only and continue sending inline.

- Advantages: least change; existing dedupe and diagnostics remain.
- Consequences: no automatic recovery, payment/webhook latency remains coupled to Resend, pending-event crash windows remain, no scheduled lifecycle emails, and provider outages lose messages.
- Assessment: suitable only for a deliberately best-effort email posture, not the requested production-standard reliability.

### Option 2: enhance the current architecture without a full outbox

Add bounded provider timeouts, an admin retry action for failed/skipped/pending transactional events, retry metadata, and provider webhooks while leaving initial sends inline.

- Advantages: small migration; preserves current functions/table and can repair many operational gaps.
- Limitations: operator-dependent recovery; payment functions still do email work; no clean scheduler/lifecycle dispatch model; process-crash windows require careful reclaim semantics.
- Assessment: plausible short-term hardening if volumes are very low and operational manual retry is acceptable.

### Option 3: durable database outbox

Write an email job/event transactionally after authoritative business state, then let a scheduled/worker Edge Function claim leases and dispatch through the provider adapter.

- Solves here: decouples Paystack latency, durable retries/backoff, crash recovery, a common path for payment/lifecycle mail, clear attempt history, and safe scheduled eligibility jobs.
- Complexity: schema/worker/lease design, scheduler credentials, retry policy, dead-letter/operator controls, provider webhook mapping, retention, and more tests/monitoring.
- Existing `transactional_email_events` is close to a dedupe/audit ledger but is not currently a queue: it lacks next-attempt, retry count, lease/claim expiry, and reclaim semantics.
- Assessment: justified if payment communications are expected to be reliable and lifecycle automation is approved; it can remain small rather than becoming a general messaging platform.

### Option 4: provider-owned queue/automation

Use provider workflows/audiences/automation for some lifecycle engagement while app sends transactional events.

- Advantages: provider-managed scheduling, suppression, delivery analytics, and lower worker code.
- Trade-offs: business eligibility/data synchronization leaves the authoritative database, harder local audit/reproducibility, vendor lock-in, privacy/governance work, and risk of stale payment/access state.
- Assessment: potentially useful for marketing/engagement later, but payment/access-triggered email should remain driven by PromotionSure's authoritative state.

## 20. Provider strategy assessment

### Requirements before comparing vendors

- Transactional HTTP API and, if one provider is desired, SMTP support compatible with Supabase Auth.
- Verified domains, SPF/DKIM/DMARC guidance, aligned return path.
- Stable idempotency semantics.
- Delivery, bounce, complaint, and suppression webhooks.
- Global and category suppression controls.
- Raw HTML + text support; templates are optional.
- Searchable logs and adequate retention/export.
- Reliable delivery to PromotionSure's Nigerian user base across major mailbox/mobile providers.
- Current-scale pricing and a credible growth path.
- Appropriate data processing/security terms and operational support.

### What current Resend integration demonstrably satisfies

- HTTP transactional API.
- Raw HTML and plain text.
- Provider idempotency header.
- API response message ID.
- Configurable From and Reply-To.
- Shared use by payment and manual campaigns.

Repository evidence cannot prove domain authentication, SMTP availability/configuration for Auth, webhook quality, suppression behavior, actual deliverability, account limits, pricing, support, retention, or Nigerian inbox performance.

Comparisons with Resend's current offering or alternative providers are **REQUIRES EXTERNAL RESEARCH**. No provider replacement is justified from repository evidence alone.

## 21. Final-system capability specification

### Must have before calling email production-standard

- Verified production Auth SMTP and hosted Auth templates, URLs, rate limits, and abuse protection.
- Durable, non-blocking delivery for purchase confirmation and paid-but-access-problem communication.
- End-to-end idempotency across business event, dispatch attempt, and provider.
- Bounded timeouts plus automatic retry/backoff and dead-letter/operator recovery.
- Correct current purchase-plan/module/extension labels and authoritative expiry data.
- Provider delivery/bounce/complaint webhook ingestion and suppression handling.
- Clear distinction between accepted, delivered, bounced, complained, suppressed, failed, and skipped.
- Operator search/visibility, retry controls, alerting, and retention policy.
- Server-only secrets and backend-authoritative recipients/content for transactional mail.
- Tested templates with escaped interpolation and text alternatives.
- Candidate-accessible opt-out/unsubscribe for engagement/marketing mail; security/transactional categories separated.
- Eligibility recheck immediately before lifecycle/engagement sends.

### Important soon

- Access-expiring and access-expired notifications with per-module grouping and dedupe.
- Safe incomplete-payment follow-up with provider convergence, attempt collapse, delay, cap, and preferences.
- Welcome/onboarding and practice follow-up based on normalized lifecycle facts.
- Shared branded email layout primitives and preview/render tests.
- Sender/reputation separation for transactional versus engagement traffic where provider/DNS research supports it.
- Normalized email address source synchronized with Auth changes.
- Metrics for send latency, retry backlog, failure rate, bounce/complaint rate, and time-to-recovery.

### Nice to have later

- Provider abstraction beyond the existing narrow adapter if replacement/failover becomes a real requirement.
- Controlled product announcement/marketing tooling.
- Experimentation/attribution for engagement messages with privacy controls.
- Provider-owned automation for low-risk marketing journeys if authoritative eligibility synchronization is solved.
- Localization and candidate timezone-aware delivery windows.

## 22. Current versus required gap matrix

| Capability | Current implementation | Quality | Needed behavior | Gap | Priority | Risk if unchanged |
|---|---|---|---|---|---|---|
| Auth SMTP | Supabase-managed, local source config | Unknown | Verified custom production SMTP and logs | External/deployment unknown | Critical | Signup/recovery delivery failure |
| Auth templates | Confirmation/recovery source HTML | Partial | Hosted parity and all used security templates | Hosted state unknown | Critical | Broken/inconsistent OTP UX |
| Payment confirmation | Inline Resend after activation | Partial | Durable, asynchronous, retryable | No worker/retry | Critical | Paid users miss receipts |
| Access-problem notice | Verify path only | Partial | Trigger from authoritative unresolved fulfillment regardless of callback path | Webhook-only failure gap | Critical | Paid user receives no warning |
| Reconciled-payment confirmation | None in admin reconciliation | Missing | Successful recovery should enter the same deduped confirmation event path | Reconciliation bypasses email | High | User gets access without confirmation |
| Duration/extension receipt data | Legacy-oriented detail lookup | Defective for current model | Authoritative plan label and resulting expiry | `pricing_plan`/extension mismatch | Critical | Misleading/generic receipts |
| Dedupe | DB unique key + provider key | Good | Preserve with retry-safe state machine | Reclaim design absent | Critical | Retry cannot be added safely without design |
| Retry | Campaign manual only | Missing/Partial | Automatic bounded backoff + operator replay | Transactional permanently claimed | Critical | Provider blip loses messages |
| Dispatch isolation | Inline in Edge requests | Missing | Business request commits/enqueues quickly | Provider latency coupling | High | Slow/time-out webhook/verify |
| Delivery tracking | API acceptance/message ID | Partial | Delivered/bounced/complained/suppressed | No provider webhook | High | False `sent` confidence |
| Suppression | Campaign marketing opt-out | Partial | Provider/global + category preferences | No sync/user path | High | Repeated unwanted/invalid mail |
| Unsubscribe | None | Missing | One-click/manage link for engagement/marketing as required | No candidate route/token | High | Compliance/trust risk |
| Campaign eligibility | Strong snapshot + partial revalidation | Partial/Good | Exact scenario and current address recheck | Stale snapshot address; broad recheck | High | Wrong/outdated recipient context |
| Campaign execution | Admin batches of 25 | Partial | Reliable job orchestration if retained | Browser/operator-driven | Medium | Stalled/partial campaigns |
| Templates | Escaped but fragmented | Partial | Shared branded tested primitives | Duplication/inconsistent brand | Medium | Poor UX/client rendering |
| Expiry lifecycle | Data available | Not implemented | Scheduled, deduped, preference-aware reminders | No jobs/events | Medium | Users lack useful notice |
| Practice lifecycle | Coarse activity facts | Partial | Responsible normalized eligibility | No event history/preferences | Medium | Mistimed/noisy follow-up |
| Observability | Admin DB views | Partial | Alerts, provider events, retry backlog | No alerting/delivery state | High | Failures discovered late |
| Sender strategy | Auth unknown; app mail shared | Partial/Unknown | Verified aligned identities and reputation policy | External + separation unknown | High | Deliverability/reputation coupling |
| Email identity sync | Profile snapshot at account creation | Partial | Current verified address source | No update sync found | High | Mail sent to stale address |
| Security | Server-only/admin controls | Good | Preserve and regression-test | Minor retention/error-normalization gaps | Critical preserve | Relay/data exposure if weakened |

## 23. Components to preserve

- The separation between Supabase Auth security mail and application mail.
- `sendWithResend` as a small server-only provider adapter, unless external research gives a concrete replacement reason.
- Plain text plus HTML on every application send.
- HTML escaping and campaign plain-text-authoring model.
- Backend-derived transactional recipient and backend-administered live campaign recipient lists.
- `transactional_email_events.event_key` and Resend idempotency keys.
- Payment provider references and post-payment event fingerprinting.
- Idempotent, locked `activate_module_purchase` and its extension order tracking.
- Payment/business completion independent of email success.
- Admin transactional diagnostics and campaign per-recipient records.
- Campaign test-before-send, tested->sending atomic claim, 25-recipient bound, and eligibility revalidation.
- Paid/access/internal/opt-out/cooldown campaign exclusions.
- RLS/revokes, service-role isolation, admin checks, webhook signature validation, and sanitized payment payloads.
- Repository-owned Auth confirmation/recovery template source, while adding a hosted parity process later.

## 24. Components needing improvement or likely replacement

### Transactional claim-and-send state machine

Current behavior inserts a permanently unique event before inline delivery. Failure, missing config, or crash does not produce a reclaimable job.

Risk: silent permanent loss and misleading pending status.

Assessment: preserve event identity/audit fields, but the state transition/dispatch mechanism likely needs replacement with lease/retry semantics. Incremental repair is possible if the table is evolved carefully.

### Payment email detail projection

Current behavior assumes legacy `single_module`/`bundle_offer` relationships and current-order entitlement ownership.

Risk: generic plan labels and missing extension expiry.

Assessment: should be replaced with an authoritative projection aware of `pricing_plan`, `payment_order_items`, `purchase_label`, `access_expires_at`, and extension metadata. This is a narrow correctness repair, not a new email architecture.

### Inline dispatch from payment functions

Current behavior awaits provider API after fulfillment.

Risk: latency/timeouts and no durable recovery.

Assessment: if production-standard delivery is required, replace inline send with durable enqueue plus independent dispatch. Business event timing and current dedupe keys should remain.

### Campaign address snapshots and eligibility revalidation

Current behavior snapshots address, then verifies that a current valid profile exists but does not compare/update the address or fully re-run scenario conditions.

Risk: send to stale address or follow up after the specific scenario no longer applies.

Assessment: retain auditable snapshots, but resolve/verify the current approved delivery address and exact scenario at send time.

### Candidate preferences/unsubscribe

Current behavior has a service-role-only boolean with no candidate path and no link.

Risk: engagement recipients cannot self-manage contact.

Assessment: current table can be a seed, but the policy/data/API surface needs deliberate redesign by category and security model.

### Template fragments

Current payment/campaign HTML is safe but unbranded and duplicated.

Risk: inconsistent UX and weak rendering quality.

Assessment: incremental replacement with shared primitives is sufficient; provider-hosted templates are not inherently required.

### Stale planning document

`docs/EMAIL_SYSTEM_REVIEW_AND_PLAN.md` contains superseded claims.

Risk: future architecture decisions use stale evidence.

Assessment: supersede or update it only in a later approved documentation phase; do not treat it as runtime truth.

## 25. Manual external checks required

Do not provide secrets. Bring back names, statuses, screenshots/redacted settings, counts, dates, and error summaries.

### Supabase Dashboard

- **Authentication > Emails > SMTP Settings**: custom SMTP enabled? Provider name, From name/address, host domain, port/security mode, last successful test. Do not share username/password values.
- **Authentication > Email Templates**: export or screenshot confirmation, recovery, email change, magic link, invite, and reauthentication subjects/bodies; compare confirmation/recovery with repo files.
- **Authentication > URL Configuration**: production Site URL and approved redirect origins/paths.
- **Authentication > Rate Limits**: email/OTP limits, recent throttling, CAPTCHA/Turnstile state.
- **Authentication > Providers**: email confirmation and Google/email provider state.
- **Edge Functions > Secrets**: confirm only whether `RESEND_API_KEY`, `TRANSACTIONAL_EMAIL_FROM`, `TRANSACTIONAL_EMAIL_REPLY_TO`, `APP_URL`, and Paystack secrets are present; do not reveal values. Note that `TRANSACTIONAL_EMAIL_REPLY_TO` is not documented in `.env.example`.
- **Edge Function logs**: recent `transactional-email`, campaign, webhook, and verify errors/timeouts; count pending/failed/skipped events.
- **Database/Cron**: verify no dashboard-created cron/job exists outside migrations.

### Current email-provider dashboard (Resend if deployed)

- Account/workspace actually receiving API calls.
- Verified sending domains and exact approved From addresses.
- API versus SMTP configuration; whether Supabase Auth also uses this provider.
- Current daily/monthly volume, limits, throttles, and quota incidents.
- Last 30/90 day accepted, delivered, bounced, complained, blocked, and deferred counts/rates.
- Suppression-list count/reasons and how removals are governed.
- Existing webhooks/endpoints and signing secret status; do not share secret value.
- Log retention and whether provider message IDs in the DB can still be searched.
- Idempotency retention/window and observed duplicate suppression.
- Return-path/envelope sender and Reply-To behavior.
- Any provider-side templates/audiences/automations not represented in repo.

### DNS provider

- TXT/MX/CNAME records used for Resend and Auth SMTP.
- SPF record and include chain; confirm there is exactly one SPF policy per domain.
- DKIM selectors and verification status.
- DMARC record, policy (`p`), alignment (`adkim`/`aspf`), reporting addresses, and aggregate results if available.
- Subdomain delegation and return-path records.
- Whether transactional and engagement subdomains are intentionally separated.

### Operations/legal/product

- Who monitors `promotionsureapp@gmail.com`, expected response SLA, and whether replies are ticketed.
- Expected monthly Auth, transactional, and engagement volumes for 6 and 18 months.
- Required retention period for recipient addresses, payment references, message IDs, errors, and campaign copy.
- Approved legal basis/consent and unsubscribe requirements for incomplete-payment, practice, onboarding, expiry, and promotional messages in target jurisdictions.
- Which emails are mandatory service communications versus optional engagement.
- Desired quiet hours/timezone behavior and maximum contact frequency.
- Whether active users can change email externally today, and the intended source of truth for delivery address.

## 26. Realistic target architectures

### Architecture A: hardened inline transactional lane

**Preserves:** Supabase Auth lane, Resend adapter, transactional event table, existing payment call sites, campaign system.

**Changes:** add timeouts, retry/reclaim metadata and admin retry, correct purchase detail projection, provider webhook ingestion, suppression and preferences. Initial send remains inline.

**Reliability:** medium. Better recovery but still coupled to request execution.

**Complexity/operations:** low-medium; operator intervention remains important.

**Migration risk:** low-medium.

**Fit now:** acceptable only if volume is low and missed/delayed messages can be manually recovered.

**Fit later:** limited for lifecycle automation and webhook latency.

### Architecture B: small Postgres outbox + scheduled Edge dispatcher

**Preserves:** Auth lane, provider adapter, event keys, templates/campaign eligibility, admin diagnostics, payment/entitlement logic.

**Changes:** authoritative business paths enqueue jobs; a scheduler invokes a lease-based dispatcher; attempts/backoff/dead-letter and provider delivery events are persisted. Campaigns can either remain separately batched or use the same dispatcher with category controls.

**Reliability:** high when leases/idempotency are designed correctly.

**Complexity/operations:** medium; requires scheduler, worker monitoring, alerting, and retention.

**Migration risk:** medium, but can be introduced alongside current event records and cut over per email type.

**Fit now:** strong if purchase mail reliability and upcoming expiry/lifecycle emails are genuinely required.

**Fit later:** strong for moderate PromotionSure scale without external queue infrastructure.

### Architecture C: transactional outbox + provider-managed engagement

**Preserves:** Auth lane and database-authoritative transactional outbox; uses provider audiences/automation for approved engagement.

**Changes:** synchronize consent/segments/events to provider; provider owns engagement scheduling/suppression, app owns payment/access transactional dispatch.

**Reliability:** high for transactional if outbox-backed; provider-dependent for engagement.

**Complexity/operations:** medium-high due to data synchronization and two operational models.

**Migration risk:** medium-high; privacy, stale-state, vendor-lock-in, and attribution concerns.

**Fit now:** probably more machinery than current manual campaign scale needs.

**Fit later:** useful if engagement volume/automation grows and external research validates provider capabilities.

## 27. Provisional recommendation

**PROVISIONAL - REQUIRES EXTERNAL RESEARCH/REVIEW**

Prefer Architecture B in a deliberately small form:

- Keep Supabase Auth as a separate security-email lane, after production SMTP/template verification.
- Keep Resend unless external provider/DNS/reputation research identifies a concrete deficiency.
- Evolve the existing transactional event concept into a reclaimable, lease-based application email job/attempt model rather than introducing an external queue immediately.
- Enqueue only after authoritative payment/access state, and dispatch independently with the existing event key as both application and provider idempotency identity.
- Correct current pricing-plan/extension email projections before expanding email types.
- Add provider event ingestion and suppression before broad lifecycle automation.
- Keep the current campaign system manual initially, but add candidate preferences/unsubscribe and exact send-time eligibility before further use.
- Add expiry/onboarding/practice automation only after scheduling, suppression, monitoring, and product contact policies are approved.

Why this is provisional: the best transport/scheduler and sender strategy depends on actual Supabase SMTP configuration, Resend account/domain health, DNS authentication, volumes, deliverability data, legal policy, and operator capacity. Repository evidence alone cannot settle those decisions.

## 28. Questions and blockers before implementation

1. Is production Supabase Auth using custom SMTP, and are hosted templates synchronized with the repository?
2. Is Resend actually configured in every production/staging Edge environment, and which From identity is deployed?
3. Are all relevant domains SPF/DKIM/DMARC aligned, and what do recent delivery/bounce/complaint metrics show?
4. Should Resend also carry Auth SMTP, or should Auth and application delivery remain provider-separated?
5. What are expected volumes and required receipt/access-problem delivery SLOs?
6. Which engagement categories have approved consent/legal basis, frequency caps, and unsubscribe requirements?
7. Should existing users be given category preferences, a single engagement opt-out, or both?
8. What is the authoritative current email address if Supabase Auth email changes after profile creation?
9. Should transactional and engagement traffic use separate subdomains/senders?
10. What scheduler is operationally acceptable: Supabase Cron invoking Edge, an external scheduler, or provider automation for engagement only?
11. What retry window/backoff/dead-letter policy is appropriate, and who owns failed-message recovery?
12. What retention policy applies to email events, message IDs, provider payload/errors, campaign recipient snapshots, and audit logs?
13. Should current manual campaigns remain available before a candidate-facing unsubscribe path exists?
14. Should paid-but-access-failed email be generated from an authoritative fulfillment event so webhook-only failures are covered?
15. How should a multi-module purchase with different resulting module expiries be summarized in one receipt?

No implementation should begin until at least the Auth SMTP/domain state, current provider/DNS state, transactional delivery requirements, preference policy, and current-email source of truth are resolved.

## 29. Repository evidence index

Primary active runtime evidence:

- `supabase/config.toml`
- `supabase/templates/confirmation.html`
- `supabase/templates/recovery.html`
- `src/pages/Auth.jsx`
- `src/pages/AuthCallback.jsx`
- `src/pages/ResetPassword.jsx`
- `supabase/functions/_shared/transactional-email.ts`
- `supabase/functions/admin-email-campaign/index.ts`
- `supabase/functions/initialize-paystack-payment/index.ts`
- `supabase/functions/verify-paystack-payment/index.ts`
- `supabase/functions/paystack-webhook/index.ts`
- `supabase/functions/admin-reconcile-support-payment/index.ts`
- `supabase/functions/_shared/paystack.ts`
- `supabase/functions/_shared/payment-validation.js`
- `supabase/migrations/20260729123452_payment_email_events.sql`
- `supabase/migrations/20260801225620_admin_email_diagnostics.sql`
- `supabase/migrations/20260802092611_admin_email_campaigns.sql`
- `supabase/migrations/20260802095125_admin_update_email_campaign_copy.sql`
- `supabase/migrations/20260802101830_complete_prioritized_email_campaigns.sql`
- `supabase/migrations/20260802103522_grant_campaign_audit_insert.sql`
- `supabase/migrations/20260720070841_paystack_post_payment_lifecycle.sql`
- `supabase/migrations/20260801144030_bundle_offers_and_multi_module_orders.sql`
- `supabase/migrations/20260808131404_duration_pricing_catalog.sql`
- `supabase/migrations/20260808134832_pricing_plan_checkout_orders.sql`
- `supabase/migrations/20260808135303_tighten_pricing_plan_order_context.sql`
- `supabase/migrations/20260808140406_duration_pricing_activation.sql`
- `src/lib/appApi.js`
- `src/lib/paymentDisplay.js`
- `src/pages/Access.jsx`
- `src/pages/Admin.jsx`

Test evidence:

- `tests/unit/transactional-email-source.test.js`
- `tests/unit/admin-email-campaign-source.test.js`
- `tests/unit/payment-validation.test.js`
- `tests/unit/payment-sanitization.test.js`
- `supabase/tests/admin_email_campaigns_test.sql`
- `supabase/tests/admin_email_diagnostics_test.sql`
- `supabase/tests/payment_attention_admin_test.sql`
- `supabase/tests/duration_pricing_activation_test.sql`
- `supabase/tests/bundle_offers_test.sql`
- `scripts/test/runEdgePaymentIntegration.mjs`

Documentation-only/supporting evidence:

- `.env.example`
- `docs/PRODUCTION_CONFIG_CHECKLIST.md`
- `docs/AUTH_IDENTITY_VERIFICATION_SPEC.md`
- `docs/LAUNCH_READINESS.md`
- `docs/EMAIL_SYSTEM_REVIEW_AND_PLAN.md` (partly stale; not runtime truth)
- `.github/workflows/quality.yml`

## 30. Phase E0 conclusion

PromotionSure does not need an indiscriminate rewrite. It already has strong payment truth, entitlement idempotency, a useful Resend adapter, event dedupe, and meaningful admin controls. The safest next architecture decision is about reliable dispatch and delivery-state ownership, not about replacing those foundations.

The immediate blockers are external configuration evidence and two current-model correctness issues in application receipts. Once external facts are available, a focused design phase can decide whether a hardened inline model is sufficient or whether the small database-outbox architecture is warranted.
