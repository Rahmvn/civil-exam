# Question Intake & Batch Builder

## 1. Purpose

This document defines a reusable content pipeline subsystem for FPS Exam Practice.

The goal is to stop relying on one-off manual cleanup every time a new exam-content file arrives.

The subsystem should make it possible to:

- intake new raw content safely
- inspect and classify sections
- convert source material into review JSON
- validate objective and oral content differently
- arrange objective questions into product-compliant batches
- export only reviewed content into import-ready files
- support local testing before any remote draft import or publishing

This plan is for process and tooling design only.

It does not change:

- app code
- `src/` files
- database schema
- migrations
- Paystack
- auth
- importer behavior
- publishing state

---

## 2. Problem It Solves

The current manual conversion workflow is too fragile to depend on long term.

New question files may arrive with:

- inconsistent numbering
- mixed sections in one text file
- separate answer-key sections
- malformed option labels
- duplicated options
- missing options
- missing explanations
- mixed objective and oral content
- outdated Current Affairs items
- unclear question-to-answer alignment

The product also has content-specific rules that manual cleanup can easily violate:

- objective CBT questions belong in batch-based practice
- oral questions must stay outside the CBT flow
- batches must follow subject batch-size rules
- review JSON should remain draft-only
- import-ready files should only come after validation and human review
- not every converted item should be imported or published

Without a reusable subsystem, each new file becomes a risky manual operation.

---

## 3. Current Example Context

Current raw example:

- `contents/2026 PROMOTION (FINANCIAL REGULATIONS, PSR & CURRENT AFFAIRS).txt`

Current converted outputs:

- `contents/converted/public-financial-management.review.json`
- `contents/converted/public-service-rules.review.json`
- `contents/converted/current-affairs.review.json`
- `contents/converted/permanent-secretaries-oral.review.json`

Current product rules:

- objective CBT questions go into the batch practice system
- oral questions remain separate as Oral Prep
- oral questions must not be forced into CBT
- unreviewed content must not be imported blindly
- unreviewed content must not be published

---

## 4. Pipeline Stages

### Stage 1 - Raw Content Intake

All new source files should go into:

- `contents/raw/`

Rules:

- preserve the original source exactly as received
- never edit raw files directly
- never use raw files as import sources
- treat raw files as the immutable reference copy

Outputs:

- raw source file stored safely
- metadata record or report entry noting source name and received date

### Stage 2 - Inspection

Inspection should produce a report before any conversion begins.

Inspection should:

- detect major sections
- estimate question counts per section
- identify objective vs oral content
- identify answer-key sections
- detect numbering anomalies
- detect likely malformed options
- detect likely missing answers
- report parsing risks

Outputs:

- inspection report in `contents/reports/` or `docs/content/`
- confidence notes about whether automatic conversion is safe

### Stage 3 - Conversion to Review JSON

The conversion stage should produce review JSON only.

Output location:

- `contents/converted/`

Examples:

- `contents/converted/public-financial-management.review.json`
- `contents/converted/public-service-rules.review.json`
- `contents/converted/current-affairs.review.json`
- `contents/converted/permanent-secretaries-oral.review.json`

Rules:

- all converted items start as `draft`
- all converted items start with `needs_review: true`
- no converted file is imported automatically
- no converted file is published automatically
- conversion should preserve source numbering where possible
- conversion should add review notes when anomalies are detected

### Stage 4 - Validation

Validation should check structure, completeness, and consistency.

For objective CBT questions, validate:

- question text exists
- options A-D exist
- `correct_option` exists and is one of `A/B/C/D`
- answer key aligns with source numbering
- no duplicate option labels
- no missing options
- no obvious duplicate questions
- `batch_number` is valid
- `batch_position` is valid
- status is valid

For oral items, validate:

- prompt exists
- model answer exists
- oral items do not contain CBT-only fields
- no attempt is made to route oral content into CBT import flow

Outputs:

- validation report
- list of blocking errors
- list of warnings
- structural readiness level

### Stage 5 - Batch Arrangement

Objective questions must be arranged using product batch rules.

Batch rules:

- Public Financial Management: 30-question batches
- Public Service Rules: 20-question batches
- Current Affairs: 20-question batches

The batch arrangement step should:

- assign `batch_number`
- assign `batch_position`
- detect complete batches
- detect undersized final batches
- detect overflow questions
- support draft-only batches

Handling rules:

- complete batches can proceed to review
- undersized dev or partial batches may remain valid as draft review content
- overflow items should not be forced into production batches without approval
- batch arrangement should be deterministic and reproducible

### Stage 6 - Human Review

Human review is required before import-ready export.

Reviewer checks:

- answer correctness
- wording clarity
- typos
- duplicate or malformed options
- explanation quality or intentional absence
- current affairs accuracy
- oral-answer usefulness
- whether the item is actually suitable for CBT

Outputs:

- reviewed items with updated `review_notes`
- decisions on include/exclude/fix
- readiness signal for batch export

### Stage 7 - Import-Ready Export

Only reviewed content should move into:

- `contents/import-ready/`

Rules:

- export reviewed batches only
- exclude malformed items
- exclude unresolved duplicate or missing-field items
- set `source_note` to a reviewed value such as `provided_client_content_reviewed`
- set `needs_review: false` only after real human review
- keep `status: "draft"` first
- do not publish automatically

Import-ready output is for controlled import, not automatic publishing.

Current importer compatibility note:

- an exported batch file is not automatically compatible with the existing importer
- the current importer reads from `content/questions/`, not `contents/import-ready/`
- the current importer also requires non-empty `explanation` values even for draft items
- import-readiness checks should therefore distinguish:
  - structurally exported batch
  - actually compatible with the current importer

### Stage 8 - Local Import Test

Before any remote import:

- import locally only
- verify dashboard counts
- verify practice loading
- verify batch flow
- verify review flow
- verify subject mapping

Rules:

- no remote import at this stage
- do not publish from local test data automatically

### Stage 9 - Remote Draft Import

Only after local validation succeeds:

- import reviewed batch content into remote as `draft`

Rules:

- remote import should be selective
- remote import should happen per reviewed batch, not all at once
- remote items remain draft until explicitly approved

### Stage 10 - Controlled Publish

Publishing should be gradual and traceable.

Rules:

- publish one batch at a time
- recommended first publish: Public Financial Management Batch 1
- then Public Service Rules Batch 1
- Current Affairs only after fact-checking
- do not mass-publish all imported draft content

---

## 5. Proposed Folder Structure

Recommended structure:

- `contents/raw/`
- `contents/converted/`
- `contents/import-ready/`
- `contents/rejected/`
- `contents/reports/`
- `docs/content/`

Folder purposes:

- `contents/raw/`: immutable original files
- `contents/converted/`: parsed review JSON outputs
- `contents/import-ready/`: reviewed batch exports ready for controlled import
- `contents/rejected/`: malformed or intentionally excluded items
- `contents/reports/`: inspection and validation reports
- `docs/content/`: human-readable content workflow documentation

---

## 6. Proposed Scripts

These are planned commands only. They should not be implemented blindly without the validation rules below.

### Inspect

```bash
npm run content:inspect -- --file "contents/raw/file.txt"
```

Purpose:

- detect sections
- estimate counts
- report parsing risks

### Convert

```bash
npm run content:convert -- --file "contents/raw/file.txt"
```

Purpose:

- convert source into review JSON
- keep everything as draft
- keep everything as `needs_review: true`

### Validate

```bash
npm run content:validate -- --file "contents/converted/public-financial-management.review.json"
```

Purpose:

- run objective/oral validation rules
- output errors and warnings

### Build Batch

```bash
npm run content:build-batch -- --subject public-financial-management --batch 1
```

Purpose:

- slice or arrange converted content into a specific subject batch
- assign or confirm batch positions

### Export Import-Ready

```bash
npm run content:export-import-ready -- --subject public-financial-management --batch 1
```

Purpose:

- export only reviewed content into `contents/import-ready/`

### Report

```bash
npm run content:report
```

Purpose:

- summarize raw, converted, review, import-ready, and rejected content status

---

## 7. Proposed Validation Rules

### Objective CBT Questions

Required:

- `subject_slug`
- `source_number`
- `question_text`
- `option_a`
- `option_b`
- `option_c`
- `option_d`
- `correct_option`
- `source_note`
- valid `status`

Rule details:

- `correct_option` must be `A`, `B`, `C`, or `D`
- `batch_number` is required unless the item is intentionally held as overflow draft content
- `batch_position` is required unless the item is intentionally held as overflow draft content
- options must not be duplicated through malformed labels
- question text must not be empty
- explanation is optional for review JSON
- explanation is required or explicitly waived before import-ready approval, depending on publishing policy

Validation warnings should flag:

- duplicate questions
- answer-key uncertainty
- typo affecting meaning
- current affairs staleness risk
- malformed numbering

### Oral Prep

Oral content should follow a separate validation model.

Required:

- `resource_type = oral_prep`
- `prompt`
- `model_answer`

Optional:

- `key_points`
- `reference_note`
- `review_notes`

Forbidden for oral items:

- `option_a`
- `option_b`
- `option_c`
- `option_d`
- `correct_option`

Rule:

- oral prep must not be imported into the CBT `questions` table

---

## 8. Import-Readiness Levels

Define clear readiness levels so teams know what each file means.

### Level 0 - Raw

The original file only.

Characteristics:

- untouched source
- not parsed
- not validated

### Level 1 - Converted Review

Parsed into JSON for review.

Characteristics:

- draft only
- `needs_review: true`
- may still contain structural or content issues

### Level 2 - Structurally Valid

Fields are complete and technically consistent.

Characteristics:

- structure passes validation
- answers or explanations may still need human review
- not yet safe to publish

### Level 3 - Import-Ready Draft

Safe to import locally or remotely as draft.

Characteristics:

- reviewed batch only
- required fields complete
- malformed items excluded or fixed
- not yet published

### Level 4 - Publish-Ready

Human-reviewed and safe for controlled publishing.

Characteristics:

- answers verified
- wording cleaned
- current affairs fact-checked where relevant
- approved for publish decision

---

## 9. Admin UI Future Plan

Later, after the local script pipeline is stable, the product can gain an Admin Content Review interface.

Possible future features:

- upload raw file
- preview detected sections
- view validation errors
- review malformed items
- edit question text and options
- approve or reject individual items
- build batches
- export import-ready content
- trigger draft import
- publish one batch at a time

Important:

- this should come after the script-based pipeline is proven
- the local content pipeline should be the source of truth first
- admin UI should not replace validation discipline

---

## 10. Oral Prep Handling

Oral questions should use the same early pipeline stages for:

- intake
- inspection
- conversion
- validation

But oral content must diverge after that.

Rules:

- do not force oral prompts into CBT
- do not map oral answers into `correct_option`
- do not import oral items into the objective `questions` table
- keep oral outputs separate for future Oral Prep or Interview Prep use

Recommended future output paths:

- `contents/converted/permanent-secretaries-oral.review.json`
- future oral-ready export files in a separate folder or format if needed

---

## 11. Recommended Immediate Implementation Order

Recommended order after this plan:

1. Create the content pipeline plan
2. Create script skeletons for inspection, conversion, validation, batch building, and export
3. Create reusable validators for objective and oral content
4. Create the batch builder
5. Test the pipeline using the existing promotion source file
6. Generate a clean Public Financial Management Batch 1 import-ready draft
7. Then import locally only

This order is intentionally script-first, not admin-UI-first.

---

## 12. Things Not To Do

Do not:

- build full AI marking
- build voice mode
- import all content blindly
- publish all batches automatically
- force oral content into CBT
- let validation be optional
- treat converted review JSON as automatically import-ready
- overwrite raw source files

---

## 13. Recommended Success Criteria

The Question Intake & Batch Builder subsystem is successful when:

- a new raw file can be stored without modification
- inspection can identify sections and risks
- conversion can produce draft review JSON reliably
- validation can catch structural problems consistently
- batch rules can be applied deterministically
- oral and objective content are separated correctly
- reviewed content can be exported as import-ready draft files
- local import can be tested safely before any remote action
- publishing can be controlled one batch at a time

---

## 14. Recommended Next Codex Prompt

When ready to move from planning to implementation, the next prompt should focus on script-based pipeline work first.

Suggested direction:

- implement inspection and validation script skeletons
- keep them local-only
- test them against the existing promotion content file
- do not import or publish yet
