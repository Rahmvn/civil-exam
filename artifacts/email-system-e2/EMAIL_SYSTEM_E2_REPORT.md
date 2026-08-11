# PromotionSure Email System E2 Implementation Report

Date: 11 August 2026
Scope: Local implementation and verification only. No production deployment, production mutation, Git commit, or Git push was performed.

## 1. Architecture

E2 adds an Admin Email Center on top of the existing E1 durable queue. An admin chooses one candidate, selected candidates, or a server-defined segment; previews the current authoritative audience; composes structured content or applies a template; sends an admin-only test where required; confirms the final server count; and finalizes the campaign through one set-based RPC. Finalization snapshots recipient outcomes and creates deterministic `transactional_email_events`. The existing E1 dispatcher remains the only production delivery path.

The candidate side exposes a narrow engagement preference and a signed, public unsubscribe endpoint. Transactional/support delivery remains separate from engagement consent.

## 2. Existing Campaign Components Preserved

Existing `email_campaigns` and `email_campaign_recipients` tables were evolved in place so historical rows remain available. Existing E1 queue, attempt, provider-event, suppression, lease, retry, webhook, receipt, and payment producer behavior remains intact. Historical direct-send campaigns are marked `delivery_mode = 'legacy_direct'`; E2 campaigns use `delivery_mode = 'e1_queue'`.

The old direct mutation RPC surface is revoked. A hidden legacy Admin campaign branch remains in `Admin.jsx` as dead compatibility code, but it is not rendered and cannot use the revoked backend mutations. Removing that branch is a later cleanup task, not an E2 behavior change.

## 3. Migrations

One append-only migration was added:

- `20260810114005_e2_admin_email_center.sql`

It creates E2 templates and runtime configuration, evolves campaign/recipient records, links campaigns to E1 events, defines authoritative audience and campaign RPCs, replaces queue claiming with engagement-aware claiming, adds preferences/unsubscribe operations, applies grants/revokes, and preserves historical campaign rows without enqueueing them.

## 4. Campaign Schema

`email_campaigns` now records:

- internal name, audience kind, segment key/parameters, deliberate user IDs, and category;
- structured subject, preheader, plain-text body, optional CTA label and HTTPS URL, and template reference;
- `legacy_direct` or `e1_queue` delivery mode;
- test status, deterministic tested fingerprint, provider test ID/error, and actor/timestamp fields;
- queue, pause, resume, cancellation, completion, and final eligible/excluded counts.

Queued campaign content is immutable. Material draft changes clear the prior test result and fingerprint.

## 5. Recipient Schema

`email_campaign_recipients` keeps one row per campaign/user and records the current Auth-derived address used for diagnostics, display name, inclusion, eligibility state, exclusion reason, queue status, linked E1 event, and queue/cancellation timestamps. A unique event link prevents more than one recipient row from owning an event. Current delivery still resolves from `auth.users` at dispatch instead of trusting a stale profile or campaign snapshot.

## 6. E1 Event Integration

`transactional_email_events` gains nullable `campaign_id` and `campaign_recipient_id` links plus supporting uniqueness/indexes. Campaign finalization creates one deterministic event key per campaign/user and uses `ON CONFLICT DO NOTHING`, making finalization idempotent. The E1 dispatcher validates campaign recipients immediately before provider delivery, renders the campaign through shared Email Core, applies the same lease/retry/attempt system, and lets event transitions refresh campaign recipient/result state.

No second queue or delivery truth was introduced.

## 7. Audience Catalogue And Exact Semantics

All segments require a candidate profile and, unless stated otherwise, a confirmed Auth account.

1. `all_confirmed`: Auth email is confirmed.
2. `paid`: confirmed and has at least one payment order with `fulfillment_status = fulfilled`.
3. `unpaid`: confirmed and has no fulfilled payment order.
4. `active_access`: confirmed and has at least one active entitlement with a future expiry.
5. `expired_access`: confirmed, has expired/non-active entitlement history, and has no active entitlement.
6. `started_practice`: confirmed and has at least one objective or oral attempt.
7. `never_practised`: confirmed and has no objective or oral attempt.
8. `practised_unpaid`: confirmed, has practised, has no fulfilled payment, and has no active access.
9. `incomplete_checkout`: confirmed and has a pending, non-fulfilled checkout created from 30 minutes through 30 days ago with at least one snapshotted order-item module that was not subsequently satisfied. Satisfaction is module-specific: a later fulfilled order containing that module, a later effective item access outcome, or an entitlement created for that module after the abandoned checkout removes that item from the outstanding purchase. Prior fulfilled purchases and pre-existing or unrelated access do not disqualify the candidate. A bundle remains incomplete while at least one intended module remains unsatisfied.
10. `active_module_access`: confirmed and has an active, unexpired entitlement for the validated module parameter.
11. `joined_last_7_days`: confirmed and candidate profile creation is within seven days.
12. `joined_last_30_days`: confirmed and candidate profile creation is within 30 days.
13. `latest_objective_passed`: confirmed and the latest completed objective attempt, globally or for an optional validated module, has stored `passed = true`.
14. `latest_objective_needs_retry`: confirmed and the latest completed objective attempt, globally or for an optional validated module, has stored `passed = false`.

Unknown segment keys, unknown modules, malformed parameters, and unsupported parameter combinations are rejected server-side.

## 8. Pass/Fail Segment Decision

Pass/fail segmentation is implemented because `attempts.passed` is an authoritative stored outcome. E2 does not recalculate marks or invent a pass threshold. It selects the latest completed attempt by `completed_at`, then `id`, and reads the stored boolean. An optional validated module narrows that latest-attempt lookup.

## 9. Preview/Finalization Model

Preview is a current server query that returns authoritative eligible, excluded, and total counts plus bounded rows and reasons. It is advisory, not a send snapshot.

Finalization locks the draft, validates the exact test fingerprint where required, reruns the audience against current Auth/payment/access/practice/preference/suppression/frequency facts, snapshots all eligible and excluded recipient outcomes set-wise, enforces the campaign maximum, creates E1 events set-wise, and records final counts. Payment, access, or preference changes between preview and finalization therefore produce the final server truth rather than stale browser truth.

## 10. Category Rules

`support` is restricted to exactly one explicitly selected candidate. It cannot target selected-user groups or segments. `engagement` may target one candidate, deliberate selected candidates, or an approved segment. Segment campaigns must be engagement. Technical suppression and valid current addresses apply to both categories; engagement opt-out and engagement frequency limits apply only to engagement.

## 11. Test-Send Gate

A successful test is mandatory for every selected-user or segment campaign and for every engagement campaign. Individual support mail may be queued without a test. Tests are sent only to the authenticated admin's current Auth email through the bounded `admin-email-campaign` function.

The database fingerprints audience definition, category, subject, preheader, body, CTA, and template. Finalization accepts a test only when the stored successful fingerprint matches the current draft. A material edit immediately invalidates the gate. Test attempts are rate-limited and audited.

## 12. Content/Template Model

E2 uses structured plain text, not arbitrary HTML. Subject is bounded to 160 characters, preheader to 200, body to 5,000, CTA label to 80, and CTA URL must be HTTPS and bounded to 500 characters. Shared rendering escapes all dynamic text. The only supported merge field is `{{first_name}}`; unsafe HTML/script content remains text, and `javascript:`/`data:` CTAs are rejected.

Five active templates are seeded: Incomplete checkout, Practised but unpaid, Getting started, General support, and Custom message. Queued events contain their own structured content snapshot, so later template edits cannot mutate queued mail.

## 13. Queue Migration

Only explicit E2 finalization creates campaign events. Historical recipients are not migrated into dispatchable jobs. Campaign events use deterministic keys, `recipient_email = null`, the candidate `user_id`, campaign metadata, six maximum attempts, and E1 pending state. Current Auth address resolution stays in the dispatcher. The browser does not insert recipients or events sequentially.

## 14. Pause/Resume/Cancel Semantics

Pause prevents new claims and is rechecked immediately before provider dispatch. A campaign event claimed before the pause is released from its exact lease back to pending without consuming an attempt, so Resume can make it claimable again. Cancel remaining immediately cancels unclaimed/retryable work and is also rechecked before provider dispatch; a previously claimed event then completes as cancelled and records no provider message. A provider request already underway cannot be recalled and may still be accepted. These checks apply only to campaign events and do not block transactional payment messages or unrelated campaigns. Every control requires current admin authorization and writes an audit record.

## 15. Priority

The shared claim query orders by ascending event priority, due time, creation time, and ID. Existing critical transactional events keep their higher service priority. E2 support events use priority 20 and E2 engagement events use priority 50, so campaign traffic cannot outrank critical payment/receipt delivery. Engagement cap logic does not constrain non-engagement events.

## 16. Daily Engagement Safety

`email_runtime_config.engagement_daily_cap` defaults to 50 accepted-or-currently-processing engagement events per UTC day. Claiming uses a transaction advisory lock, computes remaining capacity, and admits only that many engagement rows while still claiming eligible transactional/support work. Deferred engagement events stay queued for a later period. The cap is server-authoritative.

## 17. Frequency Safety

`engagement_min_interval_hours` defaults to 168 hours. Preview/finalization excludes candidates with a recently accepted engagement email. Send-time validation checks the interval again, so queued recipients that become too recent are skipped safely. Support email is not blocked by this engagement-only rule.

## 18. Unsubscribe Architecture

Campaign engagement events receive an HMAC-authenticated unsubscribe URL generated by Email Core from `EMAIL_UNSUBSCRIBE_SECRET`. The token is versioned and purpose-bound to the engagement scope; it intentionally contains no expiry. It remains valid while `EMAIL_UNSUBSCRIBE_SECRET` is unchanged, and rotating that secret invalidates all previously issued unsubscribe links. The public `email-unsubscribe` Edge Function uses `verify_jwt = false` because possession of a valid signed token is the authorization mechanism. GET validates the token and renders a confirmation without mutation. POST validates again and invokes only the narrow service-role unsubscribe RPC. Tokens are tamper-resistant and non-enumerating. Repeated POST is idempotent.

## 19. Preference Behavior

Candidates can disable or re-enable PromotionSure engagement email from Profile. The setting maps to the existing `email_preferences.marketing_opted_out` truth and preserves any prior opt-out rather than resetting it during migration. Opt-out excludes engagement during preview, finalization, and send-time validation. Re-enabling engagement does not remove an independent bounce/complaint suppression; technical suppression remains authoritative.

## 20. Provider-Header Changes

The shared provider accepts a narrow optional unsubscribe URL and emits only:

- `List-Unsubscribe: <signed HTTPS URL>`
- `List-Unsubscribe-Post: List-Unsubscribe=One-Click`

Callers cannot inject arbitrary provider headers. Campaign messages also carry a safe provider tag identifying campaign source; body text and recipient lists are not logged.

## 21. Admin IA/UX

Admin navigation now includes Email with three views: Campaigns, Delivery, and Templates. Campaigns provides search/status filtering, clear status/progress language, and Compose email. Compose supports individual lookup, deliberate multi-selection, or a server segment; bounded candidate rows; current selected-user context; authoritative preview counts/reasons; structured message fields; template application; test state; and final confirmation. Users also exposes `Email user` and `Email selected` entry points. The individual category control states that Support is for service/account communication rather than promotional messaging; server rules continue to limit Support to one candidate.

The responsive design uses the existing PromotionSure Admin shell, native radios/checkboxes/selects, visible focus, bounded candidate scrolling, 320px reflow, and no horizontally clipped controls.

## 22. Campaign Detail/Results

Campaign detail separates accepted/queued/processing/delivered/bounced/suppressed/failed/cancelled outcomes instead of treating provider acceptance as delivery. Recipient results are server-paginated and support server-side search/state filtering. Pause, resume, and cancel actions appear only when semantically available. Counts derive from recipient/E1 delivery truth, and provider failures remain diagnostic rather than silently becoming success.

## 23. User Email History

Admin individual compose displays the candidate's current Auth email, engagement preference, technical suppression status, and bounded application email history across transactional and campaign mail. History includes dispatch/delivery state and attempt count without exposing body content. It explicitly excludes Auth OTP/recovery mail because PromotionSure does not own that delivery history. The admin RPC is protected; candidates cannot enumerate another user's history.

## 24. Historical Campaign Cutover

Existing campaign rows are retained as `legacy_direct`. The migration does not enqueue historical recipients, retry old failures, rewrite old successes, or invent provider events. New E2 create/update/finalize operations require `e1_queue`. Historical records remain readable in shared history/diagnostics, and the legacy direct mutation functions are no longer executable by browser roles.

## 25. Security/RLS

All exposed E2 tables have RLS enabled and browser access revoked. Admin data operations run through guarded RPCs that call `is_admin()`. Candidate preference RPCs scope reads/writes to `auth.uid()`. Internal audience helpers live in the non-exposed `private` schema. Public `SECURITY DEFINER` functions have explicit `public, pg_temp` search paths and explicit grants; system functions are service-role only. Current Auth email is authoritative, recipient enumeration is admin-only, content is bounded, arbitrary HTML is unavailable, and secrets are not logged or returned.

## 26. Secrets/Config Names

Required secret/config names introduced or used by E2:

- `EMAIL_UNSUBSCRIBE_SECRET`: required long random HMAC secret, distinct from other secrets.
- `EMAIL_UNSUBSCRIBE_URL`: optional public endpoint override; defaults to the project function URL.
- Existing `RESEND_API_KEY`, `TRANSACTIONAL_EMAIL_FROM`, `TRANSACTIONAL_EMAIL_REPLY_TO`, and E1 dispatcher/service credentials remain unchanged.
- `engagement_daily_cap`, `engagement_min_interval_hours`, and `max_campaign_recipients` are database runtime configuration, not frontend constants or secrets.

`.env.example` contains names/placeholders only.

## 27. Production Rollout Requirements

No rollout action was performed. A later controlled rollout should:

1. Reconfirm the production migration boundary and create recovery backups.
2. Apply only the new append-only E2 migration after dry-run review.
3. Configure a new `EMAIL_UNSUBSCRIBE_SECRET` and, only if needed, `EMAIL_UNSUBSCRIBE_URL` without exposing values.
4. Deploy only the changed/new functions: `admin-email-campaign`, `process-email-dispatch`, and `email-unsubscribe`.
5. Verify function auth configuration, candidate preference RPCs, admin authorization, signed GET/POST unsubscribe behavior, queue priority/caps, and a safe admin-address test before enabling real campaign operations.
6. Deploy the frontend after database/functions are verified, then monitor E1 attempts, campaign skips, suppression, and dispatcher capacity.

Do not alter Payment Domain semantics, Resend webhook configuration, or the existing dispatcher Cron merely to release E2.

## 28. Tests/Counts

Completed verification:

- ESLint: pass.
- Production build: pass; 343 modules transformed and three SEO route pages generated.
- Unit tests: 138 pass.
- Database pgTAP: 21 files and 600 assertions pass.
- Focused E2 pgTAP: 70 assertions pass, including purchase-specific incomplete-checkout fulfillment and claim/pause/cancel races.
- Database advisors: no issues.
- Email Core integration: pass, including signed unsubscribe GET/POST, tamper rejection, replay idempotency, unknown-user non-enumeration, resubscribe, and suppression independence.
- Payment Edge integration: pass, covering payment/refund/dispute/replay/webhook security regressions.
- Admin Email Center E2E: 7/7 pass across desktop/mobile, including individual compose/queue, segment preview, templates/delivery, deliberate multi-selection, bulk test gate, controls, screenshots, and 320px reflow.
- Admin Email Center accessibility: pass with no serious/critical WCAG 2 A/AA automated violations.
- Access/payment regression: 21 bundle-desktop and three free-mobile tests pass; the prior paid candidate/profile/access smoke remains green.
- Secret scan: pass across 863 files at the final implementation gate.
- `git diff --check`: pass; only Windows LF-to-CRLF working-copy advisories were emitted.

Full `test:security` remains non-green only because the existing dependency audit reports high-severity advisories in transitive `brace-expansion` and `nanoid`. E2 did not change `package.json` or the lockfile, and no unrelated dependency upgrade was attempted.

## 29. Screenshots/Visual Verification

The final full-page captures are stored in `artifacts/email-system-e2/screenshots/`:

- Desktop: `admin-desktop-campaigns.png`, `admin-desktop-individual-compose.png`, `admin-desktop-segment-preview.png`, `admin-desktop-templates.png`.
- Mobile 390: `admin-mobile-campaigns.png`, `admin-mobile-individual-compose.png`, `admin-mobile-segment-preview.png`, `admin-mobile-templates.png`.

Each capture was inspected at full resolution. Campaign, compose, preview, and template hierarchy is clear; action prominence matches operational risk; recipient counts and test state are visible; campaign/template rows remain flat rather than card-heavy; mobile controls recompose without clipping; bounded lists indicate continued content; and a separate automated 320px check confirms no horizontal overflow.

## 30. Unresolved Risks

- The Campaigns UI loads a bounded 50-row server result and filters that loaded set client-side. Recipient results are fully server-paginated/searchable, but campaign catalogue pagination is a future scale improvement.
- Audience preview RPCs are bounded and database-driven, but the current UI shows the first preview page rather than exposing preview pagination controls.
- Campaign, recipient, attempt, and provider history is intentionally retained for support. A formal retention/archive policy will be needed as volume grows.
- The hidden legacy campaign UI branch in `Admin.jsx` can be removed in a later cleanup after the historical read path is explicitly separated; its mutation RPCs are already revoked.
- The existing dependency-audit findings for `brace-expansion` and `nanoid` should be resolved in a separately scoped dependency update with full regression testing.
- Two untracked purchase-modal backup files are unrelated to E2 and were left untouched. `supabase/.temp/cli-latest` and an older screenshot changed during local tooling/test execution and should be excluded from any later E2 commit unless deliberately reviewed.

No E3 lifecycle automation was implemented.
