# PromotionSure launch-day runbook

This is the shortest safe order for releasing PromotionSure. Do not skip a
failed step; fix it or postpone the public announcement.

## 1. Establish the release

- Use Node 22 or later in the build environment.
- Update the local Supabase CLI from `2.78.1` before touching production.
- Confirm the intended commit and keep the previous successful Vercel
  deployment available for rollback.
- Confirm a recoverable database backup exists.

## 2. Finish production configuration

Complete `docs/PRODUCTION_CONFIG_CHECKLIST.md`.

The hard blockers are:

- production Site URL and Auth redirects;
- custom SMTP with signup/recovery delivered to a non-team email;
- Turnstile enabled in Supabase Auth and in the frontend environment;
- reviewed Auth/email rate limits;
- Node 22+;
- production Supabase, WhatsApp, and app-version variables;
- live Paystack secret, callback, and webhook;
- Supabase organization and deployment-account MFA;
- a confirmed backup/recovery plan.

## 3. Apply backend changes

First inspect what the linked project would receive:

```bash
supabase db push --dry-run
```

Only after reviewing that list:

```bash
supabase db push
supabase functions deploy initialize-paystack-payment --no-verify-jwt
supabase functions deploy verify-paystack-payment --no-verify-jwt
supabase functions deploy paystack-webhook --no-verify-jwt
supabase functions deploy admin-reconcile-support-payment --no-verify-jwt
```

Then run Supabase Security and Performance Advisors. Do not expose additional
tables or grant broad function access to silence permission errors.

## 4. Deploy the frontend

- Build with `npm run build`.
- Deploy `dist` through the connected Vercel project.
- Confirm the production response includes the CSP and other headers defined
  in `vercel.json`.
- Confirm a deep link such as `/access` loads the SPA rather than a 404.

## 5. Run the production smoke

Use one real candidate account and the real production domain:

1. Create an account, receive the code, sign in, and recover the password.
2. Select free practice and complete one objective set.
3. Start oral practice, exit, and confirm the abandoned attempt is not passed.
4. Make one low-value live Paystack purchase.
5. Confirm callback verification, access, receipt, and idempotent webhook
   delivery.
6. Send a support request and open it as admin.
7. Confirm WhatsApp appears only on approved routes.
8. Confirm a candidate cannot open admin pages.
9. Confirm mobile layout and keyboard navigation on the core path.

## 6. Announce gradually

- Start with a small group before a broad announcement.
- Watch Auth 429/error rates, Edge Function 4xx/5xx and duration, Postgres/API
  errors, Paystack webhook retries, Vercel errors, and support volume.
- Keep the operator signed in and available during the first hour.

## 7. If something is wrong

- Pause module sales or the announcement first.
- Use Vercel's previous deployment for a frontend-only regression.
- Keep Paystack webhooks running so confirmed payments are not lost.
- Do not reverse database migrations impulsively. Preserve data, diagnose, and
  apply a forward fix.
- For a payment/access mismatch, use the admin reconciliation flow only after
  Paystack confirms ownership, amount, currency, and module.
