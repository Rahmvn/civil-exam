# Admin-Configurable Access Durations

## Current Catalogue

PromotionSure currently sells 1, 2, and 3 calendar months of access. The
historical 6-month duration remains stored but disabled for new checkout.

Initial future-purchase prices are:

| Plan | 1 month | 2 months | 3 months |
| --- | ---: | ---: | ---: |
| Objective Module | NGN 2,500 | NGN 4,500 | NGN 6,500 |
| Oral Module | NGN 3,500 | NGN 6,500 | NGN 9,000 |
| 3-Module Bundle | NGN 6,000 | NGN 11,000 | NGN 15,500 |
| Complete Bundle at the current 11 modules | NGN 16,500 | NGN 31,000 | NGN 43,000 |

## Authority And History

`purchase_durations` is the server-authoritative list of durations available
for future checkout. Admin can add positive whole-month durations, change their
display order, configure each enabled plan price, and enable or disable them.
Durations are disabled rather than deleted, and their month value is immutable
after creation.

`payment_orders.duration_months`, `amount_kobo`, `currency`,
`purchase_snapshot`, and `payment_order_items` remain the immutable purchase
history. Catalogue edits never reprice or reinterpret an existing order,
receipt, entitlement, or pending checkout. Historical 3-month and 6-month
orders continue through verification and fulfillment from their snapshots.

## Calendar-Month Access

Fulfillment adds PostgreSQL calendar months, not fixed 30-day periods. For each
module, the base is the later of activation time and its current active expiry.
Bundle modules are extended independently, so differing existing expiries stay
different after the same purchased duration is added.

## Complete Bundle

Complete Bundle still includes every module purchasable when checkout begins.
The module set and final clean NGN amount are snapshotted on the order; modules
added later are not granted to that historical purchase. Each duration stores a
server-side dynamic pricing rule. Admin edits the clean total for the current
module count, and the backend resolves future counts using that rule and the
configured rounding increment.

The current count of 11 is descriptive, not pricing authority. Both catalogue
display and checkout count the modules currently purchasable from server data,
so adding or removing modules automatically recalculates the Complete Bundle.

## Savings

When savings are displayed, the backend compares the configured duration price
with the current one-month price for the same plan multiplied by the number of
months. Duration-specific savings labels and percentages are not commercial
authority.
