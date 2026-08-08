# PromotionSure Pricing System Plan

Date: 2026-08-08

## Executive Summary

PromotionSure is moving from fixed exam-cycle access to duration-based module
access. The new commercial model should be implemented backend-first because
pricing affects payment integrity, entitlement expiry, receipts, support
diagnostics, admin records, and future email automation.

The target model is:

```text
successful verified payment
-> immutable payment order snapshot
-> module entitlements for the purchased modules
-> expiry based on paid duration from activation or current active expiry
```

The frontend should display choices and submit user intent, but the backend must
remain the source of truth for plan eligibility, module inclusion, final price,
duration, expiry, and Paystack amount.

## Product Rules

### Access Duration

Customers can purchase access for:

- 1 month
- 3 months
- 6 months

Access starts after successful payment verification and activation. The expiry
is calculated from the time the platform activates the purchase, except for
renewals where the same module is already active.

For renewals, the new duration should extend from the current active expiry when
that expiry is later than the activation time.

```text
base date = greatest(now(), existing active module expiry)
new expiry = base date + purchased duration
```

This prevents a customer from losing remaining paid time when renewing early.

### Existing Purchases

Existing active purchases keep their current expiry and access scope. The new
pricing system must not shorten, reprice, or reinterpret historical access.

Old payment orders and old module entitlements remain valid under the terms that
existed when they were created.

### Individual Module

An individual module purchase unlocks exactly one selected module.

Objective modules use objective pricing. Oral modules use oral pricing.

Approved prices:

| Module Type | 1 Month | 3 Months | 6 Months |
| --- | ---: | ---: | ---: |
| Objective Module | NGN 2,500 | NGN 6,500 | NGN 11,000 |
| Oral Module | NGN 3,500 | NGN 9,000 | NGN 15,500 |

### 3-Module Bundle

A 3-Module Bundle allows the customer to choose any 3 currently purchasable
modules. It should include objective and oral modules if both are separately
purchasable and available, unless a later product rule intentionally separates
oral from objective bundles.

Approved prices:

| Plan | 1 Month | 3 Months | 6 Months |
| --- | ---: | ---: | ---: |
| 3-Module Bundle | NGN 6,000 | NGN 15,500 | NGN 26,500 |

The backend must enforce exactly 3 distinct selected modules, all currently
purchasable, all in the active exam pack, and all not already active for the
candidate unless upgrade/extension rules are later introduced.

### Complete Module Bundle

The customer-facing name is Complete Module Bundle, not "All 9 Modules" or any
fixed module-count label.

The Complete Module Bundle includes all currently purchasable modules at the
time checkout is initialized. The included module list must be snapshotted into
the payment order through `payment_order_items`.

A module added after purchase is not automatically included in the old purchase.
If PromotionSure wants to include future modules for selected customers, that
must be a separate promotion or admin grant.

The 1-month base price is:

```text
current purchasable module count * NGN 1,500
```

For the current 9-module example:

| Plan | 1 Month | 3 Months | 6 Months |
| --- | ---: | ---: | ---: |
| Complete Module Bundle, 9 modules | NGN 13,500 | NGN 35,000 | NGN 59,500 |

For future module counts, the backend should calculate the 1-month base from
the current count and derive duration prices using approved rounding rules.
Final checkout amounts must still be snapshotted.

### Duration Discount Messaging

Customer-facing messaging can stay simple:

- 3 months: save about 14%
- 6 months: save about 26%

The exact percentage may vary after rounding to clean NGN 500 amounts.

### Future Catalogue Growth

The Complete Module Bundle price changes only when PromotionSure adds a
genuinely new separately purchasable module.

The price must not change because of:

- new practice sets
- new questions
- corrected questions
- improved explanations
- updated references
- interface improvements
- performance improvements
- technical fixes
- content updates inside an existing module

## Current Implementation Summary

The app already has several useful foundations:

- module-specific access through `module_entitlements`
- active module catalog RPCs
- Paystack payment initialization and verification
- immutable `payment_orders`
- `payment_order_items` for multi-module orders
- launch-offer pricing fields
- bundle offer catalog and bundle checkout
- payment history and receipt display
- admin payment attention diagnostics
- payment-related transactional email infrastructure

Important current limitation:

The latest bundle activation function still computes expiry from
`exam_packs.active_until`. This must change for new duration-based purchases.

Current hardcoded UI copy also still mentions access until 31 December 2026 in:

- `src/components/UnlockModuleModal.jsx`
- `src/components/BundleOffers.jsx`

## Backend Design Direction

### Source Of Truth

Pricing should be represented as backend data and backend functions, not
scattered frontend constants.

The backend should answer:

- which plans are available
- which durations are available
- which modules are eligible
- what the final price is
- what the comparison/list price is
- what the selected purchase includes
- what expiry will be created after payment

The frontend should display this backend-provided catalog and submit the user's
chosen plan, duration, and module selection.

### Recommended Tables

The exact schema can be refined during migration design, but the conceptual
model should be:

#### `purchase_plans`

Stores plan definitions.

Suggested fields:

- `id`
- `code`
- `name`
- `plan_type`
- `module_scope`
- `module_count`
- `module_practice_type`
- `enabled`
- `sort_order`
- `created_at`
- `updated_at`

Example `code` values:

- `individual_objective`
- `individual_oral`
- `three_module_bundle`
- `complete_bundle`

Example `plan_type` values:

- `single_module`
- `pick_n_modules`
- `complete_bundle`

#### `purchase_plan_prices`

Stores approved prices for explicit plans and durations.

Suggested fields:

- `id`
- `purchase_plan_id`
- `duration_months`
- `price_kobo`
- `list_price_kobo`
- `currency`
- `enabled`
- `created_at`
- `updated_at`

For individual objective, individual oral, and 3-module bundle, explicit stored
prices are safer than formula-only pricing because checkout, receipts, support,
and tests need stable approved values.

#### Complete Bundle Pricing Rule

Complete Bundle may need a supporting rule table or function because its price
depends on the current purchasable module count.

Suggested configurable values:

- `complete_bundle_monthly_price_per_module_kobo = 150000`
- `duration_discount_3_months = about 14%`
- `duration_discount_6_months = about 26%`
- `rounding_increment_kobo = 50000`

Even if generated by rule, the final computed values must be returned in the
catalog and stored on the payment order at checkout.

#### `payment_orders` Additions

Add snapshot fields so every order remains understandable forever.

Suggested fields:

- `purchase_plan_id`
- `plan_code`
- `duration_months`
- `access_starts_at`
- `access_expires_at`
- `catalog_module_count`
- `pricing_version`
- `purchase_snapshot jsonb`

The snapshot should include enough data for receipts and support even if module
names, plan names, or future prices later change.

Suggested `purchase_snapshot` contents:

```json
{
  "plan_code": "three_module_bundle",
  "plan_name": "3-Module Bundle",
  "duration_months": 3,
  "price_kobo": 1550000,
  "list_price_kobo": 1800000,
  "currency": "NGN",
  "module_count": 3,
  "modules": [
    {
      "subject_id": "...",
      "subject_slug": "public-service-rules",
      "subject_name": "Public Service Rules",
      "practice_type": "objective"
    }
  ]
}
```

### Reuse Existing Structures

The current `purchase_offers` table already supports bundle offers, but it is
offer-row oriented rather than duration-plan oriented. During implementation we
should decide whether to:

1. evolve `purchase_offers` into duration-aware purchase plans, or
2. introduce `purchase_plans` and gradually retire `purchase_offers` for the new
   core pricing system.

Recommendation: introduce the new plan model and keep old purchase offer logic
as a compatibility layer until the new flow is stable.

This avoids overloading the meaning of existing launch/bundle offers and keeps
the new duration system clearer.

## Checkout Design

### Pricing Catalog RPC

Create a backend RPC that returns the current pricing catalog for the signed-in
candidate.

Suggested name:

- `get_purchase_pricing_catalog_v1`

The RPC should return:

- available plan cards
- available duration options
- current prices
- comparison/list prices
- savings amounts
- eligible modules
- whether a plan is available to this candidate
- candidate-owned module count
- clear unavailable reasons

The RPC should not expose operational tables directly.

### Initialize Payment Payload

The frontend should submit:

```json
{
  "purchase_type": "pricing_plan",
  "plan_code": "three_module_bundle",
  "duration_months": 3,
  "subject_slugs": ["public-service-rules", "current-affairs", "pension"],
  "expected_price_kobo": 1550000
}
```

For an individual module:

```json
{
  "purchase_type": "pricing_plan",
  "plan_code": "individual_objective",
  "duration_months": 1,
  "subject_slugs": ["public-service-rules"],
  "expected_price_kobo": 250000
}
```

For Complete Bundle, the frontend should not submit every module as authority.
It may submit no module slugs or a displayed module checksum. The backend must
resolve the current complete list itself.

### Server-Side Checkout Validation

The payment initialization function must validate:

- user is authenticated
- active exam pack exists
- plan exists and is enabled
- duration exists and is enabled
- selected modules are valid for the active pack
- selected modules are currently purchasable
- selected modules match the plan rule
- individual objective cannot be used for an oral module
- individual oral cannot be used for an objective module
- 3-module bundle has exactly 3 distinct selected modules
- Complete Bundle includes all current purchasable modules at checkout time
- final backend price matches `expected_price_kobo`
- stale UI price returns `PRICE_CHANGED`
- ambiguous missing expected price returns `PRICE_CONFIRMATION_REQUIRED`

The Paystack amount must always come from the backend-computed final price.

### Checkout Key

The checkout key should include plan, duration, and selected module IDs so
idempotent checkout recovery does not resume the wrong purchase.

Suggested format:

```text
plan:{plan_code}:{duration_months}:{sorted subject ids}
```

For Complete Bundle, use the resolved module IDs at checkout time.

### Payment Order Items

Every module included in the purchase must be stored in `payment_order_items`.

For bundles, allocation can continue to split the paid amount across modules,
with remainders handled deterministically as the current implementation does.

Each item should keep:

- `subject_id`
- `module_offering_id`
- `list_price_kobo`
- `allocated_amount_kobo`

If later needed, add:

- `plan_price_kobo`
- `duration_months`
- `module_snapshot jsonb`

## Activation Design

### New Expiry Logic

The activation function should no longer use `exam_packs.active_until` as the
default expiry for new duration-based orders.

For each module item:

1. Find the user's current active entitlement for that module and exam pack.
2. Set `base_date = greatest(now(), current active entitlement expiry)`.
3. Set `expires_at = base_date + duration_months months`.
4. Create or extend module entitlement accordingly.
5. Store the resulting expiry in the entitlement metadata and payment order
   snapshot.

### Extension Behavior

If a user renews a module before expiry, paid time is preserved.

Example:

```text
Existing PSR access expires: 2026-09-08
User buys 3 months on:       2026-08-20
New PSR expiry:              2026-12-08
```

If a bundle includes modules with different current expiries, each module should
extend from its own current expiry.

Example:

```text
PSR active until:      2026-09-08
Current Affairs until: none
Pension until:         2026-10-01
Bundle duration:       3 months

PSR new expiry:        2026-12-08
Current Affairs:       now + 3 months
Pension new expiry:    2027-01-01
```

The payment order can store a purchase-level summary, but module entitlements
remain the detailed source for each module expiry.

### Legacy Activation

Orders without `duration_months` should be treated as legacy.

Legacy behavior should remain:

- fulfill existing orders safely
- do not modify old active entitlements
- keep old receipt/payment history behavior
- avoid breaking support-created or pre-duration records

If any old pending pre-duration checkout remains risky, we should intentionally
expire or fail it with a clear support-safe message instead of silently
activating it under new rules.

## Frontend Design Plan

Frontend implementation should begin after the backend catalog and checkout
contract exist.

Detailed modal UX, sketches, density rules, and implementation sequencing are
documented in `docs/PRICING_MODAL_DESIGN_PLAN.md`.

### Candidate Flow

Recommended customer-facing flow:

```text
Choose access type
-> choose duration
-> choose module(s), if needed
-> review price and savings
-> continue to Paystack
```

Access types:

- Individual Module
- 3-Module Bundle
- Complete Module Bundle

Durations:

- 1 month
- 3 months
- 6 months

### Display Requirements

The UI should show:

- plan name
- duration
- final price
- regular monthly equivalent where useful
- saving amount
- approximate saving percentage for 3 and 6 months
- included modules
- estimated access period after payment
- Paystack secure payment reassurance

The UI must remove old fixed-date copy:

- "Access valid until 31 December 2026"
- "Access until 31 December 2026"

Replacement copy examples:

- "Access starts after payment is verified."
- "Valid for 3 months after activation."
- "If you renew early, remaining active time is preserved."

### Error Handling

The frontend must handle:

- `PRICE_CHANGED`: reload catalog and ask user to confirm updated price
- `PRICE_CONFIRMATION_REQUIRED`: require explicit user confirmation
- unavailable plan: return to pricing catalog with reason
- selected module no longer purchasable: refresh module list
- duplicate/ongoing checkout: resume or show current checkout state

### Receipts And Payment History

Receipts should show:

- purchase name
- duration
- module list or module count
- amount paid
- payment reference
- activation date
- access expiry

For bundles with per-module extension behavior, receipts can show the maximum
expiry in the summary and list per-module expiry details if needed.

## Admin And Support Plan

The pricing migration affects admin more than just "showing new prices." Admin
needs to understand, configure, audit, and repair duration-based purchases.
Without this, support will become confused when users ask why one module expires
on one date while another expires on a different date.

### Admin Pricing Management

Admin should eventually have a dedicated pricing area, or an expanded purchase
offer area, for:

- viewing all enabled purchase plans
- viewing 1-, 3-, and 6-month prices
- editing approved prices
- editing customer-facing plan names
- editing short plan descriptions/supporting text
- editing savings/supporting labels
- editing display order
- editing plan visibility
- seeing which plans are active or disabled
- seeing current Complete Bundle module count
- seeing computed Complete Bundle prices before publishing
- checking the current list of modules included in Complete Bundle
- reviewing when a price was last changed
- seeing who changed a price

Recommended rule:

Only backend/admin functions should change pricing. Admin UI should call audited
RPCs rather than writing pricing tables directly.

Pricing changes should write audit logs containing:

- actor/admin user
- previous price
- new price
- plan code
- previous customer-facing copy
- new customer-facing copy
- duration
- timestamp
- reason or note, if provided

### Commercial Copy Management

Admin should be able to manage pricing presentation copy without a code deploy.
This includes:

- plan display name
- short description
- included-benefits bullets
- supporting text under the price
- bundle helper text
- savings label
- call-to-action label, if needed
- whether a plan is featured
- display order
- enabled/disabled state

Examples:

```text
Individual Module
Choose one objective module or the oral module.

3-Module Bundle
Choose any 3 available modules and save compared with buying separately.

Complete Module Bundle
Access all modules currently available at the time of purchase.
```

However, some legal/product-sensitive text should be protected by guardrails:

- Complete Bundle must not be renamed to "All future modules"
- Complete Bundle must not imply future modules are automatically included
- duration text must match the selected duration
- prices shown in copy must not be manually typed separately from price fields
- checkout amount must never come from editable text

Recommendation:

Use structured fields for commercial content, not one large free-form HTML blob.
This gives admin flexibility while keeping the checkout safe and the UI
consistent.

Suggested fields:

- `display_name`
- `short_description`
- `supporting_text`
- `included_bullets jsonb`
- `savings_label`
- `cta_label`
- `featured boolean`
- `sort_order integer`

The frontend should render these fields, but the backend should still enforce
plan code, module scope, duration, and amount.

### Pricing Edits And Versioning

Admin should be able to change prices, but price changes should not mutate old
orders.

Recommended behavior:

- changing a price affects only future checkouts
- pending checkout with old price should either resume the old saved order or be
  rejected with `PRICE_CHANGED`, depending on whether the payment order was
  already created
- successful old purchases keep their paid amount and expiry
- receipts use the payment order snapshot, not current plan text

For safer operations, use one of these approaches:

1. effective-dated price rows, or
2. simple current price rows plus immutable payment order snapshots and audit
   logs.

Recommendation for current stage:

Use simple current price rows plus immutable order snapshots. Add effective-date
versioning later if pricing changes become frequent or scheduled campaigns are
needed.

### Admin Guardrails

Admin flexibility should come with validation:

- prices must be positive
- prices should be multiples of NGN 500 unless an admin override is deliberately
  allowed
- 3-month price should be less than 3 monthly purchases
- 6-month price should be less than 6 monthly purchases
- 3-Module Bundle should be cheaper than buying 3 individual objective modules
  at the same duration
- Complete Bundle 1-month price should follow the configured per-module rule
  unless explicitly overridden
- disabled plans cannot be purchased
- hidden plans cannot appear in the public catalog
- empty customer-facing names/descriptions are rejected
- plan codes should be stable and not editable by normal admin UI

This lets admin control the business presentation without making the system
fragile.

### Admin Purchase Visibility

Admin user/payment views should show:

- plan bought
- duration bought
- amount paid
- list/comparison price
- saving
- payment reference
- included modules
- activation date
- expiry per module
- whether the purchase created new access or extended existing access
- checkout status
- fulfillment status
- payment provider status

This is especially important for bundles because the payment is one order but
creates multiple module entitlements.

### Admin User Directory Impact

The current admin user directory groups users by paid/unpaid and payment state.
After duration pricing, it should also support:

- active paid users
- expired paid users
- users expiring soon
- users with only one module
- users with multiple modules
- users with Complete Bundle
- users who started checkout but did not pay
- users whose payment succeeded but access failed

Suggested future filters:

- plan code
- duration months
- module owned
- access expires before/after date
- purchase date range
- payment status
- fulfillment status

### Manual Grants And Support Fixes

Admin support tools should be updated carefully. Manual grants must not become a
backdoor that creates unclear access.

Manual access actions should require:

- user
- module(s)
- duration or explicit expiry date
- reason
- admin actor
- optional payment/support reference

Manual grants should write metadata showing that the entitlement was not created
by a normal Paystack checkout.

Possible manual actions:

- grant 1 month for a module
- grant 3 months for a module
- grant 6 months for a module
- extend an existing module entitlement
- grant selected modules after verified manual/support payment
- fix a failed bundle fulfillment
- expire/revoke access after refund or dispute

Every manual action should be auditable.

### Payment Attention Queue Impact

The payment attention queue should include plan and duration context so support
can diagnose issues quickly.

Add or expose:

- `plan_code`
- `purchase_label`
- `duration_months`
- `module_count`
- `access_expires_at`
- `included_modules`
- `purchase_snapshot`

For bundle failures, the queue should make clear whether:

- no modules were activated
- some modules were activated
- all modules were activated but the order was not marked fulfilled
- Paystack succeeded but verification callback failed

### Refund And Dispute Handling

Refund/dispute logic becomes more sensitive with duration access.

Admin needs to know:

- which entitlement came from which payment order
- which modules should be revoked after a full refund
- what to do after a partial refund
- whether a dispute should suspend access immediately
- whether a resolved dispute should restore access

Recommendation:

Postpone partial-refund product behavior unless required. For launch, handle full
refunds/disputes cleanly and keep partial refunds as an admin-reviewed case.

### Admin Content Management Interaction

Adding a new practice set should not affect Complete Bundle price.

Adding a new separately purchasable module should affect Complete Bundle price.

Therefore, admin content workflows need a clear distinction between:

- editing content inside an existing module
- publishing a new practice set
- making a new subject/module separately purchasable

When a new module becomes purchasable, admin should see that Complete Bundle
price will change because the current purchasable module count changed.

### Admin Email/Campaign Impact

The future email system should use admin-visible pricing and access facts.

Admin should eventually be able to target:

- users whose 1-month access expires soon
- users whose 3-month access expires soon
- users whose access expired
- users who bought an individual module but not a bundle
- users who started checkout and did not pay
- users who paid but have a support/fulfillment issue
- users with Complete Bundle

This means pricing data must be stored in stable, queryable backend fields, not
only in frontend copy.

### Admin Rollout Needs

Before switching the public frontend to duration pricing, admin should be able
to inspect:

- current plan catalog
- current module count
- current computed Complete Bundle price
- recent test payments
- created entitlements
- expiry dates
- failed checkout/fulfillment records

Minimum viable admin support for launch:

- payment history shows plan and duration
- payment attention queue shows plan and duration
- support/admin can see included modules and expiry
- manual database inspection remains possible through clear order snapshots

Full admin pricing management can come after backend stability if needed, but
admin visibility should not be postponed.

Admin surfaces should eventually show:

- pricing plans
- duration prices
- whether plans are enabled
- current Complete Bundle module count
- computed Complete Bundle prices
- recent purchases by plan and duration
- module entitlements created or extended by a purchase
- exact expiry per module
- payment attention records with plan label and duration

Support needs to answer:

- what did the user buy?
- when did they pay?
- which modules were included?
- what duration did they buy?
- was access newly created or extended?
- when does each module expire?
- did checkout use an old/stale price?
- did fulfillment fail after Paystack success?

## Email System Implications

This pricing change will become an input to the later email system work.

Useful future segments:

- checkout started but unpaid
- payment failed
- payment successful
- access activation failed
- access expiring in 7 days
- access expiring in 1 day
- access expired
- renewed successfully
- user practiced free set but did not buy
- user bought one module but not a bundle

Because emails will rely on duration and expiry dates, payment orders and module
entitlements must be accurate before email automation expands.

## External Research Notes

Payment fee structure matters because PromotionSure's entry price is low.

Sources checked during planning:

- Paystack pricing: `https://paystack.com/pricing`
- Paystack Nigeria transaction fee support note:
  `https://support.paystack.com/en/articles/2130306`
- Flutterwave Nigeria pricing:
  `https://flutterwave.com/ng/support/pricing/pricing-for-receiving-payment`
- Nigerian online exam/course pricing examples:
  `https://courses.laimoon.com/nigeria/exam-preperation/fees`

Current Paystack Nigeria local transaction pricing publicly lists
`1.5% + NGN 100`, with the NGN 100 fee waived for transactions under NGN 2,500,
and local fees capped. Before final launch, verify the exact current fee rule
again because provider pricing can change.

Strategic implication:

The framework's prices are coherent and affordable, but the NGN 2,500 entry
price sits near an important payment-fee threshold. This does not require a
price change, but it should be considered when estimating net revenue.

## Safe Implementation Sequence

### Phase 0: Confirm Final Rules

Confirm:

- expiry starts from successful activation
- early renewal extends from current active expiry
- existing purchases are preserved
- Complete Bundle snapshots modules at checkout
- future modules are not included automatically
- oral module is included in Complete Bundle when separately purchasable
- whether 3-Module Bundle may mix objective and oral modules
- whether Complete Bundle remains available after buying an individual module
- whether upgrade credit will be postponed

Recommendation:

Postpone upgrade credit. Implement clean purchases and renewals first.

### Phase 1: Backend Schema

Add pricing plan structures and payment order snapshot fields.

Deliverables:

- new migration
- seeded plan rows
- seeded explicit duration prices
- Complete Bundle calculation function/rule
- RLS/revoke/grant review
- admin-safe audit fields where needed

### Phase 2: Pricing Catalog RPC

Create a candidate-facing pricing catalog RPC.

Deliverables:

- catalog returns plan/duration/module eligibility
- catalog hides operational tables
- catalog handles currently owned modules
- catalog computes Complete Bundle from current purchasable module count
- SQL tests for plan output

### Phase 3: Checkout Update

Update Paystack initialization.

Deliverables:

- new request payload support
- backend plan validation
- duration validation
- selected module validation
- expected price validation
- payment order snapshot
- payment order items
- idempotent checkout key includes plan and duration
- unit tests for payment validation changes

### Phase 4: Activation Update

Update module purchase activation.

Deliverables:

- duration-based expiry for new orders
- renewal extension from existing expiry
- per-module expiry logic for bundles
- legacy order compatibility
- idempotent repeated fulfillment
- SQL tests for expiry behavior

### Phase 5: Frontend Pricing Flow

Update candidate UI after backend contract is ready.

Deliverables:

- access type selector
- duration selector
- module picker for individual and 3-module bundle
- Complete Bundle review
- savings display
- backend-driven prices
- checkout calls with plan and duration
- removal of old fixed expiry copy

### Phase 6: Admin And Support Updates

Update operational screens and diagnostics.

Deliverables:

- payment attention shows plan/duration
- payment history supports duration labels
- receipts include duration and expiry
- admin pricing management either added or intentionally deferred
- support playbook updated

### Phase 7: Regression And Rollout

Run full validation before production rollout.

Deliverables:

- unit tests
- SQL tests
- mocked Paystack e2e tests
- access progression regression
- payment history regression
- admin attention regression
- receipt regression
- email event regression

## Test Plan

### SQL Tests

Required cases:

- candidate cannot read pricing operational tables directly
- catalog returns individual objective prices
- catalog returns individual oral prices
- catalog returns 3-module bundle prices
- catalog returns Complete Bundle dynamic prices for current module count
- 3-module bundle requires exactly 3 modules
- duplicate selected modules are rejected
- unavailable modules are rejected
- objective plan rejects oral module
- oral plan rejects objective module
- stale expected price is rejected
- Complete Bundle snapshots current modules
- future module is not added to old Complete Bundle purchase
- 1-month activation expires 1 month after activation
- 3-month activation expires 3 months after activation
- 6-month activation expires 6 months after activation
- early renewal extends from current expiry
- repeated activation is idempotent
- legacy orders still fulfill or display safely

### Unit Tests

Required cases:

- money formatting
- duration savings calculation
- checkout payload construction
- payment validation metadata for plan purchases
- Paystack amount validation remains exact
- receipt label formatting

### E2E Tests

Required cases:

- candidate chooses individual objective 1 month and reaches Paystack mock
- candidate chooses individual oral 3 months and reaches Paystack mock
- candidate chooses 3-module bundle 6 months and reaches Paystack mock
- candidate chooses Complete Bundle and sees current module count
- stale price response refreshes catalog
- successful mock payment unlocks expected module(s)
- payment history shows duration-based access

## Rollout Strategy

Recommended rollout:

1. Ship backend schema and catalog RPC behind unused frontend path.
2. Add tests for the new backend while old frontend still works.
3. Update Paystack initialization to support both old and new payloads.
4. Update activation to handle new duration orders and old legacy orders.
5. Switch frontend to the new pricing catalog.
6. Monitor payment initialization, verification, fulfillment, and support queues.
7. Disable old bundle-offer path after confidence period.
8. Remove obsolete fixed-date copy and old compatibility code only after live
   payments prove stable.

## Risks And Mitigations

### Risk: Incorrect Expiry

Mitigation:

- compute expiry server-side only
- store duration and expiry snapshot on the order
- SQL tests for each duration and renewal case

### Risk: Stale Frontend Price

Mitigation:

- require `expected_price_kobo`
- reject mismatch with `PRICE_CHANGED`
- reload catalog before retry

### Risk: Complete Bundle Becomes Future-Module Promise

Mitigation:

- snapshot included modules in `payment_order_items`
- receipt copy says "modules included at purchase"
- future module grants require explicit admin/promo action

### Risk: Breaking Old Purchases

Mitigation:

- legacy orders without duration keep old behavior
- existing entitlements are not rewritten
- tests cover old payment history and activation

### Risk: Admin Cannot Explain Purchases

Mitigation:

- add plan/duration/snapshot fields
- update payment attention and receipt views
- keep exact Paystack amount and module list immutable

## Decisions To Resolve Before Coding

1. Can 3-Module Bundle mix objective and oral modules?
2. Is Complete Bundle available only before buying any module, or can it be
   bought later as a broader access purchase?
3. Should upgrade credit exist now, or be postponed?
4. Should Complete Bundle dynamic 3- and 6-month prices be generated purely by
   formula or stored as approved prices per module-count band?
5. Should access ever be capped by exam pack end date, or is duration always
   honored fully across calendar years?

Current recommendation:

- allow duration to run from payment/renewal date without exam-pack cap
- postpone upgrade credit
- snapshot Complete Bundle modules at checkout
- store explicit approved prices for fixed plans
- calculate Complete Bundle dynamically but snapshot final amount

## Implementation Principle

Do not implement this as a frontend pricing redesign first.

Implement backend truth first, prove it with tests, then let the frontend become
a clear interface over that truth.
