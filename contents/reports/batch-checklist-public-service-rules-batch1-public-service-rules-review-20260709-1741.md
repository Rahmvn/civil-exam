# Batch Checklist

## Subject

- `public-service-rules`

## Batch

- 1

## Expected Size

- 20

## Converted Source File

- `contents/converted/public-service-rules.review.json`

## Expected Cleaned Output File

- `contents/import-ready/public-service-rules.batch1.cleaned.json`

## Standard Lifecycle

- Stage A - prepare cleaned batch file
- Stage B - verify against the provided answer key
- Stage C - check importer compatibility
- Stage D - local draft import test
- Stage E - local candidate-flow simulation
- Stage F - remote draft import
- Stage G - controlled publish after approval

## Commands To Run

- `npm run content:build-batch -- --file "contents/converted/public-service-rules.review.json" --subject public-service-rules --batch 1`
- `npm run content:export-import-ready -- --file "contents/converted/public-service-rules.review.json" --subject public-service-rules --batch 1`
- `npm run content:check-import-ready -- --file "contents/import-ready/public-service-rules.batch1.cleaned.json"`
- `npm run import:questions -- --file "contents/import-ready/public-service-rules.batch1.cleaned.json" --dry-run`
- `npm run import:questions -- --file "contents/import-ready/public-service-rules.batch1.cleaned.json"`

## Expected Report Files

- `docs/PUBLIC_SERVICE_RULES_BATCH1_PREPARATION_REPORT.md`
- `docs/PUBLIC_SERVICE_RULES_BATCH1_ANSWER_KEY_VERIFICATION.md`
- `docs/LOCAL_PUBLIC_SERVICE_RULES_BATCH1_IMPORT_TEST.md`
- `docs/LOCAL_PUBLIC_SERVICE_RULES_BATCH1_CANDIDATE_FLOW_TEST.md`
- `docs/REMOTE_PUBLIC_SERVICE_RULES_BATCH1_DRAFT_IMPORT.md`
- `docs/REMOTE_PUBLIC_SERVICE_RULES_BATCH1_PUBLISH_REPORT.md`

## Safety Gates

- Confirm local Supabase URL before any local import.
- Confirm remote Supabase URL before any remote import.
- Never print the service role key.
- Run dry-run before actual import.
- Import as draft before any publish step.
- Stop if the selected batch count does not match the expected batch size unless the batch is intentionally undersized draft content.
- Do not publish without human approval.
- Archive old dev seeds instead of deleting them.
