# User Problem Resolution Audit

Status: implementation in progress  
Audit date: 16 July 2026  
Scope: candidate, administrator, authentication, content, practice, oral practice, access, payment, database, Edge Functions, browser state, and operations

## 1. Objective

Every problem must leave the user in a truthful and recoverable state. The application must answer four questions without exposing infrastructure details:

1. What happened?
2. Was the user's work, payment, or access affected?
3. What can the user safely do next?
4. When must the application or support team resolve it instead?

"Please try again" is not a complete resolution when a retry can duplicate a payment, lose an answer, restart a timed session, or conceal a configuration defect.

## 2. Audit Method and Coverage

The audit traced:

- all public and protected routes in `src/App.jsx`;
- all exported operations in `src/lib/appApi.js`;
- all UI catch paths and explicit error/notice states;
- authentication hydration, role guards, redirects, and browser session expiry;
- objective and oral attempt lifecycle RPCs;
- module lifecycle, free access, paid access, and progression state;
- payment initialization, provider verification, webhook fulfillment, history, and receipts;
- admin content creation, import, validation, publication, correction, archival, and deletion;
- local browser state used for in-progress practice;
- request retry/timeout behavior and current automated reliability coverage;
- tracked configuration and secret handling.

Audit snapshot:

- 22 route entries including redirects and fallback handling;
- more than 40 application API operations;
- 122 distinct database business-exception messages across migrations;
- 3 payment Edge Function boundaries;
- 14 page/component areas with explicit exception handling;
- 2 dedicated end-to-end recovery tests before this programme began.

## 3. Severity and Ownership

| Severity | Meaning | Examples | Required response |
| --- | --- | --- | --- |
| P0 | Security, money, or cross-user data is at immediate risk | exposed secret, forged payment, broken RLS | block release, contain, rotate/revoke, investigate |
| P1 | User may lose paid access, submitted work, or become locked out | successful payment not fulfilled, ambiguous submission, profile/role hydration failure | preserve state, provide deterministic recovery, alert operations |
| P2 | A core journey is blocked without loss | module load failure, practice start conflict, password forgotten | explain cause and provide an immediate next action |
| P3 | A secondary area is degraded | review history partial failure, receipt generation issue | keep usable content, identify unavailable section, allow retry |
| P4 | Cosmetic or low-impact clarity defect | stale save label, weak empty-state copy | repair in normal UI work |

Ownership is assigned by source of truth:

- User: invalid input, cancelled provider flow, declined card, lost connection.
- Application: stale browser state, rendering defect, missing recovery control, unsafe retry.
- Backend: business-rule conflict, transaction failure, RLS/configuration mismatch.
- Content operations: unpublished, incomplete, archived, or incorrectly configured content.
- Payment provider: provider processing, outage, delayed confirmation, reversal.
- Support/operations: successful payment without fulfillment, identity correction, repeated unknown failure.

## 4. Standard Problem Model

Every handled problem should have these fields internally, even when the UI only shows one sentence and one action:

| Field | Purpose |
| --- | --- |
| `code` | Stable application code; never infer behavior from display copy |
| `kind` | offline, timeout, authentication, authorization, validation, conflict, unavailable, payment, server, or unknown |
| `source` | browser, UI, Supabase Auth, REST/RPC, database, Edge Function, Paystack, or content configuration |
| `operation` | The action that failed |
| `impact` | none, view unavailable, unsaved input, uncertain write, access delayed, or money at risk |
| `retrySafety` | safe, safe-after-status-check, or unsafe |
| `userAction` | retry, reconnect, correct field, sign in, resume, check status, return, or contact support |
| `supportAction` | inspect event, reconcile payment, repair access, correct profile, republish content, or deploy fix |
| `reference` | Payment reference or server-generated incident ID where support can trace it |

UI copy is derived from the code. UI copy must never be used as the business-state source of truth.

## 5. Safe Retry Policy

| Operation | Retry policy | Reason |
| --- | --- | --- |
| Catalogue, progress, history, review reads | automatic retry once, then manual retry | reads are idempotent |
| Profile refresh | automatic retry once, then explicit retry | prevents false role/account state |
| Profile update | manual retry; retain field values | update is idempotent for the same payload |
| Oral draft save | automatic bounded retry; retain local draft | latest text can safely replace earlier text |
| Oral advance | reconcile server state before another write | question may already have advanced |
| Objective submission | check for completed attempt before retry | duplicate attempts must not be created |
| Payment initialization | never blind-auto-retry | can create multiple provider references |
| Payment verification | safe to retry by the same reference | verification and fulfillment must be idempotent |
| Admin create/import/publish/delete | refresh server state before retry | the first transaction may have committed |

## 6. Comprehensive Journey Inventory

### 6.1 Application startup and navigation

| ID | Failure | Current risk | Required resolution | Priority |
| --- | --- | --- | --- | --- |
| NAV-01 | Missing frontend environment variables | App throws before rendering | deployment health check; operator-facing configuration message; block release | P1 |
| NAV-02 | JavaScript render exception | Generic home-only route card | classify route error, retry current route, safe dashboard/home exit, production event | P1 |
| NAV-03 | Unknown URL | Safe home link exists | retain; offer dashboard when authenticated | P3 |
| NAV-04 | Lazy/static asset load failure | Browser-level blank or stale page possible | reload action and deployment-version detection | P2 |
| NAV-05 | Browser offline during navigation | Per-request generic network copy | global connection state; preserve current screen and input | P2 |
| NAV-06 | Partial dashboard read failure | Some failures can resemble genuine zero/empty state | label only affected section, retain last good data, section retry | P1 |
| NAV-07 | Stale client after deployment | Schema markers become “being prepared” | distinguish incompatible client/schema and require refresh | P1 |

### 6.2 Authentication and account

| ID | Failure | Current risk | Required resolution | Priority |
| --- | --- | --- | --- | --- |
| AUTH-01 | Incorrect email/password | Clear message exists | retain field values; allow password recovery | P2 |
| AUTH-02 | Forgotten password | No implemented recovery journey | email reset request, safe confirmation, expiring-link handling, password update | P1 |
| AUTH-03 | Weak/mismatched password | Inline feedback exists | bind errors to fields and preserve entered email/name | P3 |
| AUTH-04 | Duplicate/unconfirmed email | Provider text may fall to generic copy | explicit account-exists and confirmation guidance | P2 |
| AUTH-05 | Google OAuth cancelled/disabled | Callback offers email fallback | retain intended destination and distinguish cancellation from outage | P2 |
| AUTH-06 | Expired/revoked session | Guard returns to sign-in | preserve safe return path and unsaved local practice | P1 |
| AUTH-07 | Profile hydration fails | Failure is swallowed and profile becomes null | block role-dependent UI, expose retry, never infer candidate/admin from null | P1 |
| AUTH-08 | Profile row missing | Automatic ensure operation exists | show recoverable account setup state if repair fails | P1 |
| AUTH-09 | Sign-out network failure | Modal retry exists | offer local sign-out only when server sign-out repeatedly fails | P3 |
| AUTH-10 | Name/email correction needed | No support workflow | authenticated support request with field and audit trail | P2 |

### 6.3 Module discovery and access

| ID | Failure | Current risk | Required resolution | Priority |
| --- | --- | --- | --- | --- |
| MOD-01 | Subject catalogue fails | Fallback catalogue may look authoritative | mark data unavailable; never infer purchase/start state from fallback | P1 |
| MOD-02 | Catalogue, batch access, and progress disagree | Incorrect CTA or state mismatch | server catalogue is authority; detect contradiction; suppress unsafe CTA; report | P1 |
| MOD-03 | Draft/coming-soon/retired module | Copy can vary by screen | one lifecycle mapping and one allowed-action matrix | P2 |
| MOD-04 | Active but no published set | Can appear actionable | “Practice is not available yet”; no start action | P1 |
| MOD-05 | Published but sale disabled | Unlock can lead to unavailable purchase | hide purchase action; show content availability truthfully | P1 |
| MOD-06 | Free module already assigned | Generic locked state | identify assigned module and offer continue/unlock choices | P2 |
| MOD-07 | Entitlement exists but UI says locked | User distrust/access loss | refresh entitlement; server-side reconciliation; support path | P1 |
| MOD-08 | UI says unlocked but start is denied | Contradictory state | refresh authoritative state and explain changed access | P1 |

### 6.4 Objective practice

| ID | Failure | Current risk | Required resolution | Priority |
| --- | --- | --- | --- | --- |
| OBJ-01 | Start request fails before allocation | Generic retry | preserve selected module/set and give safe retry | P2 |
| OBJ-02 | Start succeeds but navigation fails | Batch can exist only in browser launch storage | recover from server/start context on route reload | P1 |
| OBJ-03 | Questions unavailable after start | User reaches dead end | invalidate stale launch, return to module, refresh publication state | P1 |
| OBJ-04 | Refresh during active attempt | Warning exists; answers may be local only | durable local draft with attempt identity and expiry | P1 |
| OBJ-05 | Browser/tab closes | Answers can be lost | restore draft or clearly state non-restorable state before start | P1 |
| OBJ-06 | Submit times out | Outcome may be uncertain | submission idempotency key; query result before offering retry | P1 |
| OBJ-07 | Duplicate submit click | Button disabling helps only one tab | server idempotency constraint | P1 |
| OBJ-08 | Access/content changes mid-attempt | Submission may be rejected | allow valid allocated attempt to complete or return precise resolution | P1 |
| OBJ-09 | Result/review link missing attempt ID | “Could not be found” | return to review history and recover latest completed attempt | P2 |
| OBJ-10 | Review data partially fails | Whole detail may become unavailable | preserve summary; retry failed answer data | P3 |

### 6.5 Oral practice

| ID | Failure | Current risk | Required resolution | Priority |
| --- | --- | --- | --- | --- |
| ORAL-01 | Another oral attempt is active | Server rejects a different set | return active attempt metadata and “Resume” action | P1 |
| ORAL-02 | Draft autosave fails | Local in-memory answer can disappear on close | durable local draft, visible unsaved state, automatic reconciliation | P1 |
| ORAL-03 | Timer expires while offline | Advance outcome is uncertain | lock local answer/time, reconcile server question before advancing | P1 |
| ORAL-04 | Advance succeeds but response is lost | Repeated advance can conflict | treat server attempt state as authority and resume next question | P1 |
| ORAL-05 | Current/next question removed | Server exception | preserve attempt; content-operations incident; safe exit and support | P1 |
| ORAL-06 | Review requested before completion | Server blocks model answers | return to active attempt with resume action | P2 |
| ORAL-07 | Self-rating save fails | Error shares page-level state | per-question retry; do not obscure completed review | P3 |
| ORAL-08 | Answer exceeds limit | Error appears after writing | enforce visible client limit before save/advance | P2 |

### 6.6 Payment and entitlement

| ID | Failure | Current risk | Required resolution | Priority |
| --- | --- | --- | --- | --- |
| PAY-01 | Module is not purchasable | Modal/CTA contradiction possible | sale eligibility from server catalogue; prevent initialization | P1 |
| PAY-02 | Initialization cannot reach Edge Function | Generic failure | safe retry only before a reference exists; retain modal | P2 |
| PAY-03 | Initialization creates reference but response is lost | User may create another order | idempotency key or recover most recent initialized order | P1 |
| PAY-04 | User cancels/closes Paystack | Declined/abandoned record can mislead | do not show in payment history; allow a fresh purchase | P2 |
| PAY-05 | Provider declines payment | Must not appear pending | no history entry; clear “not charged/unlocked” where known | P1 |
| PAY-06 | Provider is processing | Cannot call it awaiting user payment | show processing and status check; no duplicate payment prompt | P1 |
| PAY-07 | Payment succeeds and fulfillment succeeds | Verified history/receipt | retain immutable reference and access dates | P0 |
| PAY-08 | Payment succeeds but access activation fails | Money taken, no access | “Payment received, access needs attention”; automatic reconcile; urgent support | P0 |
| PAY-09 | Callback missing/modified reference | Cannot verify | return to Access and locate owned payment; never accept foreign reference | P1 |
| PAY-10 | Callback not reached | Webhook should fulfill | Access refresh must discover entitlement/history without callback | P1 |
| PAY-11 | Duplicate webhook/verification | Duplicate entitlement risk | idempotent transaction and replay tests | P0 |
| PAY-12 | Amount/currency/module mismatch | Fraud/configuration risk | reject, record security event, do not fulfill | P0 |
| PAY-13 | Provider reversal/refund | Access/history can become inaccurate | explicit reversal state and entitlement policy | P1 |
| PAY-14 | Receipt generation fails | Payment remains valid | preserve verified row and offer receipt retry/reference copy | P3 |

### 6.7 Profile and support

| ID | Failure | Current risk | Required resolution | Priority |
| --- | --- | --- | --- | --- |
| PROF-01 | Optional detail save fails | Values remain in form today | classify validation/network; retry without clearing | P3 |
| PROF-02 | Service level is wrong but locked | Copy says contact support without a path | authenticated correction request and status | P2 |
| PROF-03 | Support is required | No concrete support channel exists | in-app support request with category, reference, and consented context | P1 |
| PROF-04 | User repeatedly encounters unknown error | No production event/reference | server-generated incident ID and support lookup | P1 |

### 6.8 Admin and content operations

| ID | Failure | Current risk | Required resolution | Priority |
| --- | --- | --- | --- | --- |
| ADM-01 | Invalid module/set/question fields | Database copy is shown inconsistently | client field validation plus authoritative server errors | P2 |
| ADM-02 | Import parse/validation failure | Good local validation exists | preserve complete row-level errors and no partial write | P1 |
| ADM-03 | Import request times out after commit | Admin may retry same file | checksum idempotency and refresh-before-retry | P1 |
| ADM-04 | Publish transition fails validation | Action blocked | show all blockers with links to affected content | P2 |
| ADM-05 | Publish commits but UI times out | Repeat transition/confusion | reload set state and audit log before retry | P1 |
| ADM-06 | Correction conflicts with another admin | Stale screen | optimistic concurrency/version check and refresh conflict UI | P1 |
| ADM-07 | Delete/archive dependency prevents action | Exception exists | show dependency and valid alternative | P2 |
| ADM-08 | Audit logs unavailable | Mutation still possible without visibility | disable high-risk operations or flag degraded audit visibility | P1 |
| ADM-09 | Admin role/profile hydration fails | Could be redirected as candidate | block until profile authority is known | P1 |

### 6.9 Platform, security, and operations

| ID | Failure | Current risk | Required resolution | Priority |
| --- | --- | --- | --- | --- |
| OPS-01 | Secrets committed in example configuration | Credentials may be recoverable from history | remove values, strengthen scanner, rotate/revoke every exposed secret | P0 |
| OPS-02 | Production errors are logged only in development | No incident correlation | sanitized server-side event capture and alerting | P1 |
| OPS-03 | No health/readiness check | Configuration failure discovered by users | deployment smoke checks for app, DB, Auth, Edge Functions | P1 |
| OPS-04 | No user-visible incident state | Repeated retries during outage | operational status message with unaffected journeys retained | P2 |
| OPS-05 | Database/client versions drift | Misleading schema/content message | version compatibility check and forced refresh/deploy rollback | P1 |
| OPS-06 | Rate limiting | Generic transient behavior | wait guidance, cooldown, abuse monitoring | P2 |
| OPS-07 | Browser storage unavailable/corrupt | Practice launch/draft recovery fails | validate storage, degrade explicitly, never crash | P2 |
| OPS-08 | Unsupported browser/time skew | Timers/auth can disagree | server time authority and supported-browser guardrails | P2 |

## 7. User-Facing Resolution Patterns

Use the smallest pattern that fully resolves the state:

- Field error: beside the field, with focus moved to the first invalid field.
- Action error: directly below the action; retain input and keep a safe retry available.
- Section failure: replace only that section, keep the rest of the page usable.
- Page failure: concise heading, one explanation, primary recovery, safe exit.
- Connectivity status: thin global line, no modal, automatically clears after reconnection.
- Conflict: explain the existing state and navigate to it; do not call it a generic error.
- Payment attention: state whether payment succeeded, whether access is active, and what happens next.
- Support escalation: show a traceable reference and a concrete contact/request action.

Do not use success, pending, verified, declined, or unlocked labels unless the authoritative provider and fulfillment fields support them.

## 8. Observability and Privacy

Production event capture should record only:

- stable problem code;
- operation and route;
- authenticated user ID when available;
- payment/order reference only for payment incidents;
- HTTP/provider category, not raw provider payload;
- app version, timestamp, and correlation ID;
- whether a retry/recovery succeeded.

It must not record passwords, tokens, full answers, model answers, service-role keys, payment card data, raw authorization headers, or full imported question files.

Alert immediately on:

- successful provider payment with failed fulfillment;
- amount, currency, ownership, or signature mismatch;
- repeated profile/role hydration failures;
- repeated submission uncertainty;
- cross-user/RLS denial anomalies;
- payment webhook failure spike;
- render-error or incompatible-schema spike.

## 9. Resolution Workflow

1. Detect and classify the problem at the boundary where it occurs.
2. Preserve user input and last known truthful server state.
3. Determine whether retry is safe.
4. Reconcile uncertain writes against the server before another mutation.
5. Present one primary recovery action and, only where useful, one safe exit.
6. Escalate money, access, identity, and repeated unknown failures with a traceable reference.
7. Verify that recovery actually restored the journey.
8. Record the incident outcome for operations and regression tests.

## 10. Implementation Plan

### Phase A: Containment and shared foundations

- Remove tracked credential values and expand secret scanning.
- Introduce stable problem classification independent of display copy.
- Add global offline/online status.
- Make route/render failures retryable and attributable.
- Expose profile hydration failure; block role-dependent routes until resolved.
- Implement password reset and expired-link recovery.

### Phase B: Protect money and work

- Complete payment order idempotency and recover initialized orders.
- Add automatic fulfillment reconciliation and payment-attention escalation.
- Add objective submission idempotency and result lookup.
- Persist objective and oral drafts locally with explicit save state.
- Reconcile oral advance after timeout/network uncertainty.

### Phase C: Consistent screen recovery

- Replace ad hoc page strings with problem codes and shared notices.
- Add section-level retry on Dashboard, Access, Review, and module pages.
- Return active oral/practice conflict metadata and resume actions.
- Add field-linked admin validation and refresh-before-retry mutations.

### Phase D: Support and operations

- Add sanitized error-event storage and correlation IDs.
- Add an authenticated support request flow for payment, access, profile, and unknown incidents.
- Add admin support lookup/reconciliation tools with audited actions.
- Add health checks, alerting, incident copy, and release smoke tests.

## 11. Verification Matrix

Every problem class requires tests at the lowest useful layer and at least one journey test:

- Unit: classification, copy, retry safety, local-state recovery.
- Database: authorization, business conflicts, idempotency, transaction rollback.
- Edge: provider status, ownership, amount/currency, replay, delayed fulfillment.
- End to end: offline, expired session, forgotten password, partial page load, uncertain submit, oral reconnect, payment callback loss, fulfillment attention, and route crash.
- Accessibility: alerts announced once, focus reaches error/recovery action, controls remain keyboard usable.

Release gates:

- no P0 or P1 item remains without an implemented containment and tested recovery;
- no mutation is blindly retried unless idempotency is proven;
- no empty state can be produced solely by a failed read;
- no payment label contradicts provider or fulfillment state;
- no timed answer is discarded without a visible warning and recovery attempt;
- every protected route handles unknown profile/role state safely;
- every user-facing error has a next action or explicitly states that no action is required;
- all support-required states provide a real support path and traceable reference.

## 12. Current Implementation Record

- Completed: truthful payment-history state model and filtering.
- Completed: payment verification/fulfillment distinction in the Access UI.
- Completed: direct module unlock and free-practice confirmation without unnecessary navigation.
- Completed: tracked example credentials removed; secret scan expanded to test keys and JWT-shaped values.
- Completed: shared problem classification, connectivity, profile-role recovery, password recovery, and route recovery.
- Completed: authenticated help requests with categories, optional payment references, user-visible status, and admin-readable records.
- Completed: administrator help queue with status updates, resolution notes, and audited changes.
- Completed: recoverable Paystack initialization with one live checkout per candidate/module and replay coverage.
- Completed: idempotent objective submission with a stable client token and database transaction guard.
- Completed: objective and oral response drafts preserved locally until server confirmation.
- Completed: sanitized production error events using stable problem codes without raw messages or user answers.
- Completed: Dashboard authority failures no longer render as genuine locked or empty module states.
- Pending operational work: rotate exposed historical credentials, deploy migrations and Edge Functions, configure alerting, and run post-deployment smoke checks.
- Pending product hardening: explicit stale-client version detection, an operational incident banner, admin optimistic-concurrency controls, and backup/restore exercises.

## 13. Mandatory External Action

Removing a secret from the current file does not remove it from Git history or revoke it. The Supabase service-role credential and Paystack secret previously present in the tracked template must be rotated/revoked before production use. The replacement values must be stored only in the deployment secret manager and local ignored environment files.
