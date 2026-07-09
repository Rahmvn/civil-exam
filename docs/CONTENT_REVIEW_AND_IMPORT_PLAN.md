# Content Review and Import Plan

## 1. Current Converted Content Summary

- Public Financial Management: 80 draft objective questions
- Public Service Rules: 145 draft objective questions
- Current Affairs: 10 draft objective questions
- Permanent Secretaries Oral Prep: 10 draft oral prep items

All converted items are currently:

- `status: "draft"`
- `needs_review: true`

## 2. Import Decision

Do not import everything yet.

Reasons:

- all objective explanations are empty
- all items are marked `needs_review`
- Public Service Rules has malformed option issues
- Current Affairs needs fact-checking
- Oral Prep is not part of the CBT import flow

## 3. Structural Issues To Fix Before Import

Known issues from the conversion stage:

- PSR answer key item 1 was malformed as `I. d` and was normalized
- PSR question 38 has duplicated/malformed option `a`
- PSR question 66 has malformed option label for `c`
- PSR question 84 has duplicated option `b`, leaving option `c` missing
- PSR question 136 is missing option `d`
- PSR question 138 has duplicated option `b`, leaving option `d` missing
- Oral answer 1 was malformed as `I.` and was normalized
- PFM numbering irregularity exists around questions 24 and 25
- PFM Batch 3 is undersized
- Current Affairs Batch 1 is undersized
- PSR questions 141-145 are overflow content

## 4. Review Priority

### Priority 1

Public Financial Management Batch 1, questions 1-30

Reason:

- it gives one full 30-question batch
- it matches the PFM batch size
- it is enough to test a realistic exam flow

### Priority 2

Public Service Rules Batch 1, questions 1-20

Reason:

- it gives one full 20-question PSR batch
- PSR has more malformed items later, but Batch 1 is mostly usable

### Priority 3

Current Affairs Batch 1

Reason:

- only 10 questions
- time-sensitive
- must be fact-checked before publishing

### Priority 4

Remaining PFM and PSR batches

### Priority 5

Permanent Secretaries Oral Prep feature planning

## 5. Explanation Strategy

All objective questions currently have empty explanations.

### Option A - Minimum Launch

- publish reviewed questions without explanations
- Review page shows correct answer only
- fastest, but weaker learning experience

### Option B - Better Launch

- add short explanations or references for only the first publishable batches
- Public Financial Management Batch 1
- Public Service Rules Batch 1
- publish only those first
- keep the rest as draft

### Option C - Best but Slowest

- add explanations or references to all objective questions before publishing

### Recommendation

Recommend Option B.

## 6. Current Affairs Warning

Current Affairs should not be published until fact-checked.

Reason:

- current office holders may change
- commission details may change
- ministers may change
- sports and current-event answers may change
- some answers may already be wrong or outdated

Do not use Current Affairs as the first publishable content.

## 7. Oral Prep Decision

Permanent Secretaries Oral Prep should remain separate from CBT.

Do not import oral prep into the `questions` table.

Next oral prep step should be:

- clean the 10 oral prompts and answers
- improve `key_points` manually
- later design a separate Oral Prep page or separate table

## 8. Import-Ready File Strategy

Do not import `.review.json` files directly.

Recommended later files:

- `contents/import-ready/public-financial-management.batch1.json`
- `contents/import-ready/public-service-rules.batch1.json`

These should be created only after manual review.

Rules for import-ready files:

- `status` can remain `draft` at first
- `needs_review` should be `false` only after human review
- malformed items must be fixed or excluded
- explanations should be added if possible
- `source_note` should change from `provided_client_content_pending_review` to `provided_client_content_reviewed`

## 9. Manual Review Checklist

For each question, check:

- question text is clear
- options A-D are complete
- correct answer matches the answer key
- correct answer is actually correct
- no duplicate options
- no typo that changes meaning
- no oral or subjective question inside CBT
- explanation or reference is added, or intentionally left blank

## 10. Recommended Immediate Next Action

Recommended next step:

- review and clean Public Financial Management Batch 1 first
- create an import-ready draft file only for Public Financial Management Batch 1
- test local import with only that file
- do not touch remote production yet
