# Admin Content Management

## Purpose

PromotionSure includes a protected content manager for maintaining modules, practice sets, and questions without editing database rows by hand.

The admin journey is:

```text
Normal sign-in -> /admin -> Content -> Module -> Practice set -> Questions -> Review checks -> Publish
```

There is no separate admin password form. Administrators use the normal PromotionSure sign-in page. The application and database both verify the signed-in profile's `admin` role before allowing access.

## Granting Admin Access

Only a trusted database owner should grant the first admin role. In the Supabase SQL editor, verify the account email and then update that one profile:

```sql
select id, email, full_name, role
from public.profiles
where email = 'owner@example.com';

update public.profiles
set role = 'admin'
where email = 'owner@example.com';
```

Sign out and sign in again after changing the role. The administrator can then open `/admin` directly. A non-admin who visits `/admin` is returned to the dashboard, and admin database functions independently reject the request.

Do not put the Supabase secret key or service-role key in the browser. Do not grant admin access from a public form.

## Module Workflow

The Content catalogue shows every module in the current examination edition, including private drafts. It is designed as an operational register rather than a marketing dashboard: search and status filters come first, while internal slugs and historical question-record totals stay out of the default view.

Durable workspace URLs are used so an administrator can safely bookmark or return to a specific area:

```text
/admin
/admin/activity
/admin/modules/:module-id
/admin/modules/:module-id/sets/:set-id
```

1. Select `Create module`.
2. Enter the module name, price, expected questions per practice set, and pass mark. Display order is under `Advanced`.
3. Keep unfinished content as `Draft`.
4. Use `Coming soon` only when candidates should see the module before its content is available.
5. Create and publish at least one complete practice set before making a module active.

Module states:

- `Draft`: private to administrators.
- `Coming soon`: visible to candidates but not startable or purchasable.
- `Active`: contains published practice and may be offered for purchase.
- `Retired`: no longer part of the active catalogue. Retirement is blocked while users still have active access.

`Available for purchase` controls new sales only. Turning it off does not remove existing access, receipts, attempts, or reviews. Changing a price affects future purchases only.

## Practice Set Workflow

Practice-set numbers are assigned automatically within a module. The normal lifecycle is:

```text
Draft -> In review -> Published -> Archived
```

- `Draft`: questions can be added, edited, deleted, or imported.
- `In review`: the complete set is ready for final checking and can still be returned to draft.
- `Published`: candidates can start it. Existing questions are no longer edited in place.
- `Archived`: unavailable for new attempts, but retained for historical reviews.

Before a set can enter review or publish, the server checks:

- the exact expected question count
- valid and non-repeated question positions
- four distinct, non-empty answer options
- a valid correct answer
- an explanation for every question
- no duplicate question text in the set

Publishing the first valid set activates its module content, but it does not start sales. After publication, open module settings and explicitly enable `Available for purchase` when the commercial details have been checked. Archiving the final published set stops new sales and leaves the module in `Coming soon` rather than deleting it.

## Question Workflow

For unpublished sets, use `Add question` or edit an existing draft question. The focused editor replaces the question list while a record is being changed. Select the correct answer using the letter beside the option, and include an explanation before publication. Difficulty and source metadata are under `Additional details`.

Published questions use correction revisions:

1. Select `Correct` on the live question.
2. Edit and save the correction.
3. Preview it and select `Publish correction` only after checking it.
4. PromotionSure archives the previous version and publishes the correction in one transaction.

Historical attempts continue to reference the exact question version originally answered. A correction never rewrites an old result or answer review.

## CSV, Excel, And JSON Import

Bulk upload is the primary way to add a prepared question set and is available only for draft or review sets. Use `Upload questions` from the practice-set header. Download the CSV template rather than creating column names from memory; `.xlsx` spreadsheets using the same headings are also accepted. JSON remains available for technical workflows.

Accepted fields are:

```text
position
question_text
option_a
option_b
option_c
option_d
correct_answer
explanation
reference
difficulty
```

JSON accepts the equivalent internal names, including `batch_position`, `correct_option`, and `reference_note`.

The browser previews and validates the complete file first. The database validates it again and saves the whole import in one transaction. If one row conflicts or fails, no rows from that import are saved. Successful imports record the filename and SHA-256 checksum in the audit log, and the same file cannot be replayed into one practice set.

## Archive Versus Delete

Permanent deletion is deliberately narrow:

- An unused module can be deleted only before it has content, payments, access grants, or attempts.
- An empty draft practice set can be deleted.
- An unused draft or review question can be deleted.
- Published or historically used content is archived, never hard-deleted.

When uncertain, archive or stop new sales. This preserves receipts, attempts, score calculations, and answer reviews.

## Audit Trail

The `Activity` view records recent content changes and the administrator responsible for them. Database audit rows are the source of truth; the browser does not manufacture audit records.

## Deployment Checklist

The admin interface depends on `20260714160000_admin_content_management.sql` and the count correction in `20260714190000_fix_admin_practice_set_counts.sql`. Before using it on a hosted project:

1. Back up the hosted database.
2. Apply the migration through the normal Supabase migration process.
3. Run `npm run test:db` against local Supabase.
4. Run `npm run lint` and `npm run build`.
5. Grant the first trusted administrator through the SQL editor.
6. Sign in normally and verify `/admin` with a private draft before publishing real content.

Never test destructive admin actions against production content. Use a new private draft module for the first hosted verification.

## Recovery Rules

- If an import fails, correct the displayed rows and import again; partial rows were not saved.
- If a set cannot publish, resolve every item in its publication check.
- If a module cannot retire, stop new sales and allow existing access to expire.
- If a published question is wrong, create a correction instead of trying to delete or directly edit it.
- If an admin loses access, verify the profile role from the Supabase SQL editor rather than weakening the route guard.
