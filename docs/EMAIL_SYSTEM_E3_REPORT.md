# PromotionSure Email System E3

## Scope

E3 adds five server-authoritative lifecycle automations on top of the existing E1 queue and E2 email controls:

- `getting_started`
- `never_practised`
- `practised_unpaid`
- `incomplete_checkout`
- `access_expiring`

No new provider path or delivery queue was introduced. Every eligible lifecycle message becomes one deterministic `transactional_email_events` row and is delivered by the existing E1 dispatcher.

## Safety Defaults

- All five automations are installed disabled.
- Disabled automations have no activation timestamp and create no lifecycle instances or E1 events.
- Enabling an automation establishes `activated_at = now()`.
- Trigger sources older than that activation cutoff are excluded, so deployment and first enablement do not backfill historical users, orders, practice, or entitlements.
- Disabling an automation cancels its scheduled instances and pending/retrying E1 events. Provider requests already underway cannot be recalled.
- Timing changes are constrained by server-owned minimum and maximum bounds.
- Only active engagement templates can be assigned.

## Data Model

`email_lifecycle_automations` stores bounded configuration, activation cutoff, template selection, run statistics, and recent evaluator errors.

`email_lifecycle_instances` stores the durable relationship between one automation and one authoritative trigger source. It records trigger and due times, eligibility, reason, state, metadata, and the resulting E1 event.

`transactional_email_events.lifecycle_instance_id` links lifecycle diagnostics to the single E1 delivery truth. Unique instance and event-key constraints make evaluator reruns idempotent.

## Evaluation And Dispatch

The existing one-minute `process-email-dispatch` invocation performs one bounded lifecycle evaluation before claiming E1 work. This avoids a second Cron job and one-job-per-automation scheduling.

The evaluator:

1. takes a transaction advisory lock;
2. discovers bounded post-activation trigger sources;
3. inserts deterministic lifecycle instances;
4. revalidates due instances against current account, practice, payment, entitlement, preference, suppression, and engagement-frequency truth;
5. creates E1 engagement events only for eligible instances;
6. records skipped, cancelled, deferred, or error outcomes.

An evaluator failure is recorded on enabled automation configuration and does not block unrelated E1 transactional delivery.

After claim and immediately before provider dispatch, lifecycle events are validated again. Stale work is cancelled or safely deferred while preserving E1 lease correctness. Payment and other transactional events do not enter the E3 validation path.

## Eligibility Rules

- Getting started: confirmed candidate/profile source, due 10 minutes after the later of profile creation and confirmation.
- Never practised: confirmed candidate with no completed objective or oral practice, due 24 hours after signup and cancelled if practice begins before send.
- Practised but unpaid: first qualifying completed practice source for a module without fulfilled relevant purchase or active paid access, due after 24 hours and cancelled when relevant access is obtained.
- Incomplete checkout: pending/non-fulfilled order due after two hours when at least one intended order item remains unsatisfied. Unrelated fulfilled purchases and entitlements do not disqualify it; later matching or superset fulfillment does.
- Access expiring: paid active module entitlement due seven days before its authoritative expiry. An extended expiry or equivalent replacement cancels the stale reminder.

All lifecycle mail is category `engagement`. E2 opt-out, technical suppression, the 168-hour engagement interval, and the existing E1 daily engagement claim cap remain authoritative.

## Admin Experience

Email Center now includes an Automations section with:

- enabled/disabled state;
- purpose and current timing;
- compatible template selection;
- bounded timing input;
- scheduled, sent, skipped/cancelled, and error counts;
- activation, evaluation, run, and recent-error status;
- searchable/filterable history with user, trigger, due time, eligibility, reason, E1 event identity, and delivery state.

Desktop uses a list/detail workspace. Tablet and mobile retain the same information with a horizontally scrollable automation selector and single-column controls where needed.

Individual Support compose now opens as a service-reply workflow for the selected candidate. It keeps the recipient and technical-suppression context visible, collapses prior application-email history, derives the internal audit name from the subject, and uses `Review email` then `Send email`. Audience preview, campaign naming, and test-send controls remain available when the admin explicitly changes the message to Engagement; selected-user and segment campaigns retain the full E2 preview and exact-draft test gate.

## Verification

- Clean local migration replay through E3.
- 44 focused E3 pgTAP assertions.
- Full database suite: 644 assertions.
- Dispatcher source-order and E1 integration unit coverage.
- Full admin desktop/mobile E2E suite: 37 tests, including direct Support compose, explicit Engagement gating, and Automations coverage.
- Existing lint, unit, production build, Email Core integration, and payment Edge integration suites.

## Production Status

E3 has not been deployed. No production migration, Edge Function deployment, Cron change, secret change, or lifecycle email activation was performed during implementation.
