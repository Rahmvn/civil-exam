# Regression Testing

## Purpose

The regression suite checks the product at three boundaries:

1. PostgreSQL tests verify access, progression, retries, unanswered answers, review ownership, and row-level security.
2. Playwright tests verify public and authenticated routes, refreshes, mobile layout, core practice completion, result restoration, and answer review.
3. Manual and staging checks cover real devices, weak networks, payment-provider boundaries, and production-scale load.

Automated tests use local Supabase only. The runner rejects any remote Supabase URL before fixtures or browser tests start.

## Local Setup

Start Docker and the local Supabase stack:

```powershell
supabase start
```

Apply all migrations to a clean local database when schema changes need validation:

```powershell
supabase db reset
```

Run the suites:

```powershell
npm run test:db
npm run test:e2e
npm run test:regression
```

Use `npm run test:e2e:headed` when visually diagnosing a browser failure. Playwright traces, screenshots, and videos are retained only for failures.

## Test Personas

- Paid candidate: active local entitlement and access to every published fixture set.
- Free candidate: no entitlement, one selectable module, and the existing free retry policy.

The E2E setup recreates their attempt, progress, and entitlement state before each suite. Fixture questions are marked `E2E local regression fixture` and are never imported through the production content pipeline.

## Release Gates

A release candidate should not be approved until all of these are true:

- `npm run lint` and `npm run build` pass.
- Database policy and RLS tests pass from a clean local reset.
- Desktop and mobile Playwright projects pass.
- Serious and critical automated accessibility findings are resolved.
- Core journeys are checked on at least one low-end Android device, one current Android device, and one iPhone-class device.
- Slow-network, offline, refresh, back/forward, invalid URL, and expired-session states are checked.
- Staging load thresholds pass without calling or load-testing Paystack directly.
- Production error monitoring, rollback ownership, and incident contacts are ready.

## Load Testing Boundary

Load tests belong in staging after functional regressions are green. Model read-heavy dashboard traffic, practice-start bursts, and simultaneous submissions separately. Begin with 25, 100, and 250 concurrent sessions, then add a short spike and a longer soak based on measured capacity. Do not use production candidate accounts, production payment references, or live Paystack endpoints.
