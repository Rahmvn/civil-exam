# Bulk Remaining Batch Preparation Report

## Prepared Batches

| Subject | Batch | Expected size | Actual size | Cleaned file path | Explanations added | Answer-key result | Blocking errors | Readiness | needs_review count | Publish recommendation |
| --- | ---: | ---: | ---: | --- | ---: | --- | ---: | --- | ---: | --- |
| public-financial-management | 3 | 30 | 20 | `contents/import-ready/public-financial-management.batch3.cleaned.json` | 20 | 20/20 matches, mismatches 0, missing 0 | 0 | HOLD_COMING_SOON | 20 | Hold: keep as Coming Soon. Do not import or publish until the batch reaches the full 30-question size. |
| public-service-rules | 2 | 20 | 20 | `contents/import-ready/public-service-rules.batch2.cleaned.json` | 20 | 20/20 matches, mismatches 0, missing 0 | 0 | DRAFT_IMPORT_CANDIDATE | 20 | Draft import candidate; keep on draft until human review is complete. |
| public-service-rules | 3 | 20 | 20 | `contents/import-ready/public-service-rules.batch3.cleaned.json` | 20 | 20/20 matches, mismatches 0, missing 0 | 0 | DRAFT_IMPORT_CANDIDATE | 20 | Draft import candidate; keep on draft until human review is complete. |
| public-service-rules | 4 | 20 | 20 | `contents/import-ready/public-service-rules.batch4.cleaned.json` | 20 | 20/20 matches, mismatches 0, missing 0 | 0 | DRAFT_IMPORT_CANDIDATE | 20 | Draft import candidate; keep on draft until human review is complete. |
| public-service-rules | 5 | 20 | 20 | `contents/import-ready/public-service-rules.batch5.cleaned.json` | 20 | 20/20 matches, mismatches 0, missing 0 | 2 | BLOCKED | 20 | Blocked: source defects must be fixed before draft import. |
| public-service-rules | 6 | 20 | 20 | `contents/import-ready/public-service-rules.batch6.cleaned.json` | 20 | 20/20 matches, mismatches 0, missing 0 | 0 | DRAFT_IMPORT_CANDIDATE | 20 | Draft import candidate; keep on draft until human review is complete. |
| public-service-rules | 7 | 20 | 20 | `contents/import-ready/public-service-rules.batch7.cleaned.json` | 20 | 20/20 matches, mismatches 0, missing 0 | 4 | BLOCKED | 20 | Blocked: source defects must be fixed before draft import. |

## Hold / Review Items

- Public Financial Management Batch 3 remains a hold/Coming Soon batch because it is undersized at 20 questions against an expected 30.
- Public Financial Management Batch 3 must not be imported or published yet; more PFM questions are expected later to complete the batch.
- Public Service Rules source questions 141-145 remain overflow / hold and were not exported as a production batch.
- Current Affairs remains on fact-check-required hold and was not prepared for publishing.
- Oral Prep remains excluded from CBT batch preparation.

## Summary

- Prepared batch count: 7
- Structurally blocked batches: 2
- Draft-import-candidate batches: 4
- Hold batches: 3

## Notes

- Answer-key verification was run for every cleaned file against its converted review source.
- Import-ready checks were run for every cleaned file.
- Because the current answer-key verification script preserves or forces `needs_review: true`, all cleaned files remain review-tagged after verification.
- `public-financial-management` Batch 3 is the specific exception: even though it is structurally clean, the product decision is to keep it unavailable/Coming Soon until it reaches the expected 30-question batch size.
