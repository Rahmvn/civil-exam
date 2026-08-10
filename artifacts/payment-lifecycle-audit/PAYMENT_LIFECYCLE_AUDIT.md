# PromotionSure Phase P2: Multi-Module Payment Lifecycle and Access-Outcome Audit

Date: 2026-08-09
Scope: Read-only audit. No payment, entitlement, receipt, email, Paystack, or UI behavior was changed.

## Executive conclusion

PromotionSure currently has three distinct records with different responsibilities:

1. `payment_orders` records the payment, pricing plan snapshot, duration, provider state, and one order-level access result.
2. `payment_order_items` records the immutable modules and allocated price portions bought in that order.
3. `module_entitlements` records the user's current mutable access state for a module.

That separation is directionally correct, but the transaction-to-access mutation is incomplete. A current pricing order does not persist an immutable per-item record of the entitlement row changed, its pre-payment access state, or its post-payment access state. For an extension, the entitlement retains its original `payment_order_id`; the newer order is represented only in a cumulative JSON array on the current entitlement.

Consequently:

- Current access can be answered reliably.
- Purchased scope, duration, amount, and module identity can be answered reliably for current pricing orders.
- A transaction's exact per-module access effect cannot always be answered historically.
- Full refunds and disputes are not transaction-aware for extensions or mixed bundles.
- Replaying an older fulfilled order after a later extension can corrupt the older order's persisted result date.
- A time-expired entitlement that still has `status = 'active'` can block reactivation because activation ignores it while the partial unique index still treats it as active.

The provisional recommendation is to preserve `module_entitlements` as the source of current access and add one durable per-order-item access-outcome record for each successful activation. That outcome must capture before/after state and the duration contribution. Refund/dispute code should change item effect state and recompute current access under locks rather than identifying entitlements only through `module_entitlements.payment_order_id`.

## Sources inspected

### Tables and checkout

- `payment_orders` and `module_entitlements`: `supabase/migrations/20260713150000_module_specific_access.sql:16-50`
- Multi-module order shape and `payment_order_items`: `supabase/migrations/20260801144030_bundle_offers_and_multi_module_orders.sql:39-136`
- Duration-pricing order fields: `supabase/migrations/20260808134832_pricing_plan_checkout_orders.sql:7-73`
- Pricing-plan selection and immutable purchase snapshot: `supabase/functions/initialize-paystack-payment/index.ts:81-203`
- Order and item insertion: `supabase/functions/initialize-paystack-payment/index.ts:516-584`

### Activation and lifecycle

- Current activation function: `supabase/migrations/20260808140406_duration_pricing_activation.sql:1-219`
- Refund/dispute function: `supabase/migrations/20260720070841_paystack_post_payment_lifecycle.sql:46-256`
- Edge activation wrapper: `supabase/functions/_shared/paystack.ts:430-444`
- Ordinary verification: `supabase/functions/verify-paystack-payment/index.ts:104-145`
- Signed webhook activation and lifecycle dispatch: `supabase/functions/paystack-webhook/index.ts:55-123`
- Admin support reconciliation: `supabase/functions/admin-reconcile-support-payment/index.ts:67-139`

### Presentation and tests

- Canonical receipt/payment projection: `supabase/migrations/20260809204613_payment_receipt_truth_alignment.sql:5-205`
- Duration activation coverage: `supabase/tests/duration_pricing_activation_test.sql`
- Legacy bundle activation coverage: `supabase/tests/bundle_offers_test.sql`
- Existing single-item refund/dispute integration coverage: `scripts/test/runEdgePaymentIntegration.mjs:633-829`

The current official Paystack documentation confirms the supported asynchronous refund states and that dispute reminders recur until resolution. It also defines `merchant-accepted` as accepting the dispute and `declined` as rejecting it:

- https://paystack.com/docs/payments/refunds/
- https://paystack.com/docs/payments/manage-disputes/
- https://paystack.com/docs/payments/webhooks/

## Current transaction architecture

### What was paid for

`payment_orders` is the payment aggregate. Current pricing-plan orders persist:

- Paystack reference and payment/order states
- amount and currency
- plan ID and code
- duration
- immutable `purchase_snapshot`
- order-level `access_starts_at`
- order-level `access_expires_at`

The purchase snapshot records plan name/type, duration, amount, currency, module count, and module identity at checkout (`initialize-paystack-payment/index.ts:191-202`).

`payment_order_items` is the purchased module set. Each row records the order, subject, offering, list price, and allocated order amount (`bundle_offers_and_multi_module_orders.sql:93-102`). It does not record access state or activation results.

### What access exists now

`module_entitlements` is a mutable current-state row containing user, pack, module, status, start, expiry, metadata, and one `payment_order_id` (`module_specific_access.sql:33-46`). Candidate access checks require `status = 'active'` and `expires_at > now()`.

An extension mutates this row in place. Its `payment_order_id` remains the order that originally created the row. The current order ID is appended to `metadata.pricing_plan_order_ids`, and latest-extension fields overwrite earlier latest-extension metadata (`duration_pricing_activation.sql:127-143`).

### What this transaction changed

There is no dedicated durable record for this question. Activation returns `expires_at` and `already_active` per module to the immediate caller (`duration_pricing_activation.sql:191-197`), but those values and the pre-mutation state are not persisted per item.

`payment_orders.access_expires_at` is the maximum resulting item expiry (`duration_pricing_activation.sql:186-188, 212-214`). For multi-module orders it is not a common expiry.

## Purchase-case map

The following applies to `pricing_plan` purchases. All item rows and the order snapshot already exist before Paystack activation.

| Case | Entitlement mutation | Entitlement `payment_order_id` | Extension metadata | Persisted result |
|---|---|---|---|---|
| Single, new | Insert one active row; start `now()`, expiry `now() + duration` | Current order | Array starts with current order | Exact order expiry is persisted |
| Single, extension | Update active future row in place; expiry becomes old expiry + duration | Original order | Append current order; overwrite latest-extension fields | Exact order expiry is persisted, but no before expiry |
| Pick 3, all new | Insert three rows | Current order on all three | Current order in each row | Only maximum expiry on order; no per-item result |
| Pick 3, mixed | Insert new rows; update existing rows | Current order only for new rows | Current order appended only to extended rows | Only maximum expiry; no per-item before/after |
| Pick 3, all extension | Update three rows in place | Three earlier/original orders | Current order appended to all three | No entitlement directly references current order; only maximum expiry |
| Complete, all new | Insert one row per available module | Current order on every row | Current order in each row | Only maximum expiry |
| Complete, mixed | Insert and update independently per module | Current order only for new rows | Current order appended to extended rows | Only maximum expiry |
| Complete, all extension | Update all rows in place | Earlier/original orders | Current order appended to all rows | Only maximum expiry |

For a new item, the transaction changed access from no usable current entitlement to a new entitlement beginning at activation. For an extension, it changed only the expiry of the existing row. The old expiry is available transiently in `v_existing.expires_at`, but is not persisted before the update.

## Activation audit

### Locking and selection

Activation locks the payment order and acquires advisory locks for the order and every subject in sorted order (`duration_pricing_activation.sql:32-35, 75-84`). This is a sound concurrency basis.

For each item it searches for one entitlement that is both active and unexpired (`duration_pricing_activation.sql:96-105`).

### New entitlement

If none is found, a duration purchase inserts a new row with:

- `starts_at = now()`
- `expires_at = now() + duration`
- `payment_order_id = current order`
- current order in `pricing_plan_order_ids`

Reference: `duration_pricing_activation.sql:145-164`.

The effective activation kind is "new" or "reactivation", but this distinction is not persisted.

### Existing active entitlement

If active future access exists, activation uses `greatest(now(), existing.expires_at)` as the base and adds the purchased calendar months (`duration_pricing_activation.sql:124-125`). Because the selected entitlement is unexpired, this normally extends from the existing expiry.

It preserves the entitlement ID, start, and original `payment_order_id`; updates the current expiry; appends the order ID to JSON metadata; and records only latest-extension metadata.

### Expired entitlement

An entitlement with explicit `status = 'expired'` is ignored and a new row can be inserted.

An entitlement with `status = 'active'` but `expires_at <= now()` is also ignored by selection, but the unique partial index still prohibits another active row for the same user/pack/module (`module_specific_access.sql:48-50`). There is no general expiry job that changes these rows to `expired`. A new paid activation can therefore fail with a uniqueness violation. This is a separate High-risk fulfillment defect.

### Repeated activation

Idempotency checks whether the entitlement's original order is the current order or whether metadata contains the current order (`duration_pricing_activation.sql:112-122`). Immediate replay does not add the duration again.

However, when an already-applied older order is replayed after a later order has further extended the entitlement, activation uses the entitlement's current latest expiry as that older order's item result. At function end it overwrites the older `payment_orders.access_expires_at` with that later expiry. Thus activation is duration-idempotent but not historically result-idempotent.

Example:

1. Order 1 creates access through October.
2. Order 2 extends through January and stores January on Order 2.
3. Order 3 extends through April.
4. Replaying Order 2 sees that it was applied, reads the current April entitlement, and rewrites Order 2's result to April.

This can make an older receipt and audit record change after a webhook/verification replay.

### Mixed bundle

Each item independently follows the new/extension branch. The function returns a truthful transient `already_active` flag and item expiry, but persists only the maximum on the order. No row permanently records which items were new versus extensions.

### Is metadata a complete relationship?

No.

Metadata can usually establish membership: a surviving entitlement's `pricing_plan_order_ids` can show that an order affected it. It cannot establish:

- pre-order start/status/expiry
- post-order per-item start/expiry at that time
- activation kind
- whether the current expiry came from that order or later orders
- how much of the current period should be removed on reversal
- a stable historical result if an older order is replayed

Top-level reference, plan, duration, and latest-extension fields are also overwritten by later extensions. JSON IDs have no foreign-key constraint.

## Refund lifecycle audit

The lifecycle function identifies the order by provider reference, validates amount/currency, and stores an idempotent sanitized provider event (`paystack_post_payment_lifecycle.sql:77-150`).

### Pending, processing, and needs-attention

These set `payment_orders.review_status = 'refund_pending'` and update provider messaging. Access is unchanged (`paystack_post_payment_lifecycle.sql:178-187`). This is order-wide state.

### Refund failed

The order returns to `clear` if no processed refund exists, or remains `partially_refunded` if some amount was already processed. Access is unchanged (`paystack_post_payment_lifecycle.sql:188-198`).

### Partial refund

Processed refund events are summed and capped at the order amount. Until the cumulative total reaches the full order amount, the order becomes `partially_refunded`; no entitlement changes (`paystack_post_payment_lifecycle.sql:146-176`).

This is internally consistent with the current single-module tests, but there is no item allocation policy for multi-module refunds. `allocated_amount_kobo` exists but is not used to decide which access effect, if any, a partial refund reverses.

### Full refund

When cumulative processed refunds reach the order amount, the order becomes reversed/refunded/revoked and every active or pending entitlement whose `payment_order_id` equals that order is expired (`paystack_post_payment_lifecycle.sql:155-168`).

Consequences:

- New single module: access created by that order is expired. Correct if full refund policy is full revocation.
- All-new bundle: every directly created item is expired. Order-wide behavior works.
- Extension order: no entitlement may reference the extension order directly, so the refunded extension remains in the current expiry.
- Mixed bundle: new items are expired; extended items keep the refunded extension.
- Original order later extended by another paid order: refunding the original order expires the whole current entitlement, including access contributed by the later legitimate extension.

The current system can therefore both retain refunded access and remove later paid access, depending on which order is refunded.

### Can an extension be rolled back accurately?

No. The schema does not retain the pre-extension expiry. It knows the purchased duration and usually knows that the order ID appears in metadata, but it cannot safely subtract or restore a date without considering later orders, calendar-month arithmetic, elapsed time, and other lifecycle changes.

## Dispute lifecycle audit

### Target selection

Before applying any event, the function executes an unordered `select * into target_entitlement` for rows whose `payment_order_id` equals the target order (`paystack_post_payment_lifecycle.sql:136-139`). In non-strict PL/pgSQL this assigns one matching row when several exist. There is no `ORDER BY`, so the selected module is not a defined business choice.

Extension-mutated entitlements are not considered through `pricing_plan_order_ids`.

### Dispute created or reminder

The order becomes `disputed`. If the one selected entitlement is active, only that row becomes pending (`paystack_post_payment_lifecycle.sql:199-211`).

- Pick 3 all new: one arbitrary module pauses; two remain active.
- Complete all new: one arbitrary module pauses; all others remain active.
- All-extension order: no direct entitlement is found; none pause.
- Mixed order: one arbitrary newly created item pauses; extension items and other new items remain active.

A reminder generally sees the same unordered candidate set and will not deliberately progress through all items. Its behavior is not an order-wide pause.

### Dispute resolved in merchant's favour

Paystack uses `resolution = 'declined'` when the merchant rejects the dispute. The function attempts to restore only `target_entitlement`. If it is still future-dated and no competing active row exists, it becomes active; otherwise it may become expired (`paystack_post_payment_lifecycle.sql:225-251`). Other bundle items were never paused.

If the pending entitlement has already reached its expiry, the branch performs no status update, leaving a pending historical row.

### Dispute resolved against merchant

Paystack uses `resolution = 'merchant-accepted'` when the merchant accepts the dispute. The function expires all direct entitlements for the order and marks the order revoked (`paystack_post_payment_lifecycle.sql:212-224`).

This has the same extension/mixed limitations as a full refund:

- direct new items are expired;
- extension contributions remain;
- an original order's entitlement can include later extensions and is expired in full.

Paystack permits a merchant to accept a dispute with a partial refund amount, but this function does not model an item-level or proportional dispute outcome. A `merchant-accepted` resolution always follows the same full direct-entitlement revocation path. PromotionSure therefore needs an explicit partial-dispute policy before that case can be represented as access arithmetic.

### Extension-specific example

Given:

- Order 1 entitlement expires in October.
- Order 2 extends it through January.
- Order 2 is later disputed or refunded.

The system can identify that Order 2 appears in the entitlement metadata and that Order 2 bought three months. It cannot identify the immutable October-to-January before/after result. A dispute on Order 2 finds no direct `target_entitlement`, so access is not paused. A full refund of Order 2 does not reduce January. Conversely, suspending the entire entitlement would remove the legitimate Order 1 access through October.

## Mixed-purchase rollback requirements

For Pick 3 where A is new and B/C are extensions, mathematically correct reversal needs independent handling:

- A: remove or suspend only access introduced by this order, subject to later purchases.
- B: restore/recompute from B's pre-order expiry while preserving later valid contributions.
- C: do the same independently because its before/after dates may differ from B.

Correctness requires item identity, entitlement identity, activation time/kind, before state, after state, duration contribution, lifecycle state, and deterministic ordering with later purchases. One order-level maximum date cannot support this.

## Historical versus prospective truth

### Historical facts available

For current pricing orders:

- purchased plan name/type and duration
- purchased module identities
- amount/currency/reference/date
- item price allocations
- order-level maximum resulting expiry, unless later replay has overwritten it
- current entitlement metadata membership when the relevant row survives

For direct new purchases, `module_entitlements.payment_order_id` also identifies the row originally created by the order.

### Historical facts permanently missing

For already-completed extension and mixed orders, the following cannot be reconstructed reliably:

- exact per-item pre-extension expiry
- exact per-item post-extension expiry
- activation kind at that time
- entitlement ID if rows were later replaced/deleted
- exact contribution remaining after later orders

Current entitlement expiry is not historical evidence. Back-calculating from current duration/order sequences is unsafe because later activation, replay, refunds, disputes, elapsed access, status changes, and calendar-month boundaries may have intervened.

Legacy pre-duration purchases have still fewer immutable facts and must not be synthetically upgraded into precise access-outcome history.

### Prospective facts needed

Each successfully activated order item should persist at least:

- payment order item ID
- entitlement ID affected/created
- activation kind: new, extension, or reactivation
- before status/start/expiry, including explicit absence
- after status/start/expiry
- activation timestamp
- purchased duration/contribution identity
- current effect state: effective, disputed/held, reversed, or superseded as policy requires

Before/after snapshots accurately describe what the transaction did at activation. They are necessary but not sufficient for reversing a middle transaction after later purchases. Reversal also needs ordered contribution state and deterministic recomputation under the same module locks.

## Current access versus transaction history

The model does not cleanly separate these concepts today:

- `module_entitlements` correctly answers current access, but is also used as historical linkage through `payment_order_id` and JSON metadata.
- `payment_order_items` correctly answers purchased scope, but has no access result.
- `payment_orders.access_expires_at` answers an order-level result only for a single module; for bundles it is a maximum.

Current entitlement rows should remain mutable current-state records. Transaction impact should move to a durable per-item outcome/effect record.

## Admin reconciliation

Admin reconciliation verifies the same Paystack transaction and calls the same `activate_module_purchase` RPC as ordinary verification and signed `charge.success` webhooks (`admin-reconcile-support-payment/index.ts:89-129`).

Therefore it has identical access behavior, locking, idempotency, missing item outcomes, extension linkage, old-order replay corruption, and refund/dispute limitations. It does not create a separate receipt or entitlement model.

## Receipt projection impact

The canonical projection is correct for currently persisted truth:

- snapshot-backed product and module identity
- duration, amount, currency, date, and reference
- extension/mixed classification from metadata
- exact single-item order expiry
- "latest access date" for multi-item maximum expiry
- order-level provider, fulfillment, refund, dispute, attention, and receipt state

It does not have enough data for historical per-module results or transaction-safe rollback. It should remain unchanged in this audit.

A future per-item outcome could be joined into the canonical `items` JSON without redesigning the current receipt UI. The existing concise bundle summary can remain, while support/admin/email consumers could opt into per-item before/after facts.

## Email-system implications

| Email | Safety now | Reason |
|---|---|---|
| Payment confirmation | Safe at current order-summary level | Product, duration, modules, amount, and latest/exact order date are authoritative; avoid claiming one common bundle expiry |
| Paid-but-access-problem | Safe and important | It reports fulfillment uncertainty and does not need rollback semantics |
| Refund pending/failed | Safe if limited to provider/order status | Access has not been transaction-safely changed |
| Refund processed | Unsafe for automated access-specific claims | Extension/mixed access may remain, while refund of an original order may remove later paid access |
| Dispute opened/reminder | Unsafe for claims that all purchased access paused | Only one arbitrary direct entitlement may pause; extension orders pause none |
| Dispute resolved | Unsafe for detailed access-result claims | New and extension items can have different, incorrect outcomes |
| Access-expiring | Safe only from current entitlement state, not a payment item | Current expiry is authoritative, but attribution to a particular order is not |
| Access-expired | Safe only after checking current entitlement state | It must not infer expiry from an old order's result date |

Refund/dispute emails may continue to state provider review facts conservatively, but automation that promises a specific access removal/restoration should wait for transaction-aware outcomes.

## Risk register

### Critical

1. **Refund/dispute of an original order can remove later legitimately paid extensions.** Full reversal expires the current row by original `payment_order_id`, even when newer orders extended it.
2. **Historical order result can be rewritten by replay.** Replaying an older applied order after a later extension can overwrite the older order's `access_expires_at`, changing receipt/audit truth.

### High

3. **Refunded extension access can remain available.** Extension orders do not own the mutated entitlement row, so full refund/reversal does not remove their contribution.
4. **Bundle disputes pause one arbitrary module.** Pick 3 and Complete are not treated as order-wide or item-aware.
5. **Extension disputes pause no access.** Metadata linkage is ignored by lifecycle logic.
6. **Mixed reversal produces mixed incorrect outcomes.** New items are revoked while extension contributions remain.
7. **Stale active expiry can block paid reactivation.** Selection ignores time-expired active rows, but the active-row unique index still blocks insertion.
8. **A partially accepted dispute has no proportional access semantics.** The current merchant-accepted path revokes direct order access without mapping the accepted amount to items or duration.

### Medium

9. **Partial refund has no item semantics.** Money is tracked accurately at order level, but no rule maps it to module access.
10. **Current tests validate single-item lifecycle only.** They do not expose bundle/extension reversal defects.
11. **Support cannot prove item-level transaction effect.** Metadata establishes membership but not the before/after mutation.
12. **Refund/dispute emails can overstate access behavior.** Existing copy is cautious, but richer automation would be unsafe.

### Low

13. **Bundle receipts cannot show per-item expiry.** The current "Latest access date" wording is truthful, so this is a richness limitation rather than a current false claim.

## Architecture options

### Option 1: Extend `payment_order_items` with activation outcomes

Add nullable outcome fields directly to each item, populated atomically during activation: entitlement ID, activation kind, before/after state, activated time, and effect state.

- Schema: no new main table; several item columns and constraints.
- Activation: write item outcome in the same transaction as entitlement mutation; use item outcome existence for idempotency.
- Refund/dispute: mark item effect state and recompute current entitlement from valid ordered items.
- Historical compatibility: old fields remain null/unknown; confident direct-new relationships may be marked separately, not fabricated.
- Safety: good if outcome fields become write-once and lifecycle state is carefully separated.
- Migration risk: medium; checkout rows exist before activation, so null-to-complete state constraints need care.
- Complexity/test burden: medium-high.

### Option 2: One-to-one payment-item access-outcome table (recommended)

Create one outcome/effect row after successful activation for each `payment_order_item`. This is a transaction-impact ledger, not a general event-sourcing system.

- Schema: one table keyed one-to-one to item, with entitlement FK, activation kind, before/after state, activation time, contribution duration, and effect state.
- Activation: lock module, compute before/after, mutate entitlement, insert outcome atomically. Existing outcome makes replay return the immutable stored result rather than current entitlement state.
- Refund: full refund reverses every item effect and recomputes each module while preserving later non-reversed effects. Partial refund waits for an explicit item/allocation policy.
- Dispute: hold each item effect and recompute according to the chosen policy; merchant-favour restores effects, customer-favour reverses them.
- Historical compatibility: old orders remain readable; complex old reversals route to manual review when outcome is unknown.
- Safety: strongest separation between immutable transaction history and mutable current access.
- Migration risk: medium because behavior changes are substantial, but data ownership is clear and rollout can be prospective.
- Complexity/test burden: high but bounded; matrix tests are mandatory.

### Option 3: Conservative patch plus manual complex lifecycle

Keep the schema, make bundle queries explicitly order-wide for directly owned entitlements, detect metadata-linked extensions, and refuse automatic extension/mixed reversals.

- Schema: none or minimal flags.
- Activation: add an early fulfilled-order return to stop historical result overwrite; fix stale-active expiry handling.
- Refund/dispute: direct-new items can be handled; any extension/mixed order becomes an admin attention case with no automatic access mutation.
- Historical compatibility: safest immediate treatment for unknowable old orders.
- Safety: prevents the worst automated damage but cannot provide reversible new extensions.
- Migration risk: low.
- Complexity/test burden: medium.

Option 3 is a useful containment stage, not the complete target model.

## Provisional recommendation

1. **Yes, persist per-item before/after access snapshots prospectively.** Use a one-to-one access-outcome record linked to `payment_order_items` rather than JSON metadata alone.
2. **Keep `module_entitlements` as the authoritative current-access projection.** Practice authorization should continue reading current entitlement state.
3. **Make item outcomes the source of transaction impact/history.** They should answer which entitlement was changed, how, and from/to what state.
4. **Make activation replay read the immutable item outcome.** It must never derive an old order result from a later current entitlement.
5. **Make refund/dispute operations item-aware and recomputational.** Under per-module locks, change item effect state and recompute access from valid ordered contributions. Do not blindly expire the current entitlement row.
6. **Treat historical extension/mixed orders as partially unknowable.** Do not backfill invented before/after dates. Automatically reverse only cases proven safe; route ambiguous historical cases to support/manual review.
7. **Use a staged rollout.** First contain replay corruption and unsafe automatic historical reversals; then introduce prospective outcomes; then migrate lifecycle logic after full matrix tests.

Snapshots alone do not make middle-order rollback safe after later extensions. The design must also retain ordered duration contributions and effect state so current access can be deterministically recomputed without the reversed/held transaction.

## Product decisions required

1. Does a full refund revoke all remaining access contributed by that transaction, even if some of its duration has already been consumed?
2. How should a partial monetary refund map to access: no access change, explicitly selected items, proportional duration, or full-order policy only?
3. During a dispute, should undisputed prior access remain usable while only the disputed future contribution is held?
4. If later valid extensions depend chronologically on a disputed/reversed earlier contribution, should they be replayed from the remaining baseline or retain their originally promised absolute dates?
5. Should new purchases/extensions be allowed while an earlier contribution for the same module is disputed?
6. For a disputed all-new purchase with later extensions, what access should remain if the base purchase is reversed?
7. Which historical orders may be automatically reversed based on high-confidence direct ownership, and which must require support review?
8. Should explicitly time-expired rows be retained as immutable history while a new current entitlement row is created, or should one entitlement row remain permanent per user/pack/module?

## Required implementation test matrix for a future phase

No tests were changed in this read-only audit. A corrective phase should add database and Edge coverage for:

- new, extension, and reactivation activation
- stale `active` row with elapsed expiry
- immediate replay and old-order replay after later extensions
- Pick 3 and Complete: all new, mixed, all extension
- full and partial refund for every case
- dispute open/remind/merchant-favour/customer-favour for every case
- refund/dispute of an original order after later extension
- refund/dispute of a middle extension with a later extension
- admin reconciliation parity
- canonical receipt immutability before and after later orders/replays
- conservative legacy/manual-review behavior

## Final audit position

The current checkout and receipt model accurately records what the customer bought. The current entitlement model accurately answers usable access in ordinary forward activation. The missing layer is a durable, per-item transaction impact record.

Until that layer and explicit refund/dispute policy exist, PromotionSure should not automatically claim or assume mathematically precise extension rollback. The highest-priority containment concerns are preventing old-order replay from mutating historical results, preventing original-order reversal from destroying later paid access, and preventing bundle disputes from silently affecting only one arbitrary module.
