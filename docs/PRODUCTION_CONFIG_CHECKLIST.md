# PromotionSure production configuration checklist

Use this before staging or public launch. This checklist separates **required launch configuration** from optional features so we do not block launch on settings the app is not currently using.

## Required for launch

### Hosting

- Runtime: Node `22` or later.
- Build command: `npm run build`.
- Output directory: `dist`.
- SPA routing: keep the rewrite in `vercel.json` so deep links return `index.html`.

### Frontend environment

Set these in the production hosting provider:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_APP_VERSION`
- `VITE_WHATSAPP_SUPPORT_ENABLED`
- `VITE_WHATSAPP_SUPPORT_NUMBER`

Rules:

- Do not set `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, or any other secret with a `VITE_` prefix.
- Prefer `VITE_SUPABASE_PUBLISHABLE_KEY`. Use `VITE_SUPABASE_ANON_KEY` only as a legacy fallback.
- `VITE_WHATSAPP_SUPPORT_NUMBER` must be international digits only, for example `234...`, with no `+`, spaces, or dashes.

### Supabase Auth dashboard

In Supabase Dashboard → Authentication → URL Configuration:

- Site URL: production app URL, for example `https://promotionsure...`.
- Redirect URLs must include:
  - `https://<production-domain>/auth/callback`
  - any approved preview/staging callback URL used for final QA

This matters for email confirmation, password recovery, and OAuth callback behavior.

### Supabase Edge Function secrets

Set these in Supabase project secrets:

- `SUPABASE_URL`
- `PAYSTACK_SECRET_KEY`
- `APP_URL`

For compatibility with the current payment functions, confirm Supabase provides the platform-managed key dictionaries, or set the fallback keys intentionally:

- Preferred/platform-managed: `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS`
- Fallback only if needed: `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`

Rules:

- `APP_URL` must be the production origin only, with no path, query string, fragment, or credentials.
- Production `APP_URL` must use `https`.
- Do not set `PAYSTACK_API_URL` in production; it should default to `https://api.paystack.co`.

### Supabase Edge Functions

Deploy and verify:

- `initialize-paystack-payment`
- `verify-paystack-payment`
- `paystack-webhook`
- `admin-reconcile-support-payment`

Expected auth behavior:

- These functions have `verify_jwt = false` in `supabase/config.toml`.
- Candidate functions still validate the user's Supabase session inside the function.
- Paystack webhook validates Paystack's signature inside the function.

### Paystack

In Paystack live mode:

- Use the live secret key in Supabase Edge Function secrets.
- Confirm payment initialization returns a production Paystack checkout URL.
- Webhook URL should point to the production `paystack-webhook` Edge Function.
- Test at least one live payment end to end:
  - initialize payment
  - return through callback
  - verify payment
  - entitlement appears
  - receipt opens/downloads
  - webhook event is accepted without duplicate fulfillment

### Operator/admin access

- Confirm the operator/admin user can sign in on production.
- Confirm the operator/admin user can access admin-only screens.
- Run the read-only operator check with production private env loaded:

```bash
npm run test:operator-access
```

## Optional, only if enabled

### Google sign-in

Only enable when OAuth settings are ready.

Frontend:

- `VITE_GOOGLE_AUTH_ENABLED=true`

Supabase/Auth provider:

- Google provider enabled.
- Production callback URL approved in Google Cloud and Supabase.

Secrets:

- `GOOGLE_CLIENT_SECRET` only where the provider actually requires it.

### Turnstile

Only enable when both site key and secret key are configured.

Frontend:

- `VITE_TURNSTILE_ENABLED=true`
- `VITE_TURNSTILE_SITE_KEY`

Secrets:

- `TURNSTILE_SECRET_KEY`

### Transactional email provider

Only block launch on this if production email confirmations/recovery require an external provider beyond Supabase's current project settings.

Possible secrets, depending on provider:

- `RESEND_API_KEY`
- `SMTP_PASSWORD`

## Final production smoke

Run these manually on the production domain:

1. Landing page loads without raw text or unstyled flash.
2. Sign up, confirm email, and sign in.
3. Password recovery sends and accepts the recovery flow.
4. Access page shows unlocked modules correctly.
5. `View` opens the module practice-set page.
6. Objective practice can start, submit, and open answer review.
7. Oral practice can start and exit; abandoned oral attempts must not count as passed.
8. Payment flow unlocks a module and creates a receipt.
9. Payment receipt print/download is presentable.
10. Help request can be sent and appears in request history.
11. WhatsApp support appears only on approved routes.
12. Admin can view users, modules, payments, support, and content tools.

## Sources checked

- Supabase Auth redirect URL docs: https://supabase.com/docs/guides/auth/redirect-urls
- Supabase Edge Function secrets docs: https://supabase.com/docs/guides/functions/secrets
- Paystack accept payments docs: https://paystack.com/docs/payments/accept-payments/
- Paystack webhooks docs: https://paystack.com/docs/payments/webhooks/
