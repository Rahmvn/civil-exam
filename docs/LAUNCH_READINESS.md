# PromotionSure launch readiness

This is the working launch gate for PromotionSure. It should stay short, factual, and decision-oriented.

## Launch decision

Status: **code-ready; production configuration must still be confirmed**

The complete local product gate is green. Public launch should proceed only
after the production SMTP, Auth abuse protection, migrations, Edge Functions,
payments, backups, and live smoke checks are confirmed.

## Release gates

| Gate | Status | Evidence / action |
| --- | --- | --- |
| Product UI direction | In progress | Core pages have been heavily refined. Final pass should focus only on launch-blocking clarity issues, not broad redesign. |
| Local launch check | Passing | `npm run launch:check` passes. This covers lint, build, tracked-secret scan, the production-config contract, unit tests, database tests, payment edge tests, and operator read-only access. |
| Full local launch check | Passing | `npm run launch:check:full` passes on Node 22 and now includes mocked Auth plus a live Cloudflare test-widget gate, 79 browser tests, 3 performance tests, 4 visual tests, the standard load profile, and every base gate. |
| Frontend build | Passing | Covered by `npm run launch:check`. Vite reports large chunks, but this is not a launch blocker. |
| Lint | Passing | Covered by `npm run launch:check`. |
| Unit tests | Passing | `npm run test:unit` passes: 95 tests. |
| Database tests | Passing | `npm run test:db` passes: 326 assertions. |
| Database advisors | Passing | Supabase database advisors report no security or performance issues after redundant permissive policies were removed. |
| Payment edge tests | Passing | `npm run test:edge` passes. |
| Security scan | Accepted with documented exception | Tracked-secret scan passes. `npm audit --audit-level=high` reports the React Router RSC advisory, but the current app is a Vite client-side SPA with no React Router RSC/server API usage. Do not force-downgrade; monitor for a clean patched upgrade path. |
| Candidate E2E regression | Passing | `npm run test:e2e -- --project=public-desktop --project=public-mobile --project=paid-desktop --project=paid-mobile` passes: 34 tests. |
| Admin E2E regression | Passing | `npm run test:e2e -- --project=admin-desktop --project=admin-mobile` passes: 25 tests. |
| Free-candidate mobile E2E | Passing | `npm run test:e2e -- --project=free-mobile` passes: 3 tests. |
| Cross-browser critical E2E | Passing | `npm run test:e2e -- --project=critical-firefox --project=critical-webkit` passes: 6 tests. |
| Accessibility E2E | Passing | `npm run test:e2e -- --project=candidate-accessibility --project=admin-accessibility` passes: 10 tests. |
| Reliability E2E | Passing | `npm run test:e2e -- --project=reliability-desktop` passes: 6 tests. |
| Turnstile E2E | Passing | `npm run test:e2e:turnstile` uses Cloudflare's public test widget and confirms that sign-in, signup, and recovery send completed CAPTCHA tokens to Supabase. |
| Performance E2E | Passing | `npm run test:e2e:performance` passes: 3 tests using warmed-route local preview measurements. |
| Standard load test | Passing | `npm run test:load` passes. Local smoke profile reached 50 concurrent candidate reads, 25 admin reads, objective submit contention, and oral autosave contention with 0 failures. |
| Full local stress load | Not cleared | `npm run test:load:full` passes through 100 concurrent candidate reads but fails at 250-300 local candidate-read concurrency with `fetch failed` errors. Treat as a staging-capacity gate, not cleared by local smoke. |
| Visual regression | Passing | `npm run test:e2e:visual` passes: 4 tests. Current dashboard/access snapshots were inspected and intentionally refreshed after UI redesign. |
| Full E2E regression | Mostly cleared | Candidate, admin, free-mobile, cross-browser, accessibility, reliability, performance, and visual gates are passing. Full local stress remains a staging-capacity concern. |
| Operator/admin access check | Passing locally | `npm run test:operator-access` passes. The script now loads local `.env` when shell env vars are not already present. |
| Legal operator consistency | Passing | Privacy and Terms use Muraina Rasheedah as operator/data controller. |
| User-input abuse hardening | Passing locally | User-controlled text limits are enforced in the database and UI. Support requests remain capped and rate-limited; profile optional fields now have format/length constraints; oral answers are capped at 5,000 characters and late timeout submissions cannot overwrite the saved answer. |
| Payment/Edge abuse hardening | Passing locally | Candidate/admin payment bodies are capped at 2 KiB, signed webhooks at 256 KiB, payment references are format-limited and ownership-checked before provider calls, and trusted payment endpoints use atomic per-user rate limits. |
| Browser response hardening | Passing locally | `vercel.json` carries a tested CSP, anti-framing, MIME, referrer, permissions, HSTS, and OAuth-compatible opener policies. |
| Production environment | Needs final confirmation | Required settings are documented in `docs/PRODUCTION_CONFIG_CHECKLIST.md`; Vercel/Supabase/Paystack/WhatsApp/Auth email dashboard values still need to be confirmed against production. |
| Launch documentation | Passing | README now contains the PromotionSure production runbook, required environment settings, launch commands, and manual smoke checks. |

## Known launch risks

1. **React Router audit advisory**
   - `npm audit` reports `GHSA-qwww-vcr4-c8h2`.
   - Advisory reference: https://github.com/advisories/GHSA-qwww-vcr4-c8h2
   - GitHub's advisory says the issue affects apps using React Router's unstable RSC APIs.
   - The app is a Vite client-side SPA and the codebase search found no usage of React Router RSC/server APIs.
   - Do not force-downgrade to `react-router-dom@7.11.0`; that introduces older React Router advisories.
   - Launch choice: accepted as not applicable to the current architecture.
   - Release rule: do not enable React Router RSC/server action features without reopening this security decision.
   - Follow-up: monitor for a non-disruptive patched upgrade path, preferably React Router `8.3.0+` or an officially supported patched version compatible with the app.
   - Verification:
     - `node scripts/test/checkTrackedSecrets.mjs` passes across 497 tracked files.
     - `rg "unstable_.*RSC|RSC|react-server|ServerRouter|createCallServer|RSCHydratedRouter|react-router/dom/server|createStaticHandler" src package.json vite.config.js` returns no matches.
     - `npm audit --audit-level=high` still fails only on this React Router RSC advisory.

2. **Production configuration remains external**
   - The complete local browser gate is green.
   - Dashboard values and one live production smoke cannot be proven from the
     repository.

3. **Full local stress load limit**
   - Standard load smoke is green.
   - Full local stress failed at 250-300 concurrent candidate-read requests with `TypeError: fetch failed`.
   - Before a large public launch, repeat capacity testing in staging/production-like infrastructure with multiple candidate identities.

4. **Production configuration must be checked outside local files**
   - Supabase Auth site URL and redirects live in the dashboard.
   - Email provider/template behavior depends on Supabase project settings.
   - Paystack must use live keys and verified callback URLs.
   - WhatsApp support should use the approved support number and route gating.

5. **Node version**
   - Production/build environments should use Node 22+.
   - `package.json` now declares `engines.node >=22`.
   - Final verification ran on Node `v22.23.1`; `.nvmrc` and `package.json` pin the supported major version.

6. **Input/resource abuse controls**
   - Server-side limits are required because browser-only `maxLength` can be bypassed.
   - Current app-layer controls:
     - Support title: 5-120 characters.
     - Support detail: 20-2,000 characters.
     - Support creation: 5 requests per user per hour.
     - Admin support search: 120 characters.
     - Profile phone: 7-20 phone-safe characters.
     - Profile state: approved Nigerian state/FCT values only.
     - Profile organisation: 2-120 non-control characters.
     - Profile full name: at most 120 non-control characters.
     - Oral answer draft/final text: 5,000 characters.
   - Current Edge controls:
     - Candidate/admin payment JSON bodies: 2 KiB maximum.
     - Signed Paystack webhook body: 256 KiB maximum.
     - Payment initialization: 12 requests per user per 10 minutes.
     - Payment verification: 30 requests per user per 5 minutes.
     - Admin payment reconciliation: 20 requests per admin per 10 minutes.
     - Unknown and foreign references are rejected before contacting Paystack.
   - Production still requires Turnstile, reviewed Auth rate limits, custom
     SMTP, and active launch monitoring.

7. **Production email is a hard launch dependency**
   - Supabase's default SMTP is testing-only, restricts recipients, and is
     currently capped at two messages per hour.
   - Configure custom SMTP and verify signup/recovery to a non-team email
     before public launch.

## Clearance order

1. Complete every required production-dashboard item in
   `docs/PRODUCTION_CONFIG_CHECKLIST.md`, especially custom SMTP, Turnstile,
   Auth rate limits, redirects, backups, and live Paystack settings.
2. Apply production migrations and deploy the four payment Edge Functions.
3. Run the critical production smoke flows:
   - landing → sign up/sign in
   - module access → view practice sets
   - objective practice → submit → review
   - oral practice → exit/abandon behavior
   - payment initialize → verify → receipt
   - support request → request history
   - WhatsApp support on allowed routes only
4. If expecting a large announcement, repeat the full load profile against a
   production-like staging environment.
5. Make the final launch/no-launch call and monitor the first hour.

## Repeatable commands

```bash
npm run launch:check
npm run launch:check:full
```

`launch:check` is the fast local gate. `launch:check:full` adds browser regression, visual regression, and standard load smoke.
