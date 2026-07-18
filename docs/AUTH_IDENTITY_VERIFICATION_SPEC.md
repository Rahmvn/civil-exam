# PromotionSure Authentication and Identity Verification Specification

Status: execution-ready for local Gates 1-5. Hosted activation is not approved.

## Current architecture

- The browser uses one module-scoped `@supabase/supabase-js` 2.108.2 client.
- Release A retains the SDK's implicit flow. PKCE is not enabled.
- `public.handle_new_user()` creates `profiles` rows for pending `auth.users` rows.
- `public.ensure_my_profile()` is the sole idempotent profile recovery path.
- Browser pending state is UX state only. Supabase sessions are the authorization boundary.
- `src/lib/navigation.js` remains the redirect authority.

## Release A

Release A adds signup and recovery OTP interfaces while preserving existing email/password, implicit callback, and recovery-link behavior. The singleton exports a public initialization coordinator so callback completion remains classifiable without exposing raw Auth data. Browser testing showed that directly awaiting `auth.initialize()` after automatic construction stalls callback completion in this integration, consistent with current Supabase guidance to use Auth events rather than await initialization in ordinary browser clients. The coordinator therefore uses safe callback-category capture and public `getSession()` observation; it does not access private state, manually process tokens, or compete with automatic URL detection.

Signup must support both hosted auto-confirm behavior and confirmation-required behavior. A returned session skips OTP and clears stale pending state. A returned user without a session stores only normalized email, purpose, safe return route, expiry, and cooldown before showing OTP. Passwords are never persisted.

Signup codes are verified with `verifyOtp({ email, token, type: "email" })`. Recovery codes use `verifyOtp({ email, token, type: "recovery" })`. Signup resend uses `auth.resend({ type: "signup" })`; recovery resend repeats `resetPasswordForEmail()`. Their pending state and cooldowns are purpose-bound.

The recovery marker in session storage controls UX only. Before `updateUser({ password })`, the application must confirm an authenticated Supabase session and user. Browser state never selects the user whose password is changed.

## Callback policy

The singleton client owns automatic implicit callback processing. `AuthCallback` awaits the exported coordinator, reads the session afterward, uses idempotent profile recovery, restores only an approved internal destination, and navigates once. The coordinator pre-classifies only allowlisted callback error codes and discards descriptions. It never calls `exchangeCodeForSession()` in Release A.

After classification, callback cleanup removes all Auth query values and the complete URL fragment with `history.replaceState()`. Callback URLs, tokens, codes, provider payloads, CAPTCHA tokens, and raw Auth errors must never be logged.

## Provider rollout

Google and Turnstile remain remotely disabled. Turnstile-capable requests may be deployed behind a disabled feature flag. Hosted CAPTCHA is enabled only after the deployed frontend proves it can submit valid tokens; rollback disables hosted CAPTCHA first.

Resend is the preferred hosted Supabase delivery integration. Local templates are source material and are not automatically synchronized to hosted Supabase. Hosted SMTP, templates, Site URL, redirect allowlists, providers, and user data require separate approval.

## Staged PKCE migration

The installed SDK rejects implicit callbacks when configured for PKCE, so Release A must not set `flowType: "pkce"`. After OTP templates stop every legacy implicit-link workflow, record `legacy_link_cutover_at`, the actual maximum hosted link lifetime, and a safety buffer. Any later legacy issuance resets the clock.

Only after that period may a separate release configure PKCE. It must reuse the same initialization coordinator, keep automatic URL detection as the sole exchange owner, and never manually exchange the same code. Google remains disabled until the PKCE release is stable.

## Local Auth configuration

Local Supabase requires email confirmation, six-digit OTPs, version-controlled confirmation and recovery templates, and exact localhost callback URLs. Mailpit verifies rendering and delivery. Docker-dependent Auth, database, RLS, and full Playwright tests are required before local completion.

## Stale unverified accounts

No automatic cleanup is part of this work. A later approved hosted read-only audit must inspect `auth.users.email_confirmed_at`, age, identities, profiles, attempts, payments, access grants, support and audit records, and all foreign-key relationships. `STALE_UNVERIFIED_ACCOUNT_AGE_DAYS` remains a product-approved value in the 7-30 day planning range. Cleanup requires a backup, written plan, and separate destructive approval.

## Execution gates

1. Specification and repository audit.
2. Pure Auth utilities and Node tests.
3. Implicit-compatible OTP frontend and initialization coordinator.
4. Mocked, unit, Playwright, lint, build, scanner, and static verification.
5. Docker-dependent local Supabase, Mailpit, database, Auth integration, and E2E verification.
6. Separately approved compatible deployment and domain migration.
7. Separately approved Resend and OTP activation.
8. Later PKCE release after the recorded cutover wait.
9. Google and Turnstile activation as independent releases.
10. Approved hosted-data audit and separately approved cleanup.

## Prohibited without approval

- Hosted Auth, SMTP, template, URL, provider, DNS, or Vercel changes.
- Hosted production-data reads.
- User deletion or anonymization.
- PKCE or Google activation.
- Any competing profile-creation path.
