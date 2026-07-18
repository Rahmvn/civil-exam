# Admin Content Lifecycle Implementation Report

## Audit summary

The previous lifecycle was `draft -> review -> published -> archived`. Archive changed the set and its questions to a historical state, could not be reversed, and was the only visible way to remove live content. This made archive look temporary even though the database treated it as permanent. There was no safe whole-set correction path.

Objective attempts were not persisted until submission. A browser attempt therefore held live question IDs while the submission RPC still required those rows to be published. Archiving during an attempt could reject submission. Completed objective reviews referenced immutable question rows through `attempt_answers`; oral attempts already pinned `practice_set_id` and stored response snapshots.

The redesign adds temporary withdrawal, immutable published versions, atomic corrected replacements, pre-start objective allocations, separate module controls, transactional import intent, authoritative capabilities, and guarded historical recovery.

## Lifecycle matrix

| Set state | New attempts | Editable | Main actions | Historical behavior |
| --- | --- | --- | --- | --- |
| Draft | No | Yes | Edit, validate, append, replace all, review, delete if unused | No published history |
| Review | No | Yes | Edit, validate, append, replace all, draft, publish, delete if unused | No published history |
| Published | Yes | No | View, withdraw, replace, retire | Existing allocations and reviews remain pinned |
| Withdrawn | No | No | View, republish unchanged, replace, retire | Existing allocations finish; reviews remain available |
| Retired | No | No | View, export/audit, open replacement | Permanent historical record |

| Module control | Values | Effect on entitlements/history |
| --- | --- | --- |
| Lifecycle | Draft, active, retired | Retirement hides content and stops sales; rows remain intact |
| Candidate availability | Hidden, coming soon, available, paused | Controls new starts only |
| Sales availability | On or off | Controls new purchases only |
| Set availability | Per-set lifecycle | Controls which version starts new work |

## Database changes

Migrations:

- `20260718083101_add_withdrawn_practice_set_status.sql` commits the new enum value separately.
- `20260718083102_admin_content_lifecycle_redesign.sql` adds versioning, capabilities, sessions, module controls, constraints, indexes, triggers, and RPCs.

Important schema changes:

- `practice_sets`: logical key, version, replacement links, publication facts, withdrawal/retirement timestamps and reason, and exact withdrawn question IDs.
- `attempts.practice_set_id`: backfilled from historical answer relationships where possible.
- `objective_practice_sessions`: exact set version and ordered question IDs allocated before practice starts.
- `subjects.candidate_availability`: separates candidate startability from lifecycle and sales.
- Partial unique indexes enforce one published version per product slot and one pending replacement per logical set.
- Published objective and oral content triggers reject content mutation or deletion while allowing lifecycle-only status changes.
- Direct authenticated question/practice-set mutations are revoked; protected changes use admin RPCs.

New or redesigned operations include capabilities, withdraw, unchanged republish, retire, create/publish replacement, transactional replace-all, unused-draft deletion, module lifecycle/availability/sales updates, v3 admin queries, objective session start/submission, oral resume behavior, and retired-set inspection. Lifecycle operations write existing admin audit records with status, lineage, reason, counts, and import metadata where applicable.

## UI and candidate protection

The admin workspace now renders actions from server capabilities and uses the terms **Withdraw temporarily**, **Republish unchanged**, **Create corrected replacement**, **Retire permanently**, and **Delete unused draft**. Confirmation dialogs explain effects on new starts, in-progress attempts, completed results, and history. Retirement requires a reason; replacement creation offers copy-existing or start-empty.

Imports explicitly support Validate only, Append, and Replace all. The preview shows current, imported, and final counts. Mode changes invalidate the prior preview, and Replace all uses one database transaction.

Candidate objective practice is allocated to an immutable set version before the timer starts. Withdrawal or replacement cannot switch that allocation, and submission grades its original question IDs. Completed attempts keep their set ID, answer IDs, answer order, score, scoring basis, and review data. Oral attempts resume before current availability checks and retain their existing snapshots. Pausing practice or stopping sales does not update entitlement rows.

Candidate pages distinguish paused maintenance from payment/access failures. New attempts select only published current versions; withdrawn and retired versions are excluded.

## Important changed files

- `src/pages/Admin.jsx` and `src/components/admin/*`: capability-driven lifecycle actions, confirmations, module controls, import modes, and operator guidance.
- `src/lib/appApi.js` and `src/lib/adminContent.js`: v3 RPC integration, pinned objective submission, action/impact helpers.
- `src/pages/Dashboard.jsx`, `ModuleDetail.jsx`, `PracticeStart.jsx`, and `Practice.jsx`: candidate availability and pinned-session behavior.
- `supabase/migrations/20260718083101_*` and `20260718083102_*`: database lifecycle implementation.
- `supabase/tests/admin_content_lifecycle_test.sql`: 40 pgTAP assertions for transitions, rollback, authorization, history, and entitlements.
- `tests/unit/admin-content.test.js` and `tests/e2e/admin.spec.js`: action/import coverage and the archive-trap replacement flow.
- `docs/ADMIN_CONTENT_LIFECYCLE_SPEC.md` and `docs/ADMIN_CONTENT_MANAGEMENT.md`: design matrix and operator instructions.
- `supabase/recovery/*.sql`: separate zero-history reopen and historical replacement procedures, both rollback by default.

## Archived-set recovery

The linked project was inspected read-only on 2026-07-18. No remote writes or candidate identities were returned.

The affected retired set is Public Financial Management (Financial Regulations), objective set 1, ID `8daee506-14f7-4a62-b7c9-4242518b2d85`. It has 45 retired question rows, 22 completed attempts, 260 historical answer references, no in-progress database attempt, 11 applicable active entitlement rows, and no competing set in the same slot.

Reopening is unsafe. After deployment and backup, use `supabase/recovery/create_replacement_for_historical_retired_set.sql` in rollback mode first. With an approved admin ID, create an empty replacement, import the corrected 45 questions using Replace all, review, and publish the replacement. Keep the original retired forever. Do not run `recover_pre_redesign_archived_set.sql` for this set because that procedure requires zero history.

## Verification

Executed successfully:

- `npm run lint`: passed.
- `npm run build`: passed; Vite reported only the existing large-chunk warning.
- `npm run test:unit`: 64 passed, 0 failed.
- `npm run test:security`: tracked-secret scan passed across 440 files; `npm audit --audit-level=high` reported 0 vulnerabilities.
- `git diff --check`: passed; only line-ending conversion notices were reported.

Authored but not executable in the current environment:

- `npm run test:db`: blocked because local PostgreSQL/Supabase is unavailable.
- `npm run test:e2e -- --grep admin`: blocked because local Supabase is unavailable.
- `npm run test:edge` and `npm run test:edge:compat`: blocked because local Supabase is unavailable.
- `npm run test:operator-access`: blocked because operator-access configuration is not present.

`supabase start` was attempted and could not connect to Docker Desktop. These suites have not passed and must be run after Docker Desktop is available.

## Deployment status

All implementation is local. No migration, function, Edge Function, frontend build, or recovery command was deployed remotely, and no production data was changed.

Before production:

1. Start Docker Desktop and run database, Edge, targeted admin/candidate E2E, and existing submission/recovery suites.
2. Back up the hosted database and review the migration SQL and pgTAP results.
3. Deploy the two migrations in order, then deploy the web client.
4. Smoke-test draft/review/publish, withdraw/republish, replacement publication, objective and oral resume, historical review, module pause, and sales-off behavior with non-production fixtures.
5. Run the historical replacement recovery only in a separately approved operator session, first with its default rollback.

Do not unarchive or edit the affected historical set, deploy the client before its RPC migrations, or run either recovery command without backup, aggregate verification, and explicit production approval.
