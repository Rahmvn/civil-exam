# Access Purchase Page Redesign Plan

Date: 2026-08-08

## Purpose

This document defines the redesign direction for PromotionSure's access and
payment experience.

The main decision is:

```text
Do not use a modal as the main purchase surface.
Use /access as the purchase page.
```

The current pricing modal is doing too much. It handles access scope, duration,
module selection, price review, checkout action, and error messaging inside a
constrained overlay. That creates a cramped and unclear buying experience,
especially on mobile.

The redesigned flow should be quieter, more direct, and closer to a purchase
form than a pricing page.

## Current Architecture

The app already has the right high-level route split:

- Dashboard owns module discovery and practice entry.
- Practice/module/result/review surfaces may expose locked states.
- `/access` owns payment and access management.
- Paystack checkout is initialized through backend functions.
- Pricing and entitlement rules are backend-owned.

Relevant frontend files:

- `src/pages/Dashboard.jsx`
- `src/pages/Access.jsx`
- `src/components/AccessPlanModal.jsx`
- `src/lib/pricingPlans.js`
- `src/lib/appApi.js`

Relevant backend/RPC surface:

- `get_module_access_catalog_v2`
- `get_purchase_pricing_catalog_v1`
- `initialize-paystack-payment`
- `verify-paystack-payment`
- duration-based pricing tables and payment order snapshots

The current dashboard already treats free practice and payment as sibling
actions:

```text
Try free
Unlock module
```

That structure should remain. The redesign should not introduce a new
marketing layer such as "free trial" on the access page.

## Problem With The Current Purchase Modal

`AccessPlanModal` is currently used from both:

- Dashboard `Unlock module`
- `/access` pricing plan cards

This causes several problems:

- A modal is too small for scope, duration, module choice, summary, and payment.
- On mobile, the modal becomes a long bottom sheet rather than a focused dialog.
- The user loses the sense that payment is a serious route-level action.
- The access page becomes a launcher for another surface instead of doing the job
  itself.
- The same buying decision is split between visible page cards and hidden modal
  state.
- Plan names leak backend structure into the UI.

The modal should not be made taller or more elaborate. It should be removed from
the main buying flow.

## Product Principles

### 1. Payment Is A Page-Level Task

Buying access is important enough to own the page.

The user should see:

- what they are buying
- which module or modules are included
- how long access lasts
- the exact amount payable now
- the payment action

These should not be hidden inside an overlay.

### 2. No Pricing Card Wall

The access page should not look like a SaaS pricing page.

Avoid:

- four boxed plan cards
- big plan comparison grids
- repeated "Choose" buttons
- marketing-style plan descriptions
- nested cards
- oversized headings
- long explanatory copy

Use a simple purchase form instead.

### 3. No User-Facing Split Between Objective And Oral Plans

The backend may keep separate plan codes:

```text
individual_objective
individual_oral
three_module_bundle
complete_bundle
```

The user-facing access scopes should be:

```text
One module
Pick 3
Complete
```

If the selected module is oral, the UI uses the oral individual price. If the
selected module is objective, it uses the objective individual price.

The user should not have to choose between "Individual Module" and "Oral
Module" as commercial products.

### 4. Free Practice Is Not A Requirement Before Payment

A candidate may buy access without using free practice.

The dashboard can continue to show both:

```text
Try free
Unlock module
```

The access page should focus on buying access. It does not need a prominent
"free trial" section.

### 5. The Backend Remains The Source Of Truth

The frontend displays choices and submits intent.

The backend decides:

- which plans are available
- which modules are eligible
- which duration prices apply
- whether a selected module is oral or objective
- final Paystack amount
- checkout validity
- entitlement creation and expiry

The frontend must not build prices from constants or assume access from local
state.

## Target User Flow

### Dashboard Unlock

```text
Dashboard
-> user taps Unlock module
-> /access?module=public-service-rules
```

The access page opens preconfigured:

```text
Scope: One module
Module: Public Service Rules
Length: 1 month
CTA: Continue to Paystack
```

### Locked Practice Or Batch

```text
Locked practice/batch state
-> Unlock
-> /access?module=public-service-rules&returnTo=/modules/public-service-rules
```

After payment verification:

```text
/payment/verify
-> safe returnTo if present
-> otherwise /dashboard
```

### Result Or Review Unlock

```text
Result/Review next action requires payment
-> /access?module=public-service-rules&returnTo=/modules/public-service-rules
```

### Direct Access Page

```text
/access
```

Default state:

```text
Scope: One module
Module: none selected
Length: 1 month
CTA: Choose a module
```

## Target Page Structure

The `/access` page should become the full purchase surface.

Recommended order:

```text
Access

Access status
Buy access
Unlocked modules
Payment attention
Payment history
```

The main buying area should be a simple form:

```text
Buy access

Scope
One module    Pick 3    Complete

Module
Public Financial Management        ₦2,500
Public Service Rules               ₦2,500
Oral Interview                     ₦3,500

Length
1 month
3 months
6 months

Total
₦2,500

[Continue to Paystack]
```

## Desktop Layout

Desktop may use two columns, but should remain restrained.

```text
Access

1 of 9 unlocked

------------------------------------------------------

Buy access                              Order summary

Scope                                   One module
One module | Pick 3 | Complete          Public Financial Management

Module                                  1 month
Public Financial Management
Public Service Rules                    Total
Oral Interview                          ₦2,500

Length                                  [Continue to Paystack]
1 month
3 months
6 months
```

The right summary should be sticky only when helpful. It should not look like a
floating marketing card. It is a checkout summary, not a promotion panel.

## Mobile Layout

Mobile is the source of truth.

```text
Access

1 of 9 unlocked

Buy access

Scope
One module
Pick 3
Complete

Module
Public Financial Management
Public Service Rules
Oral Interview

Length
1 month
3 months
6 months

[sticky bottom]
₦2,500
Public Financial Management - 1 month
[Pay]
```

The sticky bottom action should stay compact and avoid jumping height when CTA
text changes.

## Visual Direction

The access page should feel like:

- a government-service payment page
- a clean exam utility
- a serious access-management screen

It should not feel like:

- a SaaS pricing page
- a marketplace
- a fintech dashboard
- a promotional landing page

Use:

- simple rows
- segmented controls where helpful
- radio-style module rows
- clear selected states
- one payment CTA
- restrained green emphasis
- thin dividers
- compact status labels

Avoid:

- card walls
- long plan descriptions
- large feature lists
- repeated headings
- nested cards
- decorative icons
- hype badges
- modal checkout

## Copy Direction

Keep copy short and functional.

Good:

```text
Access
1 of 9 unlocked

Buy access
Choose scope, module, and length.

Access starts after payment is verified.
```

Avoid:

```text
Choose a module, bundle, and access length before payment.
Unlock your premium learning journey.
Best value for serious candidates.
```

Use "access" and "practice" language. Avoid unnecessary plan language.

## Access Scope Behavior

### One Module

User chooses one available module.

Rules:

- Objective module uses `individual_objective`.
- Oral module uses `individual_oral`.
- Duration prices update after module selection.
- If no module is selected, CTA says `Choose a module`.

Display:

```text
Public Financial Management        ₦2,500
Public Service Rules               ₦2,500
Oral Interview                     ₦3,500
```

### Pick 3

User chooses exactly three available modules.

Rules:

- The UI prevents selecting a fourth module.
- The CTA explains missing count.
- Backend still enforces exactly three distinct eligible modules.

CTA examples:

```text
Select 2 more
Select 1 more
Continue to Paystack
```

### Complete

User does not manually select modules.

Rules:

- Backend resolves included modules at checkout.
- UI may display currently included modules for clarity.
- Copy must not imply future modules are included.

Good:

```text
All modules currently available at purchase.
```

Avoid:

```text
All current and future modules.
```

## Entry Parameters

The access page should support query parameters:

```text
/access?module=public-service-rules
/access?module=public-service-rules&returnTo=/modules/public-service-rules
/access?scope=pick3
/access?scope=complete
```

Recommended behavior:

- `module` preselects One module when valid.
- `scope` preselects scope when valid.
- `returnTo` is sanitized and preserved through payment initialization and
  verification where possible.

Invalid query values should fail softly and fall back to default state.

## Dashboard Integration

Dashboard should stop opening `AccessPlanModal` for purchase.

Replace:

```text
open AccessPlanModal
```

with:

```text
navigate("/access?module=<subject-slug>")
```

Dashboard remains responsible for:

- module discovery
- starting free practice
- showing locked/unlocked state
- routing to access when payment is needed

Dashboard should not own:

- duration selection
- bundle selection
- payment summary
- Paystack CTA

## Practice, Module, Result, And Review Integration

Any locked state should route to `/access`.

Examples:

```text
/access?module=public-service-rules&returnTo=/modules/public-service-rules
/access?module=public-service-rules&returnTo=/review
/access?module=public-service-rules&returnTo=/dashboard
```

The locked page/state should not open a payment modal.

The rule:

```text
If payment is required, route to /access with intent.
```

## Payment Verification Return

Payment verification should support returning the user to the right place after
successful access activation.

Preferred order:

1. Safe `returnTo` from the payment/access flow.
2. Purchased module page.
3. Dashboard.

The app must not trust payment redirect params as proof of payment. Verification
remains server-side.

## Error And Edge States

### Catalog Load Failure

Show access status if available and a retry action for pricing.

```text
Access options could not be loaded.
Try again.
```

### Plan Unavailable

Disable the relevant scope and show a short reason.

```text
Not available right now.
```

### Module No Longer Available

Remove or disable the module row.

```text
This module is not open for purchase.
```

### Price Changed

Reload the pricing catalog and ask the user to continue again.

```text
Price changed. Review the amount and continue again.
```

### Payment Initialization Failure

Keep the user's selections.

```text
Payment could not start. Try again.
```

### Already Paid

Refresh access state and route to the relevant module/dashboard.

## Component Plan

Create or refactor toward:

```text
src/components/access/AccessPurchasePanel.jsx
src/components/access/AccessScopeControl.jsx
src/components/access/AccessModuleSelector.jsx
src/components/access/AccessDurationSelector.jsx
src/components/access/AccessOrderSummary.jsx
```

Keep:

```text
src/lib/pricingPlans.js
```

Move pure choice logic into helpers, not JSX.

`AccessPlanModal.jsx` should either be removed later or reduced to a
non-purchase confirmation component if still needed elsewhere.

## Suggested State Model

```js
{
  scope: "one" | "pick3" | "complete",
  selectedModuleSlugs: [],
  durationMonths: 1,
  returnTo: "",
  paymentError: ""
}
```

Derived state:

- active backend plan code
- selected duration price
- required module count
- checkout payload
- CTA copy
- eligible modules
- selected module labels

## Checkout Payload

The page should continue to submit the backend-compatible payload:

```js
{
  planCode,
  durationMonths,
  subjectSlugs,
  expectedPriceKobo
}
```

For Complete:

```js
subjectSlugs: []
```

The backend resolves the included module list.

## Implementation Sequence

### Phase 1: Access Page Builder

- Add page-level purchase panel to `Access.jsx`.
- Use existing pricing catalog and module access catalog.
- Support One module, Pick 3, Complete.
- Support duration selection.
- Support order summary.
- Keep current payment history below.

### Phase 2: Remove Modal Entry From Access Page

- Stop rendering pricing plan cards that open `AccessPlanModal`.
- Replace with the inline purchase builder.

### Phase 3: Dashboard Routing

- Replace dashboard purchase modal with navigation to `/access?module=...`.
- Preserve free practice confirmation modal.

### Phase 4: Locked State Routing

- Update practice/module/result/review locked actions to route to `/access` with
  module and return intent.

### Phase 5: Payment Return

- Preserve safe return target through payment initialization and verification,
  or fall back to module/dashboard.

### Phase 6: Cleanup

- Remove or shrink `AccessPlanModal`.
- Delete obsolete modal CSS.
- Update unit tests and e2e flows.
- Ensure no fixed-date or old pricing copy remains visible.

## Test Plan

### Unit Tests

- One objective module maps to `individual_objective`.
- One oral module maps to `individual_oral`.
- Direct `/access?module=x` preselects the module.
- Pick 3 prevents more than 3 selected modules.
- Complete submits no module slugs.
- CTA says `Choose a module` when needed.
- CTA says `Select 2 more` for incomplete Pick 3.
- CTA includes current price when valid.

### E2E Tests

- Dashboard `Unlock module` routes to preselected access page.
- Locked batch routes to access page with module intent.
- One objective module checkout reaches Paystack mock.
- One oral module checkout reaches Paystack mock.
- Pick 3 checkout reaches Paystack mock.
- Complete checkout reaches Paystack mock.
- Payment success returns to the relevant module or dashboard.
- Mobile sticky payment action is visible and not overlapping content.

### Visual Checks

- Desktop has no modal checkout.
- Mobile has no long purchase modal.
- Access page has no card wall.
- Text does not overflow selection rows.
- Sticky bottom action does not cover final content.

## Final Direction

The access purchase experience should be:

```text
select scope
select module(s)
select length
pay
```

It should live on `/access`.

The dashboard, practice, result, and review pages should send users there with
intent. They should not own purchase UI.

The modal should stop being the checkout architecture.

