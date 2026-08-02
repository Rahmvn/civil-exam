# PromotionSure Email System Review and Plan

Date: 2026-08-01

## Executive summary

Email is already partially implemented and should become a first-class launch
workstream. PromotionSure currently has solid foundations for Supabase Auth OTP
emails and payment-related transactional emails, but the system is incomplete
as an operational email layer.

The next priority is not marketing email. It is reliability, observability, and
coverage for trust-critical candidate events: signup verification, password
recovery, payment confirmation, payment/access fixes, support updates, and
high-value exam lifecycle messages.

## Research notes

- Supabase's default SMTP is not production-grade. It is restricted to
  authorized organization addresses, has no SLA, and is currently limited to 2
  messages per hour. Production must use custom SMTP.
- Supabase custom SMTP starts with a low default sending rate after setup, so
  the launch plan must include Auth rate-limit review before any public push.
- Supabase Auth email templates include confirmation, invite, magic link/OTP,
  change email, reset password, and reauthentication. PromotionSure currently
  versions only confirmation and recovery templates.
- Supabase Site URL and redirect allowlists are critical for confirmation and
  password reset links. Hosted settings cannot be proven from local code.
- Resend supports idempotency keys for email sends. PromotionSure currently
  deduplicates payment email events in the database, but does not pass a Resend
  idempotency key to the provider.

Sources checked:

- https://supabase.com/docs/guides/auth/auth-smtp
- https://supabase.com/docs/guides/auth/rate-limits
- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/auth/redirect-urls
- https://resend.com/docs/dashboard/emails/idempotency-keys

## Current implementation

### Auth emails

Implemented:

- Local Supabase Auth config enables email confirmation and six-digit OTPs.
- Local confirmation and recovery templates are version-controlled in
  `supabase/templates/`.
- Signup creates a pending OTP state instead of assuming immediate login.
- Recovery requests use `resetPasswordForEmail()`, verify with
  `verifyOtp({ type: "recovery" })`, and require a fresh recovery session before
  password update.
- Resend cooldown and pending state are purpose-bound for signup versus
  recovery.
- Auth errors are sanitized before logging or showing user copy.
- Turnstile is wired into signup, sign-in, recovery, and resend flows when
  enabled.

Important local files:

- `supabase/config.toml`
- `supabase/templates/confirmation.html`
- `supabase/templates/recovery.html`
- `src/pages/Auth.jsx`
- `src/pages/ResetPassword.jsx`
- `src/pages/AuthCallback.jsx`
- `src/lib/authFlow.js`
- `tests/unit/auth-templates.test.js`
- `tests/unit/auth-flow.test.js`
- `tests/e2e/auth-mocked.spec.js`

Gaps:

- Hosted Supabase SMTP, templates, Site URL, redirect URLs, and Auth rate
  limits remain external production configuration.
- Only confirmation and recovery templates are locally tracked. Invite, change
  email, magic link/OTP, and reauthentication templates are not tracked.
- There is no in-app/admin dashboard for Auth email delivery diagnostics.
- Candidate copy says to check the inbox/spam, but there is no operator path to
  inspect whether Supabase accepted or rejected a specific Auth email.

### Payment transactional emails

Implemented:

- `transactional_email_events` records payment email sends with status,
  recipient, user, payment order, provider message id, error, and metadata.
- The event key is unique, so repeated payment verification/webhooks do not
  duplicate the same email event.
- Resend is optional. If `RESEND_API_KEY` is absent, payment state still
  completes and the email event is marked skipped.
- Current templates cover:
  - `payment_success`
  - `payment_access_issue`
  - `refund_pending`
  - `refund_processed`
  - `refund_failed`
  - `payment_disputed`
  - `payment_dispute_resolved`
- Candidate payment verification and Paystack webhooks both attempt the
  relevant transactional emails.

Important local files:

- `supabase/functions/_shared/transactional-email.ts`
- `supabase/migrations/20260729123452_payment_email_events.sql`
- `supabase/functions/verify-paystack-payment/index.ts`
- `supabase/functions/paystack-webhook/index.ts`
- `.env.example`

Gaps:

- Resend idempotency keys are not sent to the provider.
- There is no retry job for `failed` events.
- There is no webhook ingestion for delivered, bounced, complained, opened, or
  clicked events.
- There is no admin view of `transactional_email_events`.
- Payment emails are hardcoded strings, not shared branded template components.
- Admin payment reconciliation activates access but does not notify the
  candidate afterward.

### Support and operations emails

Implemented:

- Public support shows a direct support email.
- Admin support includes a mailto compose action with safe support guidance.
- Support knowledge warns operators never to request passwords, OTPs, reset
  links, card details, PINs, or bank credentials.

Important local files:

- `src/pages/PublicSupport.jsx`
- `src/pages/Admin.jsx`
- `src/lib/supportKnowledge.js`
- `docs/SUPPORT_FAQ_AND_ADMIN_PLAYBOOK.md`

Gaps:

- Support request submission does not send an automatic acknowledgement.
- Support status changes do not send candidate updates.
- Admin/operator notifications for urgent payment/access issues are not
  automated.
- Email remains split between in-app support, mailto, WhatsApp guidance, and
  Edge transactional sends.

## Risk assessment

### Launch-blocking

1. Custom SMTP must be configured in hosted Supabase before public launch.
2. Hosted Auth email templates must match the version-controlled OTP templates.
3. Production Site URL and redirect allowlists must include the final
   `/auth/callback` origin.
4. Auth email and OTP rate limits must be reviewed for expected launch traffic.
5. Turnstile must be enabled for public signup/recovery to reduce email abuse.

### High priority after launch-blockers

1. Add an admin email-events view for payment transactional emails.
2. Add retry tooling for failed transactional emails.
3. Add candidate notifications for support resolution and admin payment
   reconciliation.
4. Add provider idempotency headers for Resend sends.
5. Add Resend webhook ingestion for bounce/failure visibility.

### Medium priority

1. Track every Supabase Auth template locally, even if unused.
2. Create shared email template primitives for consistent branding.
3. Add exam lifecycle notifications:
   - practice result available
   - module access expiring soon
   - new batch/module published for entitled candidates
4. Add digest-style admin summaries instead of one email per minor event.

### Lower priority

1. Study reminders.
2. Abandoned signup/payment nudges.
3. Campaign/marketing emails.
4. Newsletter or announcements.

These should wait until transactional deliverability and unsubscribe/compliance
rules are designed.

## Recommended architecture

### Keep two lanes

1. Auth email lane:
   Supabase Auth sends account/security emails through custom SMTP using
   hosted templates synced from `supabase/templates/`.

2. Application transactional lane:
   Edge Functions send operational app emails through Resend API and record
   state in database-backed email events.

Do not mix marketing email into either lane.

### Expand event model

Generalize `transactional_email_events` beyond payments:

- `event_key`
- `event_type`
- `recipient_email`
- `user_id`
- `related_entity_type`
- `related_entity_id`
- `provider`
- `provider_message_id`
- `status`
- `metadata`
- `attempt_count`
- `last_attempted_at`
- `sent_at`
- `delivered_at`
- `bounced_at`
- `complained_at`
- `error_message`

Retain private RLS posture. Expose only admin-safe summaries through RPCs.

### Add sender modules

Create typed sender functions for:

- Payment success/access issue/refund/dispute
- Admin payment reconciliation completed
- Support request received
- Support request resolved/reopened
- Practice result available
- Module access expiring soon
- New module/batch published

Each sender should:

- create or claim an event row first
- use a stable idempotency key
- send text and HTML
- sanitize all user-controlled content
- mark sent/failed/skipped
- avoid changing product state based on email success

## Phased plan

### Phase 0: Production Auth email gate

Outcome: signup and recovery emails are reliable for launch.

- Configure custom SMTP in hosted Supabase.
- Verify SPF, DKIM, and DMARC for the sending domain.
- Confirm hosted Site URL and redirect allowlists.
- Upload/sync confirmation and recovery templates from `supabase/templates/`.
- Send real signup and recovery tests to non-team inboxes.
- Review Auth rate limits after custom SMTP is enabled.
- Confirm Turnstile is active for signup/recovery/resend.
- Record final settings in the production checklist.

Acceptance:

- A new candidate can sign up, receive OTP, verify, and reach dashboard.
- The same candidate can complete password recovery.
- Repeated resend behavior respects cooldown/rate-limit copy.
- No production flow relies on Supabase default SMTP.

### Phase 1: Harden existing app transactional email

Outcome: existing payment emails become inspectable and safer to retry.

- Add Resend idempotency key headers using `event_key`.
- Add retry metadata to `transactional_email_events`.
- Add an admin read-only email events panel or diagnostics RPC.
- Add a manual admin retry action for failed/skipped non-Auth emails.
- Add unit tests for payment email dedupe, skipped provider, failed provider,
  and idempotency header behavior.
- Add an Edge integration test path with Resend mocked.

Acceptance:

- Duplicate payment verification/webhook attempts never send duplicate emails.
- Failed sends are visible to admins with reason and last attempt time.
- A failed app email can be retried without altering payment/access state.

### Phase 2: Support and payment-resolution notifications

Outcome: candidates are not left guessing after support actions.

- Send support request acknowledgement after in-app support submission.
- Send support resolution/reopen updates when admins change status.
- Send payment reconciliation success/failure notification from
  `admin-reconcile-support-payment`.
- Add operator copy that keeps sensitive data out of emails.
- Add opt-out/comms preferences only for non-essential support follow-ups.

Acceptance:

- Creating a help request creates exactly one acknowledgement event.
- Resolving a help request creates exactly one resolution event.
- Admin payment reconciliation notifies the candidate whether access was fixed
  or still requires review.

### Phase 3: Exam lifecycle transactional email

Outcome: email supports exam preparation without becoming noisy.

- Send optional result-available email after objective/oral submission.
- Send access-expiring reminders at a small number of fixed windows.
- Send new-batch/module-published alerts to entitled candidates only.
- Add per-user notification preferences for non-security, non-payment emails.
- Add batch sending with queue/rate-limit controls before broad sends.

Acceptance:

- No user receives lifecycle emails without eligibility and preference checks.
- Bulk sends are rate-limited, resumable, and auditable.
- Security, Auth, payment, and support emails remain unaffected by preferences.

### Phase 4: Marketing, only after transactional maturity

Outcome: promotional messaging is separate and compliant.

- Use a separate sending identity/domain if marketing email is introduced.
- Add explicit consent and unsubscribe handling.
- Keep marketing templates and analytics separate from Auth templates.
- Avoid sending campaigns from the same reputation pool as password recovery.

## Suggested immediate next tasks

1. Complete Phase 0 in the hosted Supabase dashboard before launch.
2. Implement Phase 1 idempotency header and admin email diagnostics.
3. Add the missing reconciliation/support notifications from Phase 2.
4. Track the remaining Supabase Auth templates locally for future safety.

