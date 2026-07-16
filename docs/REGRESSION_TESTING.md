# PromotionSure Comprehensive SDET and Release Test Plan

## 1. Document Purpose

This document defines the complete technical testing strategy for PromotionSure.

It covers:

- static analysis and production builds
- unit and property-based testing
- database integration and row-level security testing
- Edge Function and payment testing
- browser end-to-end testing
- responsive and cross-browser testing
- accessibility and visual regression testing
- concurrency, reliability, and recovery testing
- API, database, and browser performance testing
- release evidence, defect handling, and final approval gates

This is a test plan, not a test-completion report. A scenario described here is not considered verified until it has a recorded automated or manual result from the relevant release candidate.

The plan was expanded on July 16, 2026, after the introduction of admin content management, objective and oral practice modules, module-specific access, bulk question imports, question corrections, and lifecycle-aware candidate access.

---

## 2. Quality Objective

The objective is not simply to make the existing tests pass. The objective is to establish reasonable evidence that PromotionSure:

- protects candidate, admin, answer-key, and payment data
- does not publish incomplete or incorrect question content
- preserves valid access and blocks invalid access
- behaves correctly for objective and oral practice sessions
- handles retries, refreshes, timeouts, duplicate requests, and concurrent actions safely
- remains understandable and usable on supported desktop and mobile browsers
- performs within agreed limits under expected and burst traffic
- can be released, observed, and recovered without silent data corruption

The campaign must prioritize correctness and data safety over raw test count.

---

## 3. Current Automated Baseline

At the time this plan was written, the repository contains the following baseline:

| Layer | Current baseline | Existing command |
| --- | ---: | --- |
| Unit tests | 29 tests | `npm run test:unit` |
| PostgreSQL and pgTAP | 146 assertions across 5 files | `npm run test:db` |
| Browser E2E | 45 Playwright tests including setup projects | `npm run test:e2e` |
| Static analysis | ESLint | `npm run lint` |
| Production compilation | Vite production build | `npm run build` |
| Load testing | Local Supabase smoke and full profiles | `npm run test:load` and `npm run test:load:full` |
| Combined SDET command | Existing combined command | `npm run test:sdet` |

Current strengths include:

- local Supabase isolation for browser and load tests
- deterministic admin, free-candidate, and paid-candidate accounts
- objective and oral practice fixtures
- admin desktop and mobile flows
- candidate desktop and mobile flows
- pgTAP coverage for access, progression, RLS, admin content, optional guidance, and oral practice
- Playwright traces, screenshots, and videos on failures
- serious and critical Axe accessibility checks on selected pages

Current limitations include:

- no repository CI workflow currently enforces the test suite on every change
- no dedicated automated test suite for Paystack Edge Functions
- no complete Firefox or WebKit journey coverage
- limited fault-injection and offline testing
- no formal visual-regression baseline
- no enforced code-coverage threshold
- local load tests are read-heavy and use very few authenticated identities
- no sustained soak test or production-sized database performance fixture
- no formal backup and restore exercise

These limitations define planned work. They must not be represented as completed coverage.

---

## 4. Safety Boundaries

### 4.1 Local environment

Use local Supabase for:

- destructive functional tests
- RLS and authorization tests
- malformed import tests
- migration resets
- concurrent publishing tests
- duplicate payment activation tests using mocks
- routine E2E regression
- initial load-test development

The existing E2E and load runners reject non-local Supabase URLs. That protection must remain in place.

### 4.2 Dedicated staging environment

Use a dedicated staging project for:

- realistic network latency
- representative database volumes
- realistic connection and resource limits
- browser performance measurements
- controlled load, spike, and soak testing
- mocked or Paystack-test-mode payment integration
- backup and restore exercises

Staging must use generated or anonymized data. It must not contain production candidate secrets, production payment references, or live answer-key files unless access has been explicitly controlled.

### 4.3 Production environment

Production testing is restricted to:

- read-only smoke checks
- one controlled test-account journey when approved
- monitoring and alert verification
- post-deployment health checks

Never run destructive tests, bulk fixture setup, load tests, webhook replay tests, or broad security scans against production.

Never call live Paystack endpoints from a load test.

---

## 5. Risk Classification

Testing priority is based on impact and likelihood.

| Risk level | Meaning | Examples |
| --- | --- | --- |
| Critical | Financial loss, data exposure, broad unauthorized access, or unrecoverable corruption | Forged payment grants access; candidates read answer keys; published questions are replaced incorrectly |
| High | A core admin or candidate journey is unusable or misleading | Coming-soon module shown as unlocked; valid import partially saves; oral answers move backward |
| Medium | Important functionality is degraded but a safe workaround exists | Activity filters fail; one browser layout is difficult to use |
| Low | Cosmetic, copy, or low-impact inconsistency | Minor spacing or non-blocking text mismatch |

Critical and high-risk domains receive unit, database integration, and E2E coverage where technically possible.

---

## 6. Test Personas and State Matrix

### 6.1 Required identities

The deterministic test dataset must include:

| Persona | Required state |
| --- | --- |
| Anonymous visitor | No session |
| New candidate | Valid account, no attempts, no selected free module, no entitlement |
| Free candidate | One selected free module, free attempts available |
| Free candidate after failure | First free attempt failed and retry available |
| Free candidate after retry | Free retry consumed and payment required |
| Paid candidate | Active module-specific entitlement |
| Legacy paid candidate | Active legacy full-access entitlement |
| Expired candidate | Expired module and legacy entitlements |
| Content administrator | Valid admin profile and no candidate access |
| Unauthorized candidate | Candidate deliberately attempting admin APIs and routes |
| Payment test user | Candidate with deterministic pending, failed, and paid orders |

### 6.2 Required module states

Test both `objective` and `oral` modules where the combination is valid.

| Lifecycle | Content state | Sales state | Access state |
| --- | --- | --- | --- |
| Draft | Empty or incomplete | Off | None and pre-existing entitlement |
| Coming soon | Empty | Off | None, module entitlement, and legacy entitlement |
| Active | Published | Off | Free, locked, paid, and expired |
| Active | Published | On | Free, locked, paid, and expired |
| Retired | Historical content | Off | None and historical entitlement |

The state matrix must verify both what the database allows and what the UI communicates.

### 6.3 Content fixtures

Fixtures must include:

- valid objective CSV, JSON, and Excel files
- valid oral CSV, JSON, and Excel files
- optional objective explanation and reference values
- oral model answers with one through six key points
- quoted commas, line breaks, Unicode, long text, and punctuation
- invalid answer keys and duplicate options
- duplicate, missing, zero, negative, and out-of-order positions
- malformed JSON, CSV, ZIP, XML, and Excel structures
- 0-byte files and boundary files at 5 MB
- 1, 199, 200, and 201-question imports
- correction revisions and archived historical questions

Every fixture must have a clear source marker so cleanup can remove only automated test data.

---

## 7. Traceability Requirements

Every critical feature must map to at least one test ID and one implementation boundary.

Use these prefixes:

| Prefix | Domain |
| --- | --- |
| `AUTH` | Authentication, profiles, roles, and session handling |
| `ADMIN` | Modules, practice sets, questions, lifecycle, and audit logs |
| `IMPORT` | CSV, JSON, Excel, validation, and transactional import |
| `ACCESS` | Free, paid, legacy, expired, lifecycle, and purchase visibility |
| `OBJ` | Objective practice, submission, scoring, and review |
| `ORAL` | Oral timing, autosave, progression, completion, and self-review |
| `PAY` | Payment initialization, verification, webhook, and entitlement activation |
| `SEC` | RLS, authorization, input abuse, and sensitive-data protection |
| `A11Y` | Keyboard, focus, semantics, contrast, and assistive technology |
| `PERF` | API, database, browser, load, spike, and soak testing |
| `REL` | Recovery, retries, duplicate requests, migrations, and restoration |

The release report must show the status of each critical test ID.

---

## 8. Static Analysis and Build Testing

### 8.1 Required checks

Run:

```powershell
npm ci
npm run lint
npm run build
git diff --check
```

### 8.2 Planned additions

Add checks for:

- dependency vulnerabilities with severity classification
- accidental secrets and service-role keys
- dead or unreachable exports where practical
- production source maps and environment-variable exposure
- bundle-size regression
- Supabase generated type drift if generated types are introduced
- migration naming and ordering

### 8.3 Pass criteria

- no lint errors
- no build errors
- no unresolved high or critical dependency vulnerability
- no secret detected in tracked files or build output
- no unexplained material bundle-size increase

---

## 9. Unit and Property-Based Testing

### 9.1 Business logic

Expand deterministic unit tests for:

- module display-name normalization
- lifecycle precedence over stored entitlements
- free, module-specific, legacy, and expired access states
- progression recommendations after pass, fail, retry, and completion
- objective scoring and next-action decisions
- oral route selection and timer formatting
- safe return URLs and redirect rejection
- retry and timeout policy behavior
- user-facing error redaction

### 9.2 Import parser testing

Test parser behavior for:

- quoted commas and embedded line breaks
- escaped quotes
- UTF-8 and common Unicode punctuation
- blank and duplicate headers
- reordered columns
- additional unknown columns
- numeric and string positions
- blank positions and automatic assignment
- explicit zero and negative positions
- duplicate question positions
- duplicate question text
- duplicate answer options
- invalid objective correct-answer letters
- missing oral model answers
- empty and duplicate oral key points
- optional objective explanation and reference
- unsupported extensions and mismatched MIME types
- malformed JSON arrays and objects
- malformed Excel relationships and worksheets
- large compressed files intended to expand excessively

Property-based or generated tests should create many valid and invalid question rows and assert invariants:

- one normalized row represents one question
- every valid objective answer maps to an existing option
- every accepted position is positive and unique
- rejected files produce no partial normalized import
- serialization and parsing preserve meaningful content

### 9.3 Payment validation units

Refactor payment validation and signature helpers so they can be tested without starting a real Edge Function.

Cover:

- exact amount match
- exact currency match after safe normalization
- order, user, subject, pack, and metadata ownership
- missing or malformed metadata
- invalid and missing webhook signatures
- known HMAC test vectors
- duplicate references
- legacy and module-specific payment differences
- entitlement expiry calculation

### 9.4 Coverage targets

- establish and store the initial coverage baseline before imposing a gate
- require at least 85% branch coverage for extracted business-critical modules
- require 100% branch coverage for payment validation and webhook signature helpers
- do not chase superficial total-line coverage by testing render-only code with no meaningful assertions
- prohibit unexplained coverage reductions in changed critical modules

---

## 10. Database Integration, RLS, and Transaction Testing

### 10.1 Clean migration verification

Run the complete migration chain against an empty database:

```powershell
supabase db reset
npm run test:db
```

Also test a representative pre-upgrade snapshot when a migration changes existing tables, constraints, access state, questions, attempts, or payments.

### 10.2 Role matrix

For each sensitive table and RPC, prove expected behavior for:

- anonymous role
- authenticated candidate
- paid candidate
- administrator
- service role where relevant

Sensitive data includes:

- objective answer keys
- oral model answers before completion
- draft and review content
- payment orders and provider payloads
- admin audit logs
- other candidates' attempts, answers, profiles, and entitlements

### 10.3 Admin lifecycle tests

Verify:

- new modules may begin only as draft or coming soon
- coming-soon modules are visible but not purchasable or usable
- only complete reviewed sets may be published
- publishing content does not silently enable sales
- active modules with published sets cannot be moved into an incoherent state
- archiving the last published set updates module availability safely
- retirement respects active-access rules
- empty drafts can be deleted
- used or historical content cannot be deleted as if unused
- every privileged mutation writes an accurate audit entry

### 10.4 Objective content tests

Verify:

- imports are all-or-nothing
- expected question counts are enforced
- position uniqueness is enforced transactionally
- draft, review, published, and archived transitions are valid
- published questions require correction revisions rather than unsafe direct edits
- publishing a correction archives the superseded revision
- optional explanation and reference remain optional throughout save, import, publish, and review
- scoring never depends on candidate-provided correctness values

### 10.5 Oral content and attempt tests

Verify:

- oral sets inherit the module practice type
- model answers and key points remain hidden before completion
- only one active attempt exists for the same user and set where required
- answer drafts may be saved only for the current question
- completed or previous questions cannot be changed
- manual advance and timeout advance are serialized
- candidates cannot move backward
- final completion exposes only the correct review data
- self-rating changes only the owning completed response

### 10.6 Payment transaction tests

Verify:

- activation is idempotent by provider reference
- simultaneous activation calls create one valid entitlement
- amount, currency, user, pack, module, and order mismatches are rejected
- a failed or pending order never grants access
- an expired entitlement does not grant usable access
- legacy full access and module-specific access remain distinguishable
- a coming-soon or retired module is not made usable by an entitlement alone

---

## 11. Edge Function and Paystack Integration Testing

Create a local mock Paystack HTTP service or injectable fetch adapter. Do not rely on live Paystack for deterministic tests.

### 11.1 Payment initialization

Test:

- OPTIONS and unsupported HTTP methods
- missing, invalid, and expired authentication
- missing or unknown module slug
- draft, coming-soon, active, and retired modules
- active module with no published content
- objective and oral active modules
- disabled and enabled offerings
- candidate with existing valid access
- provider success, rejection, timeout, and malformed response
- payment-order persistence before provider request
- failed-order status after provider rejection
- callback URL and metadata correctness

An immediate investigation is required for oral sales: the current shared payment helper checks published rows in the objective `questions` table. A targeted test must determine whether an oral-only active module can be purchased. If oral modules are intended to be sold, the readiness check must include published oral practice sets and oral questions.

### 11.2 Verification endpoint

Test:

- missing reference
- unknown reference
- provider reports pending, failed, abandoned, and success
- reference belongs to another account
- order user differs from authenticated user
- amount, currency, module, and metadata mismatches
- module-specific and legacy success paths
- repeated verification
- simultaneous verification and webhook delivery

### 11.3 Webhook endpoint

Test:

- missing signature
- malformed signature
- correct signature for a known body
- signature for a modified body
- malformed JSON with a valid signature
- ignored event types
- successful module payment
- successful legacy payment
- replayed successful event
- conflicting payload for an existing reference
- concurrent duplicate events

### 11.4 Payment pass criteria

- no invalid request grants access
- no successful reference grants access to the wrong user or module
- duplicate delivery is harmless
- provider failure leaves a coherent order state
- payment errors do not expose service-role credentials or provider secrets

---

## 12. Browser End-to-End Testing

### 12.1 Public and authentication flows

Cover:

- landing-page entry points
- sign-up, sign-in, sign-out, and callback behavior
- invalid or expired sessions
- protected deep-link preservation
- candidate and admin role redirects
- profile setup and partially populated profiles
- unknown-route recovery

### 12.2 Admin objective workflow

Cover the complete journey:

1. Create an objective module.
2. Verify its initial lifecycle and sales state.
3. Create a practice set.
4. Upload valid CSV, JSON, and Excel files in separate tests.
5. Confirm the preview and imported row count.
6. Reject an invalid file without partial persistence.
7. Add, edit, preview, and delete a manual draft question.
8. Move the set to review.
9. Block publication when readiness fails.
10. Publish a complete set without silently enabling sales.
11. Enable sales intentionally.
12. Create and publish a correction revision.
13. Confirm candidate review uses the corrected answer.
14. Archive safely and confirm candidate availability changes.

### 12.3 Admin oral workflow

Cover:

- oral module creation and defaults
- oral file templates and all supported file formats
- model-answer and key-point validation
- manual oral question entry and editing
- oral readiness checks
- publish and correction flows
- candidate visibility only after publication
- oral lifecycle, sales, and archive behavior

### 12.4 Candidate objective workflow

Cover:

- first free-module selection
- free first attempt
- failed free retry
- free retry exhaustion
- paid module access
- progression across multiple practice sets
- answer selection, unanswered questions, review marks, and option ordering
- submit confirmation and double-submit prevention
- durable result reload
- answer review ownership
- explanation-present and explanation-absent states
- completed module and practice-again behavior

### 12.5 Candidate oral workflow

Cover:

- allowed time selection
- server-clock synchronization
- answer autosave
- refresh and resume
- manual advance
- timeout advance
- empty answer continuation
- no backward navigation
- no model-answer leak before completion
- completion and model-answer comparison
- key-point display
- self-rating persistence
- two-tab and double-click races
- final-question deadline behavior

### 12.6 Access and lifecycle workflow

Cover all combinations of:

- no entitlement
- active module-specific entitlement
- active legacy entitlement
- expired entitlement
- coming-soon lifecycle with an entitlement
- active lifecycle with no published content
- retired lifecycle with historical access
- purchasable and non-purchasable offerings

Assertions must cover labels, styling, counts, links, disabled actions, direct URLs, and server rejection. UI hiding alone is not sufficient authorization evidence.

### 12.7 Recovery and adverse conditions

Use Playwright routing and browser controls to test:

- delayed RPCs
- one transient RPC failure followed by success
- permanent RPC failure
- offline transition during objective practice
- offline transition during oral autosave
- refresh during active practice
- back and forward browser navigation
- session expiry during an admin edit
- duplicate button clicks
- reopening a durable admin URL
- reopening a result or review URL

---

## 13. Responsive, Cross-Browser, Accessibility, and Visual Testing

### 13.1 Browser matrix

Critical journeys must run on:

- Chromium desktop
- Firefox desktop
- WebKit desktop
- Chromium Android-sized viewport
- WebKit iPhone-sized viewport

The full long-running suite may remain Chromium-first, but critical smoke and payment flows must be cross-browser.

### 13.2 Viewport matrix

At minimum test:

- 320 x 568
- 375 x 667
- 393 x 851
- 768 x 1024
- 1366 x 768
- 1440 x 900
- 1920 x 1080

Every supported viewport must have:

- no horizontal page overflow
- readable content without clipped actions
- usable modals and scroll regions
- appropriately sized touch targets
- visible focus indicators
- stable admin tables or intentional mobile cards

### 13.3 Accessibility

Run automated Axe checks on:

- landing and authentication
- dashboard and module detail
- access and payment verification
- objective practice, result, and review
- oral start, active question, and review
- admin catalogue, module detail, practice set, imports, modals, guide, and activity

Perform manual keyboard checks for:

- tab order
- modal focus trapping and restoration
- Escape behavior
- form error association
- dropdown and disclosure controls
- timed oral controls
- visible focus

Release criteria require zero unresolved serious or critical automated violations. Keyboard blockers are high severity even when automated tools do not detect them.

### 13.4 Visual regression

Create stable region screenshots for:

- admin catalogue desktop and mobile
- module and practice-set detail
- objective and oral import modals
- activity list desktop and mobile
- candidate dashboard module states
- access locked, unlocked, and coming-soon cards
- objective and oral practice screens

Avoid full-page snapshots containing unstable timestamps or generated IDs. Mask dynamic values and compare intentional regions.

---

## 14. Concurrency and Reliability Testing

### 14.1 Required race scenarios

Test:

- two admins editing the same draft question
- two admins publishing the same set
- correction publication while another correction is saved
- archive while a candidate starts practice
- two objective submissions for one attempt
- two oral advances for one current question
- autosave racing with timeout advance
- verification racing with webhook activation
- repeated webhook delivery
- two module-creation requests using the same slug

### 14.2 Required invariants

After every race test:

- only valid final states exist
- no duplicate entitlement exists for the same logical purchase
- one published revision is current
- historical revisions remain auditable
- attempt answers are not duplicated or attached to the wrong attempt
- oral question order never moves backward
- audit logs identify each accepted privileged action

### 14.3 Migration and restoration reliability

Test:

- clean database rebuild
- migration from representative prior schema/data
- repeated local reset
- backup creation
- restoration into a separate staging database
- restored authentication-linked records where supported
- post-restore integrity and smoke tests

---

## 15. Performance and Load Testing

### 15.1 Performance principles

Functional correctness must be green before load testing begins.

Local load results are useful for regression comparison but do not prove hosted production capacity. Final capacity conclusions require a staging environment with representative limits and data volume.

### 15.2 Representative data volume

The staging performance dataset should include an agreed forecast and at least one larger stress profile. A starting profile is:

- 50 modules across objective and oral types
- 10 to 20 practice sets per mature module
- 30,000 or more questions
- 10,000 candidate profiles
- 100,000 attempts
- corresponding attempt answers and oral responses
- 10,000 payment orders and entitlements
- 100,000 audit-log rows

Revise these values when product forecasts are available.

### 15.3 Workload profiles

#### Candidate read mix

Use a pool of authenticated identities rather than one shared client.

Suggested operation mix:

- 30% dashboard summary and recent attempts
- 25% module and practice-set access
- 15% module catalogue and payment history
- 15% review queues and attempt review
- 10% objective practice start
- 5% oral attempt state reads

#### Candidate write mix

Test separately:

- objective attempt submission
- oral autosave
- oral manual and timeout advance
- self-rating
- free-module selection and progression writes

Use unique attempts for throughput tests. Use a deliberately shared attempt only for hot-row contention tests.

#### Admin mix

Test:

- module catalogue reads
- practice-set and question reads
- activity-log filters
- validation reads
- controlled imports
- controlled publishing and corrections

Do not mix destructive admin writes into a long candidate read test unless fixture cleanup and expected contention are explicitly designed.

### 15.4 Load stages

Run these stages after warmup:

| Stage | Shape | Purpose |
| --- | --- | --- |
| Smoke | 5 to 10 users for 2 minutes | Validate script and metrics |
| Baseline | 25 users for 5 minutes | Establish ordinary latency |
| Expected | Forecast concurrency for 15 minutes | Validate normal operating target |
| Stress | Ramp through 100 and 250 users | Identify degradation point |
| Spike | Rapid rise to 300 users for 1 to 3 minutes | Validate burst handling and recovery |
| Soak | Expected load for 45 to 60 minutes | Detect leaks, queue growth, and connection exhaustion |
| Contention | Focused concurrent writes | Validate serialization and lock behavior |

Concurrency must be recalibrated when expected production traffic is known.

### 15.5 Metrics

Record:

- request count and throughput
- success and error rate
- p50, p95, p99, and maximum latency
- database CPU and memory
- active and waiting connections
- lock waits and deadlocks
- slow SQL statements and query plans
- Edge Function duration and errors
- browser navigation timing
- LCP, CLS, and long tasks
- server and client error categories

### 15.6 Initial thresholds

These are provisional staging gates and must be adjusted from measured baselines:

| Metric | Initial gate |
| --- | --- |
| Candidate read error rate | Less than or equal to 1% |
| Candidate read p95 | Less than or equal to 2 seconds under expected load |
| Critical write p95 | Less than or equal to 3 seconds under expected load |
| p99 | Less than or equal to 8 seconds, with no systematic timeout pattern |
| Duplicate or corrupted records | Zero |
| Database deadlocks | Zero |
| Browser LCP on primary routes | Target less than or equal to 2.5 seconds in the agreed staging profile |
| CLS | Target less than or equal to 0.1 |

A stage fails if latency is within budget but correctness, authorization, or data integrity fails.

---

## 16. Execution Phases

### Phase 0 - Freeze and baseline

Deliverables:

- release-candidate commit identifier
- environment inventory
- clean local database reset
- current unit coverage report
- existing test results
- bundle-size baseline
- known-defect register
- route, API, RPC, and role traceability matrix

### Phase 1 - Harness improvements

Deliverables:

- deterministic expanded personas and fixtures
- payment mock and Edge Function test seam
- property-based import fixture generator
- cross-browser Playwright projects
- visual snapshot conventions
- CI workflow and artifact retention

### Phase 2 - Unit, database, and security expansion

Deliverables:

- new unit and generated parser tests
- payment validation tests
- complete RLS role matrix
- concurrency and transaction pgTAP tests
- migration-from-snapshot evidence

### Phase 3 - Functional E2E expansion

Deliverables:

- complete admin objective and oral journeys
- free, paid, legacy, expired, and lifecycle candidate journeys
- payment UI and mocked provider journeys
- adverse-network and session-recovery journeys
- accessibility and visual baselines

### Phase 4 - Performance and resilience

Deliverables:

- scaled staging dataset
- query-plan review
- expected-load, stress, spike, soak, and contention reports
- backup and restore report
- observed bottlenecks and capacity assumptions

### Phase 5 - Defect repair and final regression

Deliverables:

- severity-ranked defect ledger
- root-cause notes for critical and high defects
- regression test for every fixed critical or high defect
- three consecutive critical-suite passes without retries
- final release-readiness report

---

## 17. CI and Test Cadence

### 17.1 Pull-request gate

Run:

- dependency installation with lockfile
- lint
- production build
- unit tests and coverage comparison
- pgTAP database tests
- critical Chromium E2E smoke

Target duration should remain short enough to run on every change.

### 17.2 Nightly gate

Run:

- complete E2E suite
- Firefox and WebKit critical journeys
- accessibility suite
- visual-regression suite
- migration reset
- moderate local load regression
- flaky-test detection

### 17.3 Release-candidate gate

Run:

- clean install and build
- all unit and database tests
- all role and payment tests
- all critical cross-browser E2E journeys
- mobile and desktop accessibility
- staging expected-load, stress, spike, and soak profiles
- backup and restore drill
- post-deployment smoke plan review

CI retries may collect diagnostic evidence, but release confidence must be based on first-run and retry-free pass rates. A test that passes only after retry is flaky or exposing a race and must be investigated.

---

## 18. Defect Management

Every defect must record:

- unique identifier
- severity and affected domain
- environment and build identifier
- preconditions and test persona
- exact reproduction steps
- expected and actual behavior
- screenshots, trace, logs, or database evidence
- data-integrity and security impact
- suspected boundary or root cause
- fix identifier
- regression-test identifier
- verification result

### 18.1 Release policy

- Critical defects block release.
- High defects block release unless product and engineering explicitly document an exceptional safe workaround.
- Medium defects require a recorded owner and decision.
- Low defects may be deferred when they do not impair clarity, accessibility, or correctness.

Never downgrade a security, payment, answer-key, or data-corruption issue merely because it is difficult to reproduce.

---

## 19. Required Evidence

Store or link the following for each release candidate:

- lint output
- production-build output and bundle sizes
- unit coverage report
- pgTAP report
- Playwright HTML report
- failure traces, screenshots, and video where applicable
- accessibility report
- visual-diff report
- load-test JSON and summary
- database performance and query-plan notes
- migration and restore evidence
- defect ledger
- final pass/fail recommendation

Generated reports must not contain access tokens, service-role keys, candidate passwords, full payment provider payloads, or sensitive answer-key data.

---

## 20. Final Release Gates

A release candidate is not ready until all applicable conditions are true:

- `npm ci`, lint, and production build pass.
- All existing and newly required unit tests pass.
- All database, RLS, migration, and transaction tests pass from a clean reset.
- Payment initialization, verification, webhook signature, ownership, amount, currency, replay, and idempotency tests pass.
- All critical admin, objective, oral, access, and payment journeys pass.
- Critical journeys pass three consecutive times without retries.
- No critical or high defect remains unresolved.
- No serious or critical accessibility violation remains unresolved.
- No supported viewport has blocking overflow, clipped controls, or unusable modals.
- No candidate can read answer keys, model answers before completion, draft content, payment data, audit logs, or another candidate's data.
- No invalid import, failed publication, duplicate request, or race leaves partial or duplicated records.
- Coming-soon, draft, retired, locked, expired, free, and paid states are represented accurately and enforced by the server.
- Staging performance thresholds pass under expected load.
- Stress and spike tests recover without persistent failures.
- The soak test shows no material connection, memory, queue, or latency degradation.
- Backup and restore evidence is complete.
- Monitoring, rollback ownership, and post-deployment smoke checks are prepared.

Release approval must state either:

- `READY`: all mandatory gates passed
- `READY WITH ACCEPTED RISK`: no critical or high issues, and every accepted risk is documented
- `NOT READY`: one or more mandatory gates failed

---

## 21. Standard Commands

Start local Supabase:

```powershell
supabase start
```

Rebuild the local database and apply every migration:

```powershell
supabase db reset
```

Run individual layers:

```powershell
npm run lint
npm run build
npm run test:unit
npm run test:unit:coverage
npm run test:db
npm run test:e2e
npm run test:load
```

Run the existing combined suites:

```powershell
npm run test:regression
npm run test:sdet
```

Run the complete local load profile only after functional tests are green:

```powershell
npm run test:load:full
```

Use headed Playwright only for diagnosis and intentional visual review:

```powershell
npm run test:e2e:headed
```

---

## 22. First Planned Execution

The first execution of this plan should proceed in this order:

1. Record the release-candidate commit and dirty-worktree status.
2. Back up any local data that must be retained.
3. Run a clean local database reset.
4. Establish lint, build, unit coverage, pgTAP, E2E, and load baselines.
5. Produce the route, API, RPC, role, and state traceability matrix.
6. Implement the missing payment, RLS, concurrency, import, browser, and recovery tests.
7. Run the expanded functional suite and repair critical or high defects.
8. Repeat the functional suite until it is stable without retries.
9. Prepare the scaled staging dataset.
10. Run performance, stress, spike, soak, and restore exercises.
11. Produce the final release-readiness report.

Performance testing must remain after functional and data-integrity validation. High throughput is not useful if the system is returning the wrong access state, publishing incorrect questions, or granting duplicate entitlements.
