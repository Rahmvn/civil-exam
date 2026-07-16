# Batch Content Runbook

## 1. Purpose

This runbook defines the standard repeatable workflow for future content batches in PromotionSure.

Public Financial Management Batch 1 proved that the full lifecycle works:

- cleaned batch preparation
- answer-key verification
- importer compatibility checking
- local draft import
- local candidate-flow simulation
- remote draft import
- controlled publish

Future batches should follow this runbook instead of relying on custom prompts each time.

This runbook does not itself import, publish, or mutate production data.

---

## 2. Standard Batch Lifecycle

### Stage A - Prepare Cleaned Batch File

Input:

- `contents/converted/{subject}.review.json`

Output:

- `contents/import-ready/{subject}.batch{n}.cleaned.json`

Rules:

- select only the requested batch
- add concise explanations
- keep `status: "draft"`
- keep `needs_review: true` until verification is complete
- fix only obvious spacing, typo, and formatting issues
- do not import anything at this stage

### Stage B - Verify Against Provided Answer Key

Goal:

- compare `correct_option` in the cleaned JSON against the answer key in the raw source file

Rules:

- use the provided source only
- do not decide official correctness from outside knowledge
- do not grant publish approval here
- update `review_notes` to reflect answer-key confirmation or mismatch

Recommended command:

```bash
npm run content:verify-answer-key -- --cleaned "contents/import-ready/{subject}.batch{n}.cleaned.json" --converted "contents/converted/{subject}.review.json"
```

Result:

- enough confidence for draft import preparation
- still not enough for publishing approval by itself

### Stage C - Check Importer Compatibility

Run:

- `npm run content:check-import-ready -- --file "contents/import-ready/{subject}.batch{n}.cleaned.json"`

Requirements:

- `0` blocking errors
- explanations and references may be blank
- statuses must match importer rules
- warnings may remain, but they must be understood before proceeding

### Stage D - Local Draft Import Test

Goal:

- prove the cleaned batch can be consumed safely by the importer in a local environment

Rules:

- confirm local Supabase URL first
- dry-run first
- import locally only
- verify inserted or updated row counts

### Stage E - Local Candidate-Flow Simulation

Goal:

- confirm the batch behaves like a real candidate batch

Typical sequence:

- locally publish the reviewed rows
- locally hide the old dev seed rows for that same module/batch
- test Dashboard -> Practice -> Review

Verify:

- expected question count loads
- review returns the same answer count
- batch size and pass mark behave correctly

### Stage F - Remote Draft Import

Goal:

- move the reviewed batch into remote safely without exposing it to candidates yet

Rules:

- confirm remote URL first
- verify no accidental duplicates already exist
- dry-run first
- import as `draft` only
- verify exact draft row counts after import
- do not remote-import an undersized hold batch that is intentionally marked Coming Soon

### Stage G - Publish Approval Gate

Goal:

- publish only after explicit approval and final checks

Rules:

- user or human approval is required
- publish the reviewed rows only
- archive old dev seed rows instead of deleting them
- verify candidate-visible count exactly matches the expected batch size

Recommended command:

```bash
npm run content:publish-batch -- --subject {subject} --batch {n} --source-note provided_client_content_reviewed_draft --archive-dev-seeds --dry-run
```

Real publish only after approval:

```bash
npm run content:publish-batch -- --subject {subject} --batch {n} --source-note provided_client_content_reviewed_draft --archive-dev-seeds --confirm
```

---

## 3. Batch Command Patterns

Build batch analysis:

```bash
npm run content:build-batch -- --file "contents/converted/{subject}.review.json" --subject {subject} --batch {n}
```

Export import-ready draft skeleton:

```bash
npm run content:export-import-ready -- --file "contents/converted/{subject}.review.json" --subject {subject} --batch {n}
```

Check importer compatibility:

```bash
npm run content:check-import-ready -- --file "contents/import-ready/{subject}.batch{n}.cleaned.json"
```

Importer dry-run:

```bash
npm run import:questions -- --file "contents/import-ready/{subject}.batch{n}.cleaned.json" --dry-run
```

Importer actual run:

```bash
npm run import:questions -- --file "contents/import-ready/{subject}.batch{n}.cleaned.json"
```

Publish dry-run:

```bash
npm run content:publish-batch -- --subject {subject} --batch {n} --source-note provided_client_content_reviewed_draft --archive-dev-seeds --dry-run
```

Publish confirm:

```bash
npm run content:publish-batch -- --subject {subject} --batch {n} --source-note provided_client_content_reviewed_draft --archive-dev-seeds --confirm
```

---

## 4. Naming Rules

Import-ready cleaned batch files:

- `contents/import-ready/{subject}.batch{n}.cleaned.json`

Recommended report files:

- `docs/{SUBJECT}_BATCH{N}_PREPARATION_REPORT.md`
- `docs/{SUBJECT}_BATCH{N}_ANSWER_KEY_VERIFICATION.md`
- `docs/LOCAL_{SUBJECT}_BATCH{N}_IMPORT_TEST.md`
- `docs/LOCAL_{SUBJECT}_BATCH{N}_CANDIDATE_FLOW_TEST.md`
- `docs/REMOTE_{SUBJECT}_BATCH{N}_DRAFT_IMPORT.md`
- `docs/REMOTE_{SUBJECT}_BATCH{N}_PUBLISH_REPORT.md`

Examples:

- `docs/PFM_BATCH1_PREPARATION_REPORT.md`
- `docs/PSR_BATCH1_ANSWER_KEY_VERIFICATION.md`
- `docs/LOCAL_PFM_BATCH1_IMPORT_TEST.md`

---

## 5. Human Approval Rules

- Answer-key verification is enough for draft import preparation.
- Official or source verification is still needed before publish.
- User approval is required before publish.
- Current Affairs always requires fact-checking before publish.
- Oral Prep must not enter the CBT question flow.

Practical rule:

- `draft import ready` is not the same as `publish ready`

---

## 6. Safety Rules

- Dry-run first.
- Confirm env target before any import.
- Never print the service role key.
- Local before remote.
- Draft before publish.
- One batch at a time.
- No mass publish.
- Do not delete reviewed content during rollout.
- Archive old dev seeds instead of deleting them.
- Stop if counts do not match the expected batch size.

Expected batch sizes:

- `public-financial-management`: `30`
- `public-service-rules`: `20`
- `current-affairs`: `20`

Undersized hold rule:

- If a batch is intentionally being held until more questions arrive, keep it as `Coming Soon`.
- Example: `public-financial-management` Batch 3 currently has `20/30` questions and must remain on hold.
- A structurally clean undersized file is not enough by itself to justify import or publish.

---

## 7. Future Admin UI

Once the script workflow is stable and trusted, the next step can be an Admin Content Review UI that performs these same stages visually:

- batch preparation tracking
- answer-key verification tracking
- import-readiness status
- local/remote rollout status
- publish approval checkpoints

That should come after the script-based runbook is working reliably across multiple batches.

---

## 8. Bottom Line

Use this lifecycle for every future batch:

1. Prepare cleaned batch file
2. Verify answer key
3. Check import readiness
4. Run local draft import test
5. Run local candidate-flow simulation
6. Run remote draft import
7. Publish only after approval
