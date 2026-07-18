# Admin Content Lifecycle Specification

## Purpose

This specification separates temporary candidate unavailability from permanent historical retirement. It applies to objective and oral practice sets, candidate attempts, module availability, sales availability, imports, replacements, and audit history.

## Current-state audit

Before this redesign, practice sets used `draft`, `review`, `published`, and `archived`. The database transition RPC allowed a published set to move only to `archived`, archived every question in the set, and explicitly rejected reopening. The admin interface exposed that operation as **Archive set**, did not explain that it was permanent, and offered no withdrawal or whole-set replacement workflow.

Objective attempts were created only at submission. Their answers referenced question IDs, but submission required those question rows to still be `published`. An admin archive during a browser-based attempt could therefore reject a valid submission. Completed objective reviews remained tied to live question rows, making published-row immutability essential. Oral attempts were safer: they already referenced a practice-set ID and stored question/model-answer snapshots in `oral_responses`.

Module lifecycle and visibility were coupled through `subjects.is_active` and `subjects.lifecycle_status`. Sales were stored separately in `module_offerings.is_active`, but the admin form changed lifecycle and sales together. Entitlements were separate rows and were not deleted by content operations.

## Practice-set state machine

| State | New attempts | Content edits | Permitted admin actions | Historical behavior |
| --- | --- | --- | --- | --- |
| Draft | No | Yes | Edit, append, replace all, validate, review, delete if unused | No published history |
| In review | No | Yes | Edit, append, replace all, validate, return to draft, publish, delete if unused | No published history |
| Published | Yes | No | View, withdraw, create replacement, retire | Existing sessions and reviews remain pinned |
| Withdrawn | No | No | View, republish unchanged, create replacement, retire | Existing sessions can finish; reviews remain available |
| Retired (`archived` in the compatibility enum) | No | No | View, inspect replacement, audit | Permanent historical version; no normal reopening |

Allowed transitions:

```text
draft <-> review -> published
published <-> withdrawn
published -> retired
withdrawn -> retired
published/withdrawn -> replacement draft -> review -> publish replacement
```

Publishing a replacement locks the logical slot, validates both versions, retires the source, publishes the replacement, links both rows, and writes the audit event in one transaction. A partial unique index permits only one published version for an exam pack, module, set number, and practice type.

## Version and history model

Each practice set has a `logical_set_key` and positive `version_number`. Replacement rows share the logical key and increment the version. `replaces_practice_set_id` and `replaced_by_practice_set_id` provide explicit lineage. `ever_published`, `first_published_at`, `withdrawn_at`, `retired_at`, and `retirement_reason` preserve lifecycle facts.

Published objective and oral question content is immutable. Status-only lifecycle changes remain possible, while edits to question text, options, correct answers, explanations, model answers, key points, position, or practice-set ownership are rejected. Retired question rows remain available to answer/review relationships.

Objective practice now creates an `objective_practice_sessions` allocation before the timer starts. It stores the exact practice-set version and ordered question IDs. Submission grades those IDs even if the set became withdrawn or retired after allocation, then writes `attempts.practice_set_id`. Existing pre-deployment browser drafts retain a compatibility submission path.

Oral attempts already store `practice_set_id` and response snapshots. Their start RPC now resumes an existing active attempt before applying current module/set availability to a new attempt.

## Authoritative capabilities

`admin_get_practice_set_capabilities` is the server authority for edit, import, transition, withdrawal, republish, replacement, retirement, and deletion actions. It also returns question, attempt, in-progress, and completed counts plus structured blockers and warnings. The admin interface renders actions from these values; each mutation RPC independently validates the same rules.

Permanent deletion is limited to draft/review sets that were never published, have no attempts or active allocations, and are not a historical replacement source. The server returns the first safe blocking reason when deletion is denied.

## Import behavior

- **Validate only** parses and checks the file without a database write.
- **Append** inserts into draft/review content and rejects position, text, checksum, and target-count conflicts.
- **Replace all** is draft/review only. It deletes editable rows and imports the complete replacement in one database transaction. Any validation or insert failure rolls the deletion back.

The preview shows current, imported, and expected final counts. Published, withdrawn, and retired versions cannot be imported into or replaced.

## Module controls

Module concepts are independent:

| Concept | Storage | Meaning |
| --- | --- | --- |
| Lifecycle | `subjects.lifecycle_status` | Draft, active, or permanently retired product |
| Candidate availability | `subjects.candidate_availability` | Hidden, coming soon, available, or paused for new attempts |
| Sales availability | `module_offerings.is_active` | Whether new purchases can be initialized |
| Set availability | `practice_sets.status` | Which individual version can start a new attempt |

Pausing candidate practice and stopping sales never update or delete `entitlements` or `module_entitlements`. Existing objective allocations and active oral attempts can finish. Candidate screens describe pause as content maintenance, not payment failure.

## Compatibility and rollout

The migration is additive. Existing `archived` rows are treated as retired, existing attempts are backfilled to a practice-set ID from their answer rows where possible, and existing question/answer relationships remain intact. The old enum name and archived question status are retained for compatibility; admins see the term **Retired**.

Deploy both lifecycle migrations in order. The first commits the `withdrawn` enum value; the second uses it. Deploy the web client only after both migrations are active because it calls the v3 admin RPCs and pinned objective-session RPCs.

Do not run the recovery script as a normal deployment migration. Inspect aggregates first, then use it only for a specifically identified pre-redesign archived set with zero attempts and no references.

## Archived-set recovery inspection (2026-07-18)

The linked production project was inspected read-only with aggregate queries. No remote writes were made and no candidate identity or answer content was returned.

The only archived practice set is objective set 1 in **Public Financial Management (Financial Regulations)** (`8daee506-14f7-4a62-b7c9-4242518b2d85`). Its module remains active. The set contains 45 archived question rows and is referenced by 22 completed attempts through 260 attempt-answer rows. There are no in-progress database attempts and no other practice-set row currently occupying the same module/set slot. Eleven active entitlement rows apply to the module or legacy pack.

This set must not be reopened or edited. Its existing questions are historical grading records. The safe recovery is to deploy the lifecycle redesign, run the guarded `supabase/recovery/create_replacement_for_historical_retired_set.sql` command in rollback mode, inspect its empty replacement draft, and rerun it with an approved administrator ID and `COMMIT`. Then import the corrected 45-question file with **Replace all**, send it to review, and publish the replacement. The old version remains retired for the 22 completed attempts and their reviews.

`supabase/recovery/recover_pre_redesign_archived_set.sql` is therefore **not safe for this set** and must not be run against it. That guarded script is retained only for a different pre-redesign archived set that passes all zero-history checks.
