# PromotionSure Payment and Practice Email Plan

Status: implemented locally; pending review, commit, and controlled rollout

This document defines how PromotionSure should send reliable payment email and useful practice-progress email without becoming noisy. It extends the existing E1 durable queue, E2 consent controls, and E3 lifecycle engine. It does not authorize deployment or enablement.

## 1. Product Decisions

1. Every newly fulfilled payment should produce one durable payment confirmation event for that order.
2. Payment confirmation is transactional. Engagement opt-out does not block it.
3. Technical suppression, an invalid current address, or permanent provider failure may prevent delivery. The event must remain visible to Admin and the receipt must remain available in the application.
4. Completing every practice set does not produce an email.
5. Practice email is engagement email and requires the candidate's existing engagement preference to permit it.
6. Practice email is sent only for meaningful progress and combines nearby achievements into one message.
7. Existing technical suppression, the E2 daily engagement cap, the E3 lifecycle interval, signed unsubscribe, and send-time validation remain authoritative.
8. No historical practice or payment email is backfilled automatically.
9. All eligibility, frequency, milestone, and pricing facts remain server-authoritative.

## 2. Current System Truth

### 2.1 Payment email

The current payment producers are:

- `verify-paystack-payment`
- `paystack-webhook`
- `admin-reconcile-support-payment`

Each can call `enqueuePaymentSuccessEmail`. The event identity is currently:

```text
payment_success:<provider_reference>
```

The unique E1 event key prevents duplicate logical payment confirmations when verification, webhook delivery, or reconciliation repeats. The event uses priority `10` and the E1 lease, retry, attempt, provider-idempotency, webhook, and delivery-state system.

The current producer handoff occurs after payment/access business state is committed. If the queue insert fails and no verification or webhook replay occurs, the fulfilled order can remain without a payment email event. E1 is durable after event creation, but creation itself should gain a bounded repair path.

### 2.2 Engagement and lifecycle email

E2 currently provides:

- engagement opt-out and re-enable;
- technical suppression independent from engagement preference;
- signed unsubscribe;
- a server-owned `engagement_daily_cap`;
- a 168-hour minimum interval for ordinary manual engagement campaigns;
- send-time campaign validation.

E3 currently provides:

- `getting_started`;
- `never_practised`;
- `practised_unpaid`;
- `incomplete_checkout`;
- `access_expiring`;
- deterministic lifecycle instances;
- activation cutoffs that prevent historical backfill;
- a server-owned `lifecycle_min_interval_hours`, currently 24 hours;
- eligibility validation before queueing and immediately before provider dispatch.

`practised_unpaid` is a purchase follow-up after practice. It is not an achievement or progress email.

### 2.3 Authoritative practice facts

Objective practice currently provides authoritative completed attempts with:

- user;
- module/subject;
- practice set;
- completion time;
- score percentage;
- pass mark snapshot;
- passed result.

Oral practice currently provides authoritative completed attempts, module/subject, practice set, and completion time. It does not provide an equivalent objective score percentage, so email must not invent an oral score, pass, or improvement claim.

Published practice-set counts and module availability must be read from the current authoritative content catalogue. No milestone may hard-code the number of modules, practice sets, or questions.

## 3. Email Classification

| Message | Category | Engagement consent | Technical suppression | Default priority |
| --- | --- | --- | --- | --- |
| Payment fulfilled | Transactional | Does not apply | Applies | 10 |
| Payment/access issue | Transactional | Does not apply | Applies | 10 |
| Refund/dispute update | Transactional | Does not apply | Applies | 10 |
| Practice progress | Engagement | Required | Applies | 50 or lower precedence |
| Existing E3 lifecycle | Engagement | Required | Applies | Existing behavior |
| Manual campaign | Engagement | Required | Applies | Existing behavior |

Practice progress must never be reclassified as transactional or Support to bypass engagement protections.

## 4. Payment Confirmation Contract

### 4.1 Trigger

A payment confirmation becomes eligible only when the canonical payment order is fulfilled and its access outcome has been authoritatively recorded.

One confirmation is created for every distinct fulfilled order, including:

- a first purchase;
- another module purchase;
- Pick 3;
- Complete Bundle;
- an extension or renewal.

Repeated provider callbacks for the same order do not create another confirmation.

### 4.2 Content

The email must use the canonical payment presentation already shared with receipts. It may contain:

- plan or module label;
- amount and currency;
- purchased duration;
- included modules where applicable;
- authoritative access outcome;
- authoritative expiry wording where available;
- provider/payment reference in a support-safe form;
- a link back to Access and payment;
- support recovery guidance when access still needs attention.

It must not reconstruct price, duration, module count, or expiry from frontend constants.

### 4.3 Delivery guarantee

The delivery model is durable at-least-once processing with logical deduplication, not a promise that an external mailbox always accepts a message.

Add a bounded server-side reconciliation operation that finds recently fulfilled orders created after an explicit activation cutoff with no `payment_success` event and inserts the same deterministic event. Requirements:

- use the canonical order/reference identity;
- use `ON CONFLICT` or the existing enqueue function;
- process a bounded batch;
- never alter payment, fulfillment, entitlement, receipt, or access state;
- never recreate an accepted/suppressed/dead event;
- never backfill historical purchases without separate approval;
- expose discovered, created, duplicate, and error counts;
- run safely from the existing controlled worker or a separately reviewed schedule.

If email queueing fails, payment and access remain successful. Admin diagnostics must surface the email failure without asking the customer to pay again.

### 4.4 Suppressed recipients

Technical suppression remains authoritative for payment email. The event should resolve visibly as suppressed/cancelled. The in-app receipt and payment history remain the customer's durable source of truth.

## 5. Practice Progress Contract

### 5.1 One lifecycle, not many senders

Introduce one lifecycle automation:

```text
practice_progress
```

Do not create separate independent senders for first completion, passing, improvement, and module progress. One evaluator collects eligible achievements and renders one combined message.

### 5.2 Events that do not email

The following remain in-app only:

- starting a set;
- abandoning a set;
- completing an ordinary set without a new milestone;
- repeating the same score;
- small score changes;
- every individual oral answer;
- every daily return or login;
- progress that cannot be established from authoritative records.

### 5.3 Eligible milestones

The first release may include these milestone types:

| Milestone | Exact rule | Identity |
| --- | --- | --- |
| First practice completed | First authoritative completed objective or oral attempt for the user | user + first completed attempt |
| First objective pass in a module | First completed objective attempt with `passed = true` for that module | user + module + first pass |
| Meaningful personal best | New objective module best is at least 10 percentage points above the previous best and is at or above the attempt's pass mark | user + module + crossed 10-point score band |
| Half of current module sets completed | Candidate has completed distinct currently published sets equal to at least 50% of the authoritative current set count | user + module + 50% |
| Current module sets completed | Candidate has completed every currently published eligible set for the module | user + module + 100% + catalogue version/snapshot |
| First oral set completed | First authoritative completed oral set for the module | user + module + first oral completion |

Rules:

- If the first completed objective attempt also passes, one email may report both facts.
- A score improvement below 10 percentage points does not email.
- Personal-best score bands are 10-point boundaries such as 70, 80, 90, and 100. A user/module can own each crossed band once; the email may display the exact authoritative score.
- Threshold crossings are monotonic. Falling below a threshold later does not create another crossing.
- If one completion crosses both 50% and 100%, report only the higher 100% milestone.
- Adding new practice sets does not revoke a historical milestone or resend the same threshold automatically.
- A new 100% milestone after catalogue expansion requires a new authoritative catalogue identity and separate product approval before it can email.
- Oral messages describe completion only. They never claim a score or pass.

### 5.4 Coalescing

When multiple eligible milestones occur near each other:

1. Store deterministic milestone facts.
2. Wait for a server-owned coalescing window, default 30 minutes.
3. Build one current progress summary.
4. Queue one `practice_progress` lifecycle event.
5. Mark included milestone facts against that lifecycle instance.

The email should lead with the highest-value fact in this order:

1. current module completion;
2. first module pass;
3. meaningful personal best;
4. halfway progress;
5. first practice/oral completion.

Lower-value facts may appear as concise supporting lines in the same email.

### 5.5 Frequency

Practice progress uses all existing engagement controls plus stricter practice-specific limits:

- existing lifecycle minimum: 24 hours after any accepted engagement email;
- practice-progress minimum: 72 hours after the previous accepted practice-progress email;
- practice-progress rolling cap: at most 2 accepted messages per user in 7 days;
- existing global daily engagement cap;
- existing 168-hour manual-campaign interval remains unchanged.

These values are server-owned runtime configuration with bounded validation. They are not frontend constants.

Direction rules remain:

- manual engagement -> lifecycle: lifecycle waits at least the 24-hour lifecycle interval;
- lifecycle -> manual engagement: manual campaign waits the existing 168 hours;
- lifecycle -> practice progress: both the 24-hour lifecycle interval and 72-hour practice interval apply;
- practice progress -> another lifecycle: the existing 24-hour lifecycle interval applies;
- transactional payment email: no engagement interval applies in either direction.

### 5.6 Staleness

Do not deliver old congratulations indefinitely after repeated deferral.

Suggested server defaults:

- first completion/pass expires after 7 days;
- personal-best and halfway milestones expire after 7 days;
- module-completion milestone expires after 14 days.

Expired milestone instances resolve as skipped with a visible reason. They are not silently deleted.

### 5.7 Interaction with `practised_unpaid`

The same completed practice must not produce two near-identical emails.

During rollout, `practice_progress` and `practised_unpaid` may both discover the same practice source, but send-time arbitration must ensure only one is accepted in the immediate window. The preferred long-term rule is:

- `practice_progress` owns achievement and progress;
- `practised_unpaid` remains a later access reminder only when the practised module still lacks relevant paid access;
- it cannot send inside the practice-progress 72-hour interval;
- it is cancelled if relevant access is obtained;
- it does not repeat for another attempt in the same module.

Do not place a hard sales message inside every achievement email. A context-appropriate CTA may be selected server-side:

- active access: `Continue practising`;
- free/unpaid and more practice requires access: a restrained access action;
- completed module: `Review your progress` or another available module.

### 5.8 Send-time validation

Immediately before provider dispatch, validate again:

- automation enabled and trigger after activation cutoff;
- candidate account still valid and confirmed;
- engagement preference still permits email;
- current email not technically suppressed;
- lifecycle and practice-specific frequency limits;
- rolling practice cap;
- milestone still backed by authoritative completed practice;
- current template active and category `engagement`;
- no accepted event already owns the same milestone facts;
- no higher-priority coalesced practice event superseded it.

Disposition must be explicit:

- `defer` for a temporary frequency conflict;
- `skip` for opt-out, suppression, or staleness;
- `cancel` for invalidated/superseded source truth;
- `error` for an operational defect.

## 6. Proposed Data Changes

Use an append-only migration. Do not rewrite E1, E2, or E3 migrations.

Recommended additions:

1. Extend the lifecycle automation key constraint/catalogue with `practice_progress`.
2. Add one disabled `practice_progress` automation with no activation timestamp.
3. Add server-owned runtime settings:
   - `practice_progress_coalesce_minutes = 30`;
   - `practice_progress_min_interval_hours = 72`;
   - `practice_progress_rolling_7d_cap = 2`;
   - `practice_progress_improvement_points = 10`.
4. Add a durable milestone-fact table or equivalent structure containing:
   - user;
   - module;
   - source attempt;
   - milestone type and deterministic key;
   - observed score/pass/progress snapshot where applicable;
   - trigger time;
   - lifecycle instance association;
   - state and reason.
5. Add uniqueness on the deterministic milestone key.
6. Link one lifecycle instance to multiple milestone facts for coalescing.
7. Add bounded payment-confirmation reconciliation diagnostics.

All new exposed-schema tables require RLS. Candidate roles must not enumerate or mutate lifecycle facts, queue events, attempts, suppression, or reconciliation state. Admin read/control must use the existing authorization model and audited RPCs.

## 7. Admin Experience

Add `Practice progress` to Email -> Automations using the existing E3 UI.

Admin may manage only bounded product controls:

- enabled/disabled;
- approved engagement template;
- coalescing delay within safe bounds;
- minimum interval within safe bounds;
- rolling cap within safe bounds;
- improvement threshold within safe bounds.

Admin diagnostics should show:

- milestones discovered;
- coalesced instances;
- queued, accepted, delivered, deferred, skipped, cancelled, and failed counts;
- reason codes;
- the source module and milestone type;
- no sensitive answer content.

The Admin UI must state clearly that completing every set does not send an email.

Payment diagnostics remain in Delivery/payment support views. The payment repair operation should be automatic and bounded, not a routine manual resend button.

## 8. Candidate Experience

The existing engagement preference remains the authority for practice-progress email. Every practice-progress message includes the existing signed unsubscribe mechanism and one-click headers.

The email should be short:

- one clear achievement headline;
- current module and authoritative score only when objective scoring exists;
- at most three supporting progress facts;
- one CTA;
- no giant sales treatment;
- no claims about readiness for promotion or exam success;
- no repeated discount pressure.

The application remains the primary place for detailed results, answer review, history, and receipt records.

## 9. Templates

### 9.1 Payment confirmation

Subject pattern:

```text
Payment confirmed - your PromotionSure access is ready
```

The subject may adapt for an extension or an access issue using canonical payment outcome facts.

### 9.2 Practice progress

Possible subject patterns selected from authoritative milestone truth:

```text
You passed your [Module] practice set
New personal best in [Module]
You completed your current [Module] practice sets
Your PromotionSure practice progress
```

Avoid artificial urgency, all-caps, misleading score claims, and a separate email for each fact.

## 10. Implementation Sequence

### Phase A: Tests and migration

1. Add failing pgTAP coverage for payment repair, milestone identity, coalescing, frequency, consent, suppression, staleness, and no-backfill behavior.
2. Add the append-only schema/runtime migration with `practice_progress` disabled.
3. Implement deterministic candidate discovery and send-time validation.
4. Keep E1 queue and provider paths unchanged.

### Phase B: Rendering and worker integration

1. Add the approved practice-progress rendering context.
2. Reuse E1 event creation, attempts, leases, retries, provider idempotency, and Resend webhook processing.
3. Add bounded payment-confirmation repair before or alongside normal worker processing without blocking unrelated E1 delivery.
4. Add unit and Email Core integration coverage.

### Phase C: Admin UI

1. Add disabled automation configuration and diagnostics.
2. Preserve current Campaigns, Delivery, Templates, Support, and Profile preference behavior.
3. Add desktop/mobile and accessibility coverage.

### Phase D: Controlled production rollout

1. Verify migration boundary and take external schema/data backups.
2. Apply only the approved migration.
3. Deploy only changed Edge Functions.
4. Verify `practice_progress` exists disabled and unactivated.
5. Run evaluator smoke with zero historical instances/events.
6. Deploy frontend after backend verification.
7. Keep the automation disabled for observation.
8. Activate with a new cutoff only after explicit approval.
9. Start with admin/test-safe or a tightly bounded eligible cohort if supported.
10. Monitor before broad activation.

## 11. Required Tests

### Payment

- fulfilled order creates one payment-success event;
- verification/webhook/reconciliation replay does not duplicate;
- missing recent event is repaired;
- repair does not change order, access, entitlement, receipt, duration, amount, or module snapshot;
- technical suppression prevents provider delivery but preserves event diagnostics;
- engagement opt-out does not block payment email;
- no historical order is backfilled before activation cutoff.

### Objective practice

- ordinary completion without milestone creates no email;
- first completion creates one milestone fact;
- first completion plus first pass coalesces into one event;
- improvement below threshold creates no event;
- qualifying personal best creates one event;
- replay of the same attempt is idempotent;
- 50% and 100% use authoritative current published-set counts;
- catalogue additions do not duplicate an old threshold identity;
- long module names render safely.

### Oral practice

- first completed oral set can create a completion milestone;
- no score/pass claim is generated;
- replay is idempotent.

### Frequency and arbitration

- multiple milestones in 30 minutes produce one event;
- no more than one practice-progress email in 72 hours;
- no more than two accepted practice-progress emails in seven days;
- manual engagement -> practice progress applies 24-hour lifecycle delay;
- practice progress -> manual engagement preserves 168-hour manual interval;
- payment email is never delayed by engagement frequency;
- `practised_unpaid` does not create an immediate duplicate for the same practice source;
- access obtained before dispatch cancels the unpaid reminder;
- opted-out and suppressed candidates do not send;
- claimed work revalidates before provider request;
- expired milestone resolves visibly without sending.

### Regression

- full pgTAP suite;
- unit suite;
- Email Core integration;
- payment Edge integration;
- Admin desktop/mobile E2E;
- Profile preference and unsubscribe E2E;
- lint, build, secret scan, and `git diff --check`.

## 12. Monitoring and Stop Conditions

Monitor:

- payment orders fulfilled without a payment-success event after the repair grace period;
- duplicate event-key conflicts;
- practice milestone discovery and coalescing ratio;
- accepted practice messages per user per seven days;
- defer/skip/cancel reasons;
- bounce, complaint, and provider suppression rates;
- E1 dispatchable, processing, retrying, and dead counts;
- worker lease/reclaim behavior;
- unsubscribe rate;
- payment email delivery regressions.

Stop activation or disable only `practice_progress` if:

- historical sources create instances;
- one completed set creates multiple emails;
- opt-out or suppression is bypassed;
- frequency limits are bypassed;
- oral email invents score/pass data;
- payment events are delayed behind engagement work;
- E1 retry/dead volume rises unexpectedly;
- complaint or bounce behavior materially worsens.

Disabling `practice_progress` must not disable payment, Support, manual campaigns, or other E3 automations.

## 13. External Deliverability Basis

This plan follows current provider guidance:

- Google requires authenticated sending, low spam rates, and easy unsubscribe for subscribed/marketing messages. It recommends keeping spam below 0.1% and avoiding 0.3% or higher: https://support.google.com/mail/answer/81126
- Resend distinguishes order confirmations from engagement/marketing mail and recommends unsubscribe for nurturing messages: https://resend.com/docs/knowledge-base/what-sending-feature-to-use and https://resend.com/docs/knowledge-base/should-i-add-an-unsubscribe-link
- Resend recommends idempotency keys for retry-safe sends; PromotionSure must still keep its own permanent database uniqueness because provider idempotency keys expire: https://resend.com/docs/dashboard/emails/idempotency-keys
- Resend recommends sending non-transactional email only to consented, engaged recipients and maintaining audience hygiene: https://resend.com/docs/knowledge-base/what-counts-as-email-consent and https://resend.com/docs/knowledge-base/audience-hygiene

## 14. Implementation Record

Implemented in the isolated `docs/email-engagement-milestones` worktree:

- append-only migration `20260815102953_payment_and_practice_engagement.sql`;
- deterministic objective and oral milestone capture;
- one disabled, unactivated `practice_progress` lifecycle automation;
- 30-minute coalescing through the existing E3 evaluator;
- server-owned 72-hour interval, two-per-seven-day cap, and ten-point improvement threshold;
- final E3 send-time validation for consent, suppression, staleness, lifecycle frequency, practice frequency, and rolling cap;
- `practised_unpaid` arbitration after accepted practice-progress email;
- bounded payment-success event repair using canonical payment presentation and the existing E1 event identity;
- dispatcher integration before lifecycle evaluation and queue claiming;
- approved practice merge fields in the escaped structured email renderer;
- bounded Admin controls and desktop/mobile coverage.

The automation remains disabled with `activated_at = null` on migration. The migration records a new payment-repair cutoff at application time, so the repair operation cannot backfill older fulfilled orders.

## 15. Approval Boundary

Approval to implement did not authorize:

- production migration;
- Edge Function deployment;
- frontend deployment;
- automation activation;
- historical backfill;
- changes to existing production email preferences;
- changes to Paystack, Resend webhook, Cron, or existing E3 activation state.
