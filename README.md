# PromotionSure

PromotionSure is a public service promotion exam practice app. Candidates can unlock modules, complete objective and oral practice sets, review answers, download payment receipts, and contact support.

## Stack

- React + Vite
- Supabase Auth, Postgres, RLS, and Edge Functions
- Paystack payments
- Playwright, Node test runner, and Supabase database tests

## Local development

Use Node 22 or later.

```bash
npm install
supabase start
npm run dev
```

`npm run dev` is deliberately local-only. It reads the URL and browser key
from the running local Supabase stack and refuses to start against a hosted
project. This prevents manual development from changing real candidate data.

For the local Supabase-backed test flows:

```bash
supabase start
npm run test:unit
npm run test:db
npm run test:edge
npm run test:e2e
```

## Required production configuration

Set these in the production hosting and Supabase environments. Never expose secret keys through `VITE_*` variables.

Use the full production checklist in `docs/PRODUCTION_CONFIG_CHECKLIST.md`.

### Frontend

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_APP_VERSION`
- `VITE_WHATSAPP_SUPPORT_ENABLED`
- `VITE_WHATSAPP_SUPPORT_NUMBER`
- `VITE_GOOGLE_AUTH_ENABLED` when Google sign-in is enabled
- `VITE_TURNSTILE_ENABLED` when Turnstile is enabled
- `VITE_TURNSTILE_SITE_KEY` when Turnstile is enabled

### Supabase Edge Function secrets

- `SUPABASE_URL`
- `PAYSTACK_SECRET_KEY`
- `APP_URL`
- `RESEND_API_KEY` or the approved email provider secret, if production email depends on it
- `GOOGLE_CLIENT_SECRET` when Google sign-in is enabled
- `TURNSTILE_SECRET_KEY` when Turnstile is enabled

Hosted Supabase Edge Functions receive Supabase publishable and secret keys from the platform. Local scripts that need privileged access require `SUPABASE_SECRET_KEY` in an untracked private environment.

### Supabase dashboard

- Auth site URL must be the production app URL.
- Auth redirect URLs must include the production `/auth/callback` URL.
- Email confirmations must remain enabled.
- Custom SMTP is required for public launch; Supabase's default mailer is
  testing-only and too restricted for real candidates.
- Turnstile and reviewed Auth rate limits are required for public signup and
  recovery.
- Email templates should use the PromotionSure confirmation and recovery copy.
- RLS must stay enabled on exposed public tables.

### Paystack

- Use live keys only in production.
- Confirm the production callback URL uses `APP_URL`.
- Configure webhook delivery for the production Supabase Edge Function.
- Verify a real payment in live mode before public launch.

## Launch gate

The working launch checklist is in `docs/LAUNCH_READINESS.md`.

Minimum release pass:

```bash
npm run launch:check
npm run launch:check:full
```

`npm run test:security` runs the tracked-secret scan plus a strict dependency audit wrapper. The wrapper currently allows only the documented React Router RSC advisory while the app remains a Vite client-side SPA with no React Router RSC/server APIs. Do not run `npm audit fix --force` for this advisory.

## Operational smoke checks

Before public launch, manually verify in production:

- Landing page → sign up/sign in.
- Module access → View → practice sets.
- Objective practice → submit → answer review.
- Oral practice → exit/abandon behavior.
- Payment initialize → verify → receipt view/download.
- Support request → request history.
- WhatsApp support appears only on approved routes.
- Admin login can view users, modules, payments, support requests, and content tools.
