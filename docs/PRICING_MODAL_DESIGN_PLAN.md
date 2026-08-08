# PromotionSure Pricing Modal Design Plan

Date: 2026-08-08

## Purpose

PromotionSure is moving from fixed exam-cycle pricing to duration-based access:
1 month, 3 months, and 6 months. The payment UI must support this without
making candidates feel like they are shopping through a complex SaaS pricing
page.

The current product already has two useful payment surfaces:

- `UnlockModuleModal` for one module.
- `BundleCheckoutModal` for bundle offers.

The visual direction is good, especially the focused sheet used by the bundle
checkout. The problem is that duration pricing introduces more choices. If we
simply add plan buttons, duration buttons, module choices, savings labels, and
checkout actions to the existing modals, the UI will become noisy.

This plan defines a unified modal that keeps the current design language while
controlling decision load.

## Research Principles

External UX research points to four principles that fit this product:

1. Progressive disclosure: show the most important choice first and reveal
   secondary detail only when needed.
2. Avoid choice overload: too many plans and CTAs at once can slow decisions or
   cause regret.
3. Use clear choice controls: radio cards or segmented buttons are appropriate
   for mutually exclusive duration/payment choices.
4. Show the real amount payable today: candidates should see the actual Paystack
   amount, not only a monthly-equivalent comparison.

Sources reviewed:

- NN/g Progressive Disclosure:
  `https://www.nngroup.com/articles/progressive-disclosure/`
- NN/g Choice Overload:
  `https://www.nngroup.com/videos/choice-overload/`
- NN/g Reducing Cognitive Load in Forms:
  `https://www.nngroup.com/articles/4-principles-reduce-cognitive-load/`
- Baymard Checkout UX:
  `https://baymard.com/blog/current-state-of-checkout-ux`
- Baymard Payment Selection UX:
  `https://baymard.com/blog/payment-method-selection`
- Smashing Magazine Pricing UX:
  `https://www.smashingmagazine.com/2022/07/designing-better-pricing-page/`

## Core Product Decision

Use one unified modal:

```text
AccessPlanModal
```

It should gradually replace:

- `UnlockModuleModal`
- `BundleCheckoutModal`

The modal should inherit the current `bundle-checkout-sheet` feeling:

- centered desktop dialog
- bottom sheet on mobile
- simple header
- scrollable middle body
- sticky footer CTA
- one obvious payment action

## User Mental Model

The candidate should experience the flow as:

```text
Choose access length
Confirm module(s)
Pay securely
```

Not:

```text
Compare every pricing plan
Understand product architecture
Decode discounts
Choose between unrelated modals
```

## Choice Budget

The modal must obey a strict choice budget.

Visible at one time:

- 1 close control
- 1 primary payment CTA
- 3 duration choices
- up to 3 access type choices
- module choices only when required

Avoid:

- one CTA per duration
- one CTA per plan
- separate "apply duration" button
- separate "confirm modules" button
- price copy duplicated in multiple areas
- long explanatory paragraphs

All selections update instantly.

## Entry Points

### Dashboard Module Card

When a candidate clicks `Unlock module`, open `AccessPlanModal` with:

- default access type: individual module
- preselected module: the clicked module
- default duration: 1 month unless a better default is later chosen

The modal may show better-value bundle paths, but the candidate should never
feel forced into a bundle.

### Access Page

The `/access` page should eventually show a compact pricing section above the
module list. Each plan row/card opens the same modal:

- Individual Module opens with no module selected, or with the first locked
  module if launched from a module row.
- 3-Module Bundle opens with the module picker visible.
- Complete Bundle opens with included modules shown as locked/included.

### Deep Link

Existing `/access?module=subject-slug` behavior can continue, but it should open
the new modal rather than the old single-module modal.

## Data Dependencies

The modal should not build prices from frontend constants.

It should receive:

- `pricingCatalog` from `getPurchasePricingCatalog()`
- current module/access catalog from `getModuleAccessCatalog()`
- subjects/modules from `getSubjects()` or catalog-provided module rows
- an optional initial subject slug
- an optional initial plan code

Checkout should call:

```text
initializePricingPlanPayment({
  planCode,
  durationMonths,
  subjectSlugs,
  expectedPriceKobo
})
```

## Catalog Mapping

Expected pricing plan codes:

- `individual_objective`
- `individual_oral`
- `three_module_bundle`
- `complete_bundle`

Access type display groups:

```text
This module
Pick 3
Complete
```

The individual plan code depends on the selected module practice type:

- objective module -> `individual_objective`
- oral module -> `individual_oral`

## Modal Layout

### Desktop Skeleton

```text
┌────────────────────────────────────────────────────┐
│ [Title]                                         ×  │
│ [Short context copy]                               │
├────────────────────────────────────────────────────┤
│ Access type                                        │
│ [This module] [Pick 3] [Complete]                  │
│                                                    │
│ Access length                                      │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐       │
│ │ 1 month    │ │ 3 months   │ │ 6 months   │       │
│ │ ₦x         │ │ ₦x         │ │ ₦x         │       │
│ │            │ │ Save...    │ │ Best value │       │
│ └────────────┘ └────────────┘ └────────────┘       │
│                                                    │
│ [Conditional selected plan body]                   │
├────────────────────────────────────────────────────┤
│ Secure payment by Paystack.                        │
│ [Continue to payment · ₦x]                         │
└────────────────────────────────────────────────────┘
```

### Mobile Skeleton

```text
┌──────────────────────────────┐
│ ─────                        │
│ [Title]                      │
│ [Context copy]               │
├──────────────────────────────┤
│ Access type                  │
│ ┌──────────────────────────┐ │
│ │ This module       Active │ │
│ ├──────────────────────────┤ │
│ │ Pick 3 modules           │ │
│ ├──────────────────────────┤ │
│ │ Complete Bundle          │ │
│ └──────────────────────────┘ │
│                              │
│ Access length                │
│ [1 month] [3 months] [6 mo]  │
│                              │
│ [Conditional body]           │
├──────────────────────────────┤
│ Secure payment by Paystack.  │
│ [Continue · ₦x]              │
└──────────────────────────────┘
```

On mobile, access type can become a vertical list if horizontal tabs feel too
compressed.

## Modal State 1: Individual Module

Default when launched from a module card.

```text
┌──────────────────────────────────────────────┐
│ Civil Procedure                            × │
│ Choose how long you want access.             │
├──────────────────────────────────────────────┤
│ Access type                                  │
│ [This module] [Pick 3] [Complete]            │
│                                              │
│ Access length                                │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│ │ 1 month  │ │ 3 months │ │ 6 months │       │
│ │ ₦2,500   │ │ ₦6,500   │ │ ₦11,000  │       │
│ │          │ │ Save ₦1k │ │ Best val │       │
│ └──────────┘ └──────────┘ └──────────┘       │
│                                              │
│ Included                                     │
│ ✓ Civil Procedure                            │
│ ✓ All published practice sets                │
│ ✓ Retries, answer review, progress tracking  │
│                                              │
│ Access starts after payment is verified.     │
├──────────────────────────────────────────────┤
│ Secure payment by Paystack.                  │
│ [Continue to payment · ₦2,500]               │
└──────────────────────────────────────────────┘
```

Notes:

- The clicked module is already selected.
- No module picker is shown.
- Bundle alternatives are access-type options, not separate promotional CTAs.
- If the module is oral, prices come from the oral individual plan.

## Modal State 2: Individual Module Without A Preselected Module

Possible from `/access` if the user starts with "Individual Module" from a
pricing card.

```text
┌──────────────────────────────────────────────┐
│ Individual Module                          × │
│ Choose one module and access length.         │
├──────────────────────────────────────────────┤
│ Access type                                  │
│ [This module] [Pick 3] [Complete]            │
│                                              │
│ Module                                       │
│ ┌──────────────────────────────────────────┐ │
│ │ ○ Civil Procedure                        │ │
│ │ ○ Criminal Law                           │ │
│ │ ○ Oral Interview                         │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Access length                                │
│ [1 month] [3 months] [6 months]              │
├──────────────────────────────────────────────┤
│ [Choose a module]                            │
└──────────────────────────────────────────────┘
```

If no module is selected, the CTA is disabled and becomes instructional.

## Modal State 3: Pick 3 Modules

```text
┌──────────────────────────────────────────────┐
│ Pick 3 Modules                             × │
│ Choose any 3 available modules.              │
├──────────────────────────────────────────────┤
│ Access type                                  │
│ [This module] [Pick 3] [Complete]            │
│                                              │
│ Access length                                │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│ │ 1 month  │ │ 3 months │ │ 6 months │       │
│ │ ₦6,000   │ │ ₦15,500  │ │ ₦26,500  │       │
│ └──────────┘ └──────────┘ └──────────┘       │
│                                              │
│ Modules                          1 of 3      │
│ ┌──────────────────────────────────────────┐ │
│ │ ● Civil Procedure                        │ │
│ │ ○ Criminal Law                           │ │
│ │ ○ Evidence                               │ │
│ │ ○ Drafting                               │ │
│ └──────────────────────────────────────────┘ │
├──────────────────────────────────────────────┤
│ Secure payment by Paystack.                  │
│ [Select 2 more modules]                      │
└──────────────────────────────────────────────┘
```

When selection is complete:

```text
[Continue to payment · ₦15,500]
```

Rules:

- Selecting a fourth module should not be allowed.
- Tapping a selected module deselects it.
- If launched from a module card, that module starts selected.
- Owned active modules should usually be hidden or marked unavailable unless
  renewal-in-bundle is intentionally allowed in this UI.

## Modal State 4: Complete Bundle

```text
┌──────────────────────────────────────────────┐
│ Complete Bundle                            × │
│ All currently available modules.             │
├──────────────────────────────────────────────┤
│ Access type                                  │
│ [This module] [Pick 3] [Complete]            │
│                                              │
│ Access length                                │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│ │ 1 month  │ │ 3 months │ │ 6 months │       │
│ │ ₦13,500  │ │ ₦35,000  │ │ ₦59,500  │       │
│ │ 9 mods   │ │ Save     │ │ Best val │       │
│ └──────────┘ └──────────┘ └──────────┘       │
│                                              │
│ Included                         9 modules   │
│ ┌──────────────────────────────────────────┐ │
│ │ ✓ Civil Procedure                        │ │
│ │ ✓ Criminal Law                           │ │
│ │ ✓ Evidence                               │ │
│ │ ✓ Oral Interview                         │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ Future modules are not included automatically.│
├──────────────────────────────────────────────┤
│ Secure payment by Paystack.                  │
│ [Continue to payment · ₦35,000]              │
└──────────────────────────────────────────────┘
```

Rules:

- The user cannot manually edit included modules.
- The backend resolves final included modules at checkout.
- Copy must never imply access to future modules.

## Duration Selector

Use radio-card buttons, not a switch.

Why:

- There are three durations, not two.
- Each duration has its own price.
- Savings labels belong directly beside each option.
- Radio-card controls are clearer than a dropdown because all options remain
  visible.

Each duration card should include:

- duration label: `1 month`, `3 months`, `6 months`
- final amount payable today
- optional savings label from backend
- optional list price/struck-through amount if useful

Do not show:

- monthly equivalent as the main price
- detailed discount math
- multiple savings formats at once

## Price Display

Primary price rule:

```text
Show the final amount the user will pay today.
```

Good:

```text
₦15,500
3 months
Save about 14%
```

Avoid:

```text
₦5,166/month billed quarterly, annualized savings 13.8%, equivalent...
```

For this audience, clarity beats clever pricing math.

## Copy Rules

Remove old fixed-expiry copy:

- `Access valid until 31 December 2026`
- `Access until 31 December 2026`

Use duration copy:

- `Access starts after payment is verified.`
- `Valid for 1 month after activation.`
- `Valid for 3 months after activation.`
- `Valid for 6 months after activation.`
- `Renewing early preserves your remaining active time.`

Use the renewal copy sparingly. It can appear as a small footnote only when the
user already has active access for the selected module.

## Accessibility

Requirements:

- Modal uses `role="dialog"` and `aria-modal="true"`.
- Header title is connected via `aria-labelledby`.
- Escape closes only when payment is not in progress.
- Backdrop click closes only when payment is not in progress.
- Duration choices use real buttons with `aria-pressed` or radio inputs.
- Module choices use `aria-pressed` for toggle behavior.
- Disabled CTA text explains what is missing.
- Focus states must remain visible.
- Footer CTA must not jump height when text changes.

Future improvement:

- Add focus trap if the project does not already have one.

## Error States

### Price Changed

When backend returns stale price:

```text
Price changed. Review the updated amount before continuing.
```

Behavior:

- reload pricing catalog
- keep the user's selected plan/modules if still valid
- require another CTA click

### Plan Unavailable

```text
This plan is no longer available.
```

Behavior:

- disable checkout
- show available plans
- do not lose selected module if switching to another valid plan

### Module Unavailable

```text
One selected module is no longer available.
```

Behavior:

- refresh module list
- remove invalid module from selection
- disabled CTA explains remaining needed modules

### Payment Initialization Failure

```text
We could not start payment right now. Please try again.
```

Behavior:

- keep selections
- allow retry
- do not redirect

## Visual Density Rules

The modal should feel quiet and transactional.

Do:

- use thin dividers
- keep small headings
- use compact radio cards
- use one strong price per selected duration
- show module list in a contained scroll area
- keep the footer sticky

Avoid:

- large hero-style headings
- decorative illustrations
- nested cards
- many badges
- long benefit lists
- repeated "save" labels everywhere
- separate cards inside cards

## Component Plan

### New Files

Recommended:

```text
src/components/AccessPlanModal.jsx
src/lib/pricingPlans.js
tests/unit/pricing-plans.test.js
```

### `AccessPlanModal` Props

```js
{
  catalog,
  modules,
  initialSubjectSlug,
  initialPlanCode,
  error,
  onClose,
  onPay,
  paying
}
```

`onPay` receives:

```js
{
  planCode,
  durationMonths,
  subjectSlugs,
  expectedPriceKobo
}
```

### Helper Functions

`pricingPlans.js` should own:

- find plan by code
- derive individual plan code from practice type
- choose default duration
- get duration price
- calculate savings amount from list price
- build CTA copy
- validate selected modules
- derive selected module names
- normalize catalog rows

Keep complicated choice logic out of JSX.

## Implementation Sequence

### Phase 1: Plan Helpers

Add pure helpers and unit tests.

Needed tests:

- objective module maps to `individual_objective`
- oral module maps to `individual_oral`
- 1-month default is selected when no duration is provided
- selected duration price is found from catalog
- CTA says `Choose a module` when no individual module is selected
- CTA says `Select 2 more modules` for incomplete Pick 3
- CTA says `Continue to payment - ₦x` when valid
- Complete Bundle submits no manual module authority or submits displayed slugs
  only as a non-authoritative display selection, depending on final API choice

### Phase 2: Modal Component

Build `AccessPlanModal`.

Initially support:

- individual module
- Pick 3
- Complete Bundle
- duration selector
- module picker
- sticky CTA
- mobile sheet behavior

### Phase 3: `/access` Integration

Use `getPurchasePricingCatalog()`.

Keep old bundle UI temporarily hidden behind a fallback if the new catalog fails.

Replace:

- `BundleOffers`
- `BundleCheckoutModal`
- `UnlockModuleModal`

with:

- pricing plan summary section
- `AccessPlanModal`

### Phase 4: Dashboard Integration

Use the same modal from Dashboard.

When user clicks a locked module:

- open individual plan
- preselect clicked module
- show bundle alternatives inside modal

### Phase 5: Payment History/Receipt Polish

Update labels so duration purchases read naturally:

- `Civil Procedure - 3 months`
- `Pick 3 Modules - 6 months`
- `Complete Bundle - 1 month`

Receipts should show:

- amount paid
- payment reference
- duration
- access expiry
- module count/list

### Phase 6: Remove Old Bundle Path

After the new flow is verified:

- remove old `BundleOffers` usage
- keep legacy backend compatibility for old orders
- remove fixed-date copy from old components or delete components

## Rollout Guardrails

Before switching users fully:

- old checkout still works during transition
- new checkout is behind the new catalog RPC
- failed catalog load does not break existing access page
- payment test suite remains green
- mobile screenshot is reviewed
- no fixed `31 December 2026` purchase copy remains visible

## Final Recommended UX

The best version is not a big pricing page and not a heavy modal.

It is a small, focused access sheet:

```text
Access type
Duration
Modules
Pay
```

The user should make one decision at a time, with one payment button at the end.
