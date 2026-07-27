# PromotionSure launch readiness

This is the working launch gate for PromotionSure. It should stay short, factual, and decision-oriented.

## Launch decision

Status: **not ready for public launch yet**

The product is close, but public launch should wait until the remaining verification and production-configuration gates are cleared.

## Release gates

| Gate | Status | Evidence / action |
| --- | --- | --- |
| Product UI direction | In progress | Core pages have been heavily refined. Final pass should focus only on launch-blocking clarity issues, not broad redesign. |
| Local launch check | Passing | `npm run launch:check` passes. This covers lint, build, tracked-secret scan, unit tests, database tests, payment edge tests, and operator read-only access. |
| Frontend build | Passing | Covered by `npm run launch:check`. Vite reports large chunks, but this is not a launch blocker. |
| Lint | Passing | Covered by `npm run launch:check`. |
| Unit tests | Passing | `npm run test:unit` passes: 94 tests. |
| Database tests | Passing | `npm run test:db` passes. |
| Payment edge tests | Passing | `npm run test:edge` passes. |
| Security scan | Accepted with documented exception | Tracked-secret scan passes. `npm audit --audit-level=high` reports the React Router RSC advisory, but the current app is a Vite client-side SPA with no React Router RSC/server API usage. Do not force-downgrade; monitor for a clean patched upgrade path. |
| Candidate E2E regression | Passing | `npm run test:e2e -- --project=public-desktop --project=public-mobile --project=paid-desktop --project=paid-mobile` passes: 34 tests. |
| Admin E2E regression | Passing | `npm run test:e2e -- --project=admin-desktop --project=admin-mobile` passes: 25 tests. |
| Free-candidate mobile E2E | Passing | `npm run test:e2e -- --project=free-mobile` passes: 3 tests. |
| Cross-browser critical E2E | Passing | `npm run test:e2e -- --project=critical-firefox --project=critical-webkit` passes: 6 tests. |
| Accessibility E2E | Passing | `npm run test:e2e -- --project=candidate-accessibility --project=admin-accessibility` passes: 10 tests. |
| Reliability E2E | Passing | `npm run test:e2e -- --project=reliability-desktop` passes: 6 tests. |
| Performance E2E | Passing | `npm run test:e2e:performance` passes: 3 tests using warmed-route local preview measurements. |
| Standard load test | Passing | `npm run test:load` passes. Local smoke profile reached 50 concurrent candidate reads, 25 admin reads, objective submit contention, and oral autosave contention with 0 failures. |
| Full local stress load | Not cleared | `npm run test:load:full` passes through 100 concurrent candidate reads but fails at 250-300 local candidate-read concurrency with `fetch failed` errors. Treat as a staging-capacity gate, not cleared by local smoke. |
| Visual regression | Passing | `npm run test:e2e:visual` passes: 4 tests. Current dashboard/access snapshots were inspected and intentionally refreshed after UI redesign. |
| Full E2E regression | Mostly cleared | Candidate, admin, free-mobile, cross-browser, accessibility, reliability, performance, and visual gates are passing. Full local stress remains a staging-capacity concern. |
| Operator/admin access check | Passing locally | `npm run test:operator-access` passes. The script now loads local `.env` when shell env vars are not already present. |
| Legal operator consistency | Passing | Privacy and Terms use Muraina Rasheedah as operator/data controller. |
| User-input abuse hardening | Passing locally | User-controlled text limits are enforced in the database and UI. Support requests remain capped and rate-limited; profile optional fields now have format/length constraints; oral answers are capped at 5,000 characters and late timeout submissions cannot overwrite the saved answer. |
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

2. **Full E2E suite is not fully cleared**
   - Candidate-facing public/paid desktop and mobile flows are now green.
   - Remaining launch pass should cover staging-capacity validation if a large launch spike is expected.

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
   - Local verification currently runs on Node `v20.20.2`, so production/staging must not inherit this local runtime.

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
     - Oral answer draft/final text: 5,000 characters.
   - Production still needs infrastructure controls for request rate, request body size, bot/abuse filtering, and edge logging.

## Clearance order

1. Run the remaining non-candidate Playwright launch gates:
   - staging-capacity check if expecting a large launch spike
2. Run the critical launch smoke flows:
   - landing → sign up/sign in
   - module access → view practice sets
   - objective practice → submit → review
   - oral practice → exit/abandon behavior
   - payment initialize → verify → receipt
   - support request → request history
   - WhatsApp support on allowed routes only
3. Confirm production environment variables and dashboard settings.
4. Make the final launch/no-launch call.

## Repeatable commands

```bash
npm run launch:check
npm run launch:check:full
```

`launch:check` is the fast local gate. `launch:check:full` adds browser regression, visual regression, and standard load smoke.
