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

Module lifecycle, candidate availability, and sales availability are separate controls:

- `Draft`: private to administrators.
- `Coming soon`, `Available`, `Paused`, and `Hidden` control what candidates can see or start.
- `Available for purchase` controls new sales only.
- `Retired` permanently closes the module to new practice and sales while preserving existing access and history.

`Available for purchase` controls new sales only. Turning it off does not remove existing access, receipts, attempts, or reviews. Changing a price affects future purchases only.

## Practice Set Workflow

Practice-set numbers are assigned automatically within a module. The normal lifecycle is:

```text
Draft <-> In review -> Published -> Withdrawn -> Published
                                  \-> Retired
```

- `Draft`: questions can be added, edited, deleted, or imported.
- `In review`: the complete set is ready for final checking and can still be returned to draft.
- `Published`: candidates can start it. Existing questions are no longer edited in place.
- `Withdrawn`: temporarily unavailable for new attempts. It can be republished only with unchanged content.
- `Retired`: permanently unavailable for new attempts and retained for historical reviews.

Before a set can enter review or publish, the server checks:

- the exact expected question count
- valid and non-repeated question positions
- four distinct, non-empty answer options
- a valid correct answer
- optional explanation and reference fields that remain valid when supplied
- no duplicate question text in the set

Publishing the first valid set makes candidate practice available, but it does not start sales. After publication, open module settings and explicitly enable `Available for purchase` when the commercial details have been checked. Withdrawing or retiring a set never deletes entitlements, attempts, answers, scores, or reviews.

## Question Workflow

For unpublished sets, use `Add question` or edit an existing draft question. The focused editor replaces the question list while a record is being changed. Select the correct answer using the letter beside the option, and include an explanation before publication. Difficulty and source metadata are under `Additional details`.

Published questions are immutable. Correct them through a complete replacement set:

1. Select `Create corrected replacement` on the live set.
2. Copy the existing questions or begin with an empty replacement draft.
3. Correct or re-import the full set and send it through review.
4. Publish the replacement to atomically retire the old version and switch new attempts to the new version.

Historical attempts continue to reference the exact practice-set and question versions originally answered. A replacement never rewrites an old result or answer review.

If a numbered set was already retired, use `Add practice set` and choose `New version of Practice set N`, or open the latest retired version and select `Create new version`. This creates a separate draft in the same numbered slot. Choosing `New Practice set N+1` creates a genuinely new slot instead.

Retired versions are hidden from the main practice-set list by default. Select `Show retired history` only when inspecting old versions, attempts, or lineage; hiding history never deletes those records or prevents an eligible retired slot from appearing in `Add practice set`.

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

Choose an import intent before selecting the file:

- `Validate only` checks the complete file and performs no database write.
- `Append` keeps existing questions and adds the imported rows.
- `Replace all` atomically replaces every question in a draft or review set.

The browser shows current, imported, and final counts. The database validates write operations again and saves the whole import in one transaction. If one row conflicts or fails, the original set remains unchanged.

## Withdraw, Retire, Or Delete

Permanent deletion is deliberately narrow:

- An unused module can be deleted only before it has content, payments, access grants, or attempts.
- An empty draft practice set can be deleted.
- An unused draft or review question can be deleted.
- Published or historically used content is retired, never hard-deleted.

Withdraw only when unchanged content may return. Retire permanently when it must not return, and create a replacement when content needs correction. Stop sales independently when only new purchases should end.

## Audit Trail

The `Activity` view records recent content changes and the administrator responsible for them. Database audit rows are the source of truth; the browser does not manufacture audit records.

## Deployment Checklist

The redesigned lifecycle additionally depends on `20260718083101_add_withdrawn_practice_set_status.sql` followed by `20260718083102_admin_content_lifecycle_redesign.sql`. The enum migration must commit before the redesign migration uses the new value. Before using it on a hosted project:

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
- Pausing candidate availability or stopping sales does not alter existing entitlements.
- If published content is wrong, create a replacement set instead of republishing, deleting, or directly editing it.
- If an admin loses access, verify the profile role from the Supabase SQL editor rather than weakening the route guard.
