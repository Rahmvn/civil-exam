# Practice Set Access And Progression Policy

## Presentation Rule

The database continues to use `batch` and `batch_number`. The interface uses `Practice set N` only when an individual set must be identified. Normal navigation remains module-first.

## Access Scope

Access is module-specific, not account-wide.

- Modules are shared nationally and are not filtered by organization.
- Users choose modules for themselves; the product does not recommend subjects.
- A module purchase unlocks only the selected module in the active exam edition.
- A user may purchase any available module, including one they have not tried for free.
- A user may own multiple modules independently.
- An unlocked module includes every practice set published for it during the entitlement period.
- Existing legacy pack-wide entitlements remain valid for every module until their original expiry.

## Free Practice

1. A new user may choose exactly one module for free practice.
2. The choice is fixed only after explicit confirmation and practice start.
3. Only Practice Set 1 of the chosen module is free.
4. If the first attempt fails, one free retry is available.
5. Passing the free set ends the free allowance and returns `unlock_module`.
6. Completing the free retry ends the free allowance and returns `unlock_module`.
7. The selected free module does not restrict which modules the user may purchase.
8. Purchasing another module does not remove or expand the original free allowance.

## Unlocked Module

Within an unlocked module:

- every published practice set is startable
- retries are unrestricted
- progress recommends the nearest sensible practice set
- users may deliberately choose another published set
- unpublished sets remain unavailable
- completing one module never causes the product to recommend another module

## Progression

Progression guidance applies only within a module.

1. Recommend a valid failed set for retry when appropriate.
2. Otherwise recommend the earliest published set not yet passed.
3. Ignore unpublished gaps.
4. Passing a later set does not mark an earlier set complete.
5. A module is complete only when every currently published set has been passed.
6. After module completion, return to the module catalogue without recommending a subject.

## Backend Source Of Truth

Authorization must be decided by the backend using the active exam pack and requested subject.

Primary functions:

- `has_active_module_entitlement(pack_id, subject_id)`
- `get_batch_access_state(subject_slug, batch_number)`
- `get_module_batch_access(subject_slug?)`
- `resolve_practice_batch_context(...)`
- `start_practice_batch(subject_slug, batch_number?)`
- `submit_attempt(...)`

The existing `is_paid` and `has_paid_access` response fields are transitional compatibility names. In practice-set responses, `is_paid` means the requested module is unlocked. Frontend code must not use an account-wide paid flag to authorize a module.

## Access States

- `available`
- `completed_passed`
- `completed_failed`
- `locked_requires_payment`
- `unavailable_not_published`

Important reason codes:

- `paid_access`: the requested module is unlocked
- `free_batch_available`: the user may select this module for free
- `free_retry_available`: the selected free set may be retried once
- `free_batch_passed_requires_payment`: unlock this module to continue
- `free_retry_used_requires_payment`: unlock this module to continue
- `free_different_module_requires_payment`: the free choice belongs to another module
- `free_next_batch_requires_payment`: later sets require this module to be unlocked
- `not_published`
- `no_questions`
- `unauthenticated`

## Result Actions

Free practice:

- first failed attempt => `retry_free_batch`
- passed attempt => `unlock_module`
- failed retry => `unlock_module`

Unlocked module:

- passed with another unfinished published set => `next_batch`
- passed with every published set complete => `module_complete`
- failed with another published set => `retry_or_next`
- failed without another published set => `review_only`

## Review Policy

Users retain access to their own submitted attempt reviews regardless of current module entitlement. Starting or retrying a practice set still requires current authorization.

## Payment Policy

- Prices are read from server-managed `module_offerings`.
- The browser never supplies a trusted amount or currency.
- A `payment_orders` row is created before Paystack initialization.
- Verification must match reference, user, module, amount, currency and metadata.
- Successful verification atomically creates one `module_entitlements` grant.
- Callback verification and Paystack webhooks are idempotent.
- Receipts identify the purchased module.

## UI Language

Free practice is an optional trial, not a prerequisite for payment. Before a
free module is selected, every purchasable module must expose both `Try free`
and `Unlock module`. After the free choice is assigned, its card may show
`Continue practice` or `Retry practice` alongside `Unlock module`; other locked
modules remain directly purchasable.

Use:

- `Free practice available`
- `Try free`
- `Unlock module`
- `Unlocked`
- `Module access`
- `Practice set N`

Do not use `Full access` for new module purchases. Do not imply that purchasing
one module unlocks another or that a user must complete free practice before
paying.
