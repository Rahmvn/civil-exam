# Bundle payment testing runbook

Use this runbook for the any-three and full-bundle purchase release. The live
PromotionSure project contains real candidate data, so environment isolation is
a release requirement.

## Non-negotiable boundaries

- Local automated and manual tests use only loopback Supabase URLs.
- Hosted QA uses an isolated Supabase branch/project, a Vercel Preview
  deployment, synthetic identities, and Paystack test keys.
- Production receives no resets, seeds, load tests, webhook replay campaigns,
  refund simulations, or test-mode Paystack traffic.
- Never copy production candidate identities, payment references, credentials,
  or answer-key data into staging.
- Never print secret values in test output or reports.

## Gate 1: local

Start the local stack before the app. The development command refuses to use a
hosted Supabase URL even if `.env` points to one.

```bash
supabase start
npm run dev
```

Run the release gates from a clean local database:

```bash
supabase db reset
npm run lint
npm run build
npm run test:security
npm run test:unit
npm run test:db
npm run test:edge
npm run test:e2e
```

Required bundle coverage:

- existing single-module checkout and fulfillment;
- exactly-N selection, full-bundle selection, and already-owned exclusions;
- disabled, not-started, expired, changed-price, and invalid-module rejection;
- server-authoritative amount, currency, user, offer, and module validation;
- duplicate initialization, callback verification, and webhook replay;
- atomic multi-module fulfillment and rollback on one invalid item;
- partial/full refunds and opened/resolved disputes across all order items;
- candidate RLS denial and admin-only offer mutation;
- receipt, history, payment result, desktop, mobile, keyboard, and screen-reader
  behavior.

## Gate 2: isolated hosted QA

Use a persistent Supabase branch when available; otherwise use a separate
staging project. Supabase preview branches are data-less, so seed only generated
fixtures. Connect a Vercel Preview deployment to the branch-specific URL and
publishable key.

Set hosted secrets only in the staging environments:

- Supabase Edge Functions: branch `SUPABASE_URL`, Paystack `sk_test_...`, and
  the HTTPS Vercel Preview `APP_URL`;
- Vercel Preview: branch `VITE_SUPABASE_URL` and branch publishable key;
- Paystack test mode: webhook URL for the staging `paystack-webhook` function.

Do not reuse the production Supabase URL, secret key, Paystack live key, webhook
URL, or Vercel production variables.

Test with Paystack's official successful, declined, insufficient-funds, and
refund test instruments. Confirm the returned transaction has `domain=test`,
the exact reference, NGN currency, and expected amount before granting access.

Seed a synthetic legacy-order volume at least as large as production's current
aggregate count. Time the migration and verify:

- every legacy order is classified as `single_module`;
- each eligible legacy order receives exactly one immutable order item;
- historical entitlements and receipts remain valid;
- no enabled purchase offer exists after migration;
- common candidate/admin queries have acceptable plans and latency;
- Security and Performance Advisors have no new release-blocking findings.

Run expected-load, spike, and soak tests only here, never through Paystack and
never against production.

## Gate 3: production deployment

Before mutation:

1. Confirm backup/PITR or take an approved off-site logical backup.
2. Record aggregate counts for users, payment orders, entitlements, and pending
   payment reviews without returning candidate details.
3. Upgrade the Supabase CLI and inspect `supabase db push --dry-run`.
4. Confirm the new migration is the only intended pending migration.

Deploy in this order:

1. Database migration. All offers remain disabled by default.
2. Payment Edge Functions.
3. Frontend and admin UI.
4. Read-only health, RLS, log, and aggregate-count checks.
5. Create the approved offer disabled; independently verify price and schedule.
6. Enable it only at the approved campaign time.

Do not briefly enable a bundle merely to test it: there is currently no private
offer audience, so every eligible candidate could see it. The actual bundle
payment journey must be proven in staging before public activation.

## Release acceptance

Release only when every local and hosted gate passes, the offer amount and time
window have two-person approval, rollback access is available, and an operator
is watching Supabase, Paystack and Vercel during activation.

If a fault appears, disable purchase offers first, roll the frontend/Edge
Functions back to their previous deployment, keep signed Paystack webhooks
running, preserve payment records, and fix the database forward rather than
reversing the migration destructively.
