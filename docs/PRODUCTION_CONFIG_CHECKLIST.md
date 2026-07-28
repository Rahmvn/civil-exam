# PromotionSure production configuration checklist

Use this before staging or public launch. Every item under “Required for
launch” is a release gate, not a future improvement.

## Required for launch

### Hosting

- Runtime: Node `22` or later.
- Build command: `npm run build`.
- Output directory: `dist`.
- Keep the SPA rewrite in `vercel.json` so deep links return `index.html`.
- Keep the versioned security headers in `vercel.json`. They enforce CSP,
  clickjacking protection, MIME protection, a restrained browser-permission
  policy, referrer protection, and HTTPS persistence.
- If Supabase later moves to a custom domain, add that exact HTTPS/WSS origin
  to the CSP `connect-src` directive before switching DNS.

### Frontend environment

Set these in the production hosting provider:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_APP_VERSION`
- `VITE_WHATSAPP_SUPPORT_ENABLED`
- `VITE_WHATSAPP_SUPPORT_NUMBER`
- `VITE_TURNSTILE_ENABLED=true`
- `VITE_TURNSTILE_SITE_KEY`

Rules:

- Never set `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `PAYSTACK_SECRET_KEY`, SMTP credentials, or any other secret with a `VITE_`
  prefix.
- Prefer `VITE_SUPABASE_PUBLISHABLE_KEY`. Use
  `VITE_SUPABASE_ANON_KEY` only as a legacy fallback.
- `VITE_WHATSAPP_SUPPORT_NUMBER` must be international digits only, for
  example `234...`, with no `+`, spaces, or dashes.

### Supabase Auth dashboard

In Authentication > URL Configuration:

- Site URL: the production app origin.
- Redirect URLs include:
  - `https://<production-domain>/auth/callback`
  - only approved preview/staging callback URLs used for final QA

In Authentication > Emails > SMTP Settings:

- Configure an approved custom SMTP provider.
- Verify the sender domain and use a monitored reply/support address.
- Send signup and recovery tests to an address that is not a Supabase team
  member.
- Do not launch on Supabase’s default SMTP. It is intended for testing,
  restricts recipients, and is currently limited to two messages per hour.

In Authentication > Bot and Abuse Protection:

- Enable Cloudflare Turnstile.
- Configure every hostname users can actually visit in Turnstile Hostname
  Management, including the exact apex and `www` production forms if both
  resolve to the app.
- Put the Turnstile secret in Supabase Auth, never in a `VITE_*` variable.
- Confirm the frontend site key matches the configured widget.
- Use Cloudflare's public testing sitekey for local automated/manual testing,
  or explicitly authorize the local hostname. Do not use an unauthorized
  production key on `localhost`.
- Test password sign-in, account creation, recovery, and resend separately
  before enabling CAPTCHA for the public project.

In Authentication > Rate Limits and Password Security:

- Review email, OTP, verification, and recovery limits after custom SMTP is
  connected. The custom-SMTP default of 30 auth emails per hour may still be
  too low for a public announcement.
- Keep minimum password length at eight or more.
- Enable leaked-password protection when the project plan supports it.

### Supabase Edge Function secrets

Set these in Supabase project secrets:

- `SUPABASE_URL`
- `PAYSTACK_SECRET_KEY`
- `APP_URL`

Confirm Supabase provides the platform-managed key dictionaries, or set the
legacy fallback keys intentionally:

- Preferred/platform-managed: `SUPABASE_PUBLISHABLE_KEYS` and
  `SUPABASE_SECRET_KEYS`
- Fallback only if required: `SUPABASE_ANON_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY`

Rules:

- `APP_URL` is the HTTPS production origin only, with no path, query,
  fragment, or credentials.
- Do not set `PAYSTACK_API_URL` in production; it defaults to
  `https://api.paystack.co`.

### Supabase Edge Functions

Deploy and verify:

- `initialize-paystack-payment`
- `verify-paystack-payment`
- `paystack-webhook`
- `admin-reconcile-support-payment`

Expected authentication:

- The functions declare `verify_jwt = false` because they perform their own
  compatible session/signature checks.
- Candidate functions validate the user’s Supabase session internally.
- The admin reconciliation function validates both session and admin role.
- The webhook validates Paystack’s HMAC signature over the raw body.

### Database and recovery

- Use a plan that will not pause the production project for inactivity.
- Inspect pending migrations with `supabase db push --dry-run` before applying
  them.
- Confirm daily backups are present. If the project stays on a free plan,
  create and securely store an off-site logical backup before launch.
- Decide the acceptable recovery point. Daily backups can lose up to a day of
  writes; enable PITR when that is not acceptable.
- Run Supabase Security and Performance Advisors after production migrations.

### Paystack

In Paystack live mode:

- Use the live secret key only in Supabase Edge Function secrets.
- Confirm initialization returns a production Paystack checkout URL.
- Point the webhook to the production `paystack-webhook` Edge Function.
- Complete one live payment end to end:
  - initialize payment
  - return through callback
  - verify payment
  - entitlement appears
  - receipt opens/downloads
  - webhook is accepted without duplicate fulfillment

### Operator/admin access

- Confirm the operator/admin user can sign in and reach admin-only screens.
- Enable MFA on the Supabase organization account and the Git/hosting
  accounts that can deploy or change secrets.
- Run the read-only operator check with production private env loaded:

```bash
npm run test:operator-access
```

### Traffic and monitoring

- In Vercel Firewall, begin with a logging rule and enable rate limiting or a
  challenge if abnormal traffic appears. It is not the only Auth control
  because Auth and Edge calls go directly to Supabase.
- The application already enforces database text limits, support-request
  limits, bounded Edge request bodies, local payment-reference ownership
  checks, and per-user payment Edge rate limits.
- During launch, watch Supabase Auth, API, Postgres, and Edge Function logs,
  Paystack webhook delivery, Vercel errors, and application error events.

## Optional, only if enabled

### Google sign-in

- Set `VITE_GOOGLE_AUTH_ENABLED=true`.
- Enable Google in Supabase Auth.
- Approve the production callback URL in Google Cloud and Supabase.
- Keep the Google client secret only in the provider configuration.

## Final production smoke

Run these manually on the production domain:

1. Landing page loads without raw text or an unstyled flash.
2. Sign up, receive the code, confirm email, and sign in.
3. Password recovery sends and accepts the recovery flow.
4. Access shows unlocked modules and `View` opens practice sets.
5. Objective practice starts, submits, and opens answer review.
6. Oral practice starts and exits; an abandoned attempt is not passed.
7. A live payment unlocks one module and creates a receipt.
8. Payment receipt print/download is presentable.
9. A help request appears in request history and the admin queue.
10. WhatsApp support appears only on approved routes.
11. Admin can view users, modules, payments, support, and content.
12. Repeated payment checks eventually receive HTTP 429.
13. Production responses include the headers from `vercel.json`.

## Sources checked

- Supabase production checklist: https://supabase.com/docs/guides/deployment/going-into-prod
- Supabase Auth redirects: https://supabase.com/docs/guides/auth/redirect-urls
- Supabase custom SMTP: https://supabase.com/docs/guides/auth/auth-smtp
- Supabase Auth rate limits: https://supabase.com/docs/guides/auth/rate-limits
- Supabase CAPTCHA: https://supabase.com/docs/guides/auth/auth-captcha
- Supabase password security: https://supabase.com/docs/guides/auth/password-security
- Supabase Edge secrets: https://supabase.com/docs/guides/functions/secrets
- Supabase backups: https://supabase.com/docs/guides/platform/backups
- Paystack payments: https://paystack.com/docs/payments/accept-payments/
- Paystack webhooks: https://paystack.com/docs/payments/webhooks/
- Vercel Firewall rate limiting: https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting
