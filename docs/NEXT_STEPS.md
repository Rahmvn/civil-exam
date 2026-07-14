# Next Steps — PromotionSure

## 1. Purpose of This Document

This document defines the next major steps for PromotionSure after completing the batch progression system, authenticated flow wiring, content/admin maturity, and first authenticated UI/UX pass.

The goal is to avoid random development and keep the project moving toward a real usable exam-preparation product.

This document should guide:

- Codex tasks
- content conversion
- oral prep planning
- admin/content workflow
- testing
- production readiness
- client/demo preparation

---

## 2. Current Product Status

The app now has the main product foundation in place.

Completed phases:

### Phase 1 — Batch Backend/Data Foundation

Completed:

- Batch-aware database model
- `batch_number` and `batch_position` support
- module-specific batch sizes
- 70% pass mark
- `user_module_progress`
- batch-aware attempts
- display order tracking
- server-side batch enforcement
- `start_practice_batch`
- safe `get_practice_questions`
- batch-aware submit/review/progress RPCs

### Phase 2 — Frontend Flow Wiring

Completed:

- Dashboard CTAs now use batch state
- Free users confirm before starting Batch 1
- Free module locks only after confirmation
- Practice loads server-resolved batch
- Review shows batch/pass/retry/unlock states
- Access page explains batch-based access
- Practice no longer assumes fixed 30 questions

### Phase 3 — Content/Admin Maturity

Completed:

- Importer supports batch validation
- Importer reports question counts by module and batch
- Admin shows batch number and batch position
- Admin has lightweight batch/content visibility
- Dashboard/recent attempts show real batch progress
- Old free-question-count language removed
- Legacy dev seed data cleaned
- Only the 3 real active modules remain active

### Phase 4 — Authenticated UI/UX Redesign

Completed:

- Mobile app-style navigation
- Top mobile header with app name and avatar
- Bottom nav: Dashboard, Modules, Review, Access
- Avatar account menu with Profile and Sign out
- Sign out confirmation
- GL badge normalization
- Dashboard UI improved
- Practice UI improved into CBT-like flow
- Review UI improved
- Access UI improved
- Old hamburger/mobile menu removed

---

## 3. Current Database Content State

The database is now clean for development.

Active subjects:

- `public-financial-management`
- `public-service-rules`
- `current-affairs`

Inactive old subjects:

- `english-language`
- `general-knowledge`
- `mathematics`

Current active published development questions:

- Public Financial Management: 3 questions
- Public Service Rules: 3 questions
- Current Affairs: 3 questions

Old grade-level dev questions:

- `dev_seed_gl07`
- `dev_seed_gl08`

These have been archived and should not appear to users.

The app is structurally ready, but it does not yet have real full content.

---

## 4. New Content Received

A new content file has been received in the `content` folder.

The file contains, in this order:

1. 80 objective questions for Public Financial Management
2. 10 oral questions with detailed answers for Permanent Secretaries
3. 145 objective questions for Public Service Rules
4. 10 objective questions for Current Affairs

This content must not be imported blindly.

It must be inspected, split, converted, reviewed, and then imported carefully.

---

## 5. Important Content Decision

There are two different content types:

### Objective CBT Questions

These are normal multiple-choice questions.

They belong in the existing batch practice system.

They should use:

- question text
- options A-D
- correct option
- explanation if available
- reference note if available
- `batch_number`
- `batch_position`
- `status`

### Oral / Interview Questions

These are not CBT questions.

They should not be forced into the objective question table.

They should not be treated as:

- multiple choice
- voice interview
- subjective scoring
- automatic essay marking
- CBT

They require a separate product mode.

Recommended name:

```text
Oral Prep

or:

Interview Prep
6. Objective Question Batch Plan
6.1 Public Financial Management

Received:

80 objective questions

Module batch size:

30 questions per batch

Recommended allocation:

Batch 1: 30 questions
Batch 2: 30 questions
Batch 3: 20 questions

Notes:

Batch 3 is undersized compared to the standard 30-question batch.
This is acceptable temporarily because only 80 questions were received.
Batch 3 should be treated as a final available batch or held until more questions are added.
The importer should warn that Batch 3 is undersized for production.

Recommended status:

draft

until reviewed.

After review:

published
6.2 Public Service Rules

Received:

145 objective questions

Module batch size:

20 questions per batch

Recommended allocation:

Batch 1: 20 questions
Batch 2: 20 questions
Batch 3: 20 questions
Batch 4: 20 questions
Batch 5: 20 questions
Batch 6: 20 questions
Batch 7: 20 questions
Overflow: 5 questions

Recommended handling for remaining 5:

Option A — safest:

Keep the remaining 5 as draft overflow until more questions are added.

Option B — acceptable later:

Create a short revision batch if the product intentionally supports final short batches.

For now, use Option A unless there is a clear reason to publish the 5 as a short final batch.

6.3 Current Affairs

Received:

10 objective questions

Module batch size:

20 questions per batch

Recommended allocation:

Batch 1: 10 questions

Notes:

Batch 1 is undersized.
This is acceptable for development/testing.
For production, Current Affairs should ideally reach 20 questions before being treated as a complete batch.

Recommended status:

draft

until reviewed.

7. Oral Questions Strategy

The 10 Permanent Secretaries oral questions require a separate experience.

They should become:

Permanent Secretaries Oral Prep

This should be a study/revision mode.

First Version Experience

The first version should be simple:

Oral prompt
→ user thinks through answer
→ user clicks Reveal model answer
→ user reads detailed answer
→ user reviews key points
→ user marks as reviewed
→ next prompt

No voice.

No scoring.

No AI marking.

No subjective grading.

Suggested Oral Prep Fields

Each oral item should have:

id
title
prompt
model_answer
key_points
audience
sort_order
status
source_note

Optional later fields:

follow_up_questions
difficulty
is_free_sample
reviewed_count
last_reviewed_at
Suggested UI

Dashboard card:

Permanent Secretaries Oral Prep
10 prompts
Study mode

Inside the page:

Prompt 1 of 10
Question text
Think through your answer first.

[Reveal model answer]

Model answer
Key points to mention

[Mark as reviewed]
[Next prompt]
Access Rule

For now:

Paid users get all oral prep resources.

Later we may allow:

Free users get 1 sample oral prompt.

But this is not required immediately.

8. Data Model Options for Oral Prep
Option A — JSON-only Development Mode

Store oral prep as:

content/oral/permanent-secretaries.json

Advantages:

Fast
Simple
Good for development review
No migration needed immediately

Disadvantages:

Not ideal for paid production content
Content may be bundled in frontend if imported directly
Harder to control access securely
Option B — Separate Database Table

Create a table like:

study_resources

or:

oral_prompts

Possible fields:

id uuid primary key
exam_pack_id uuid
resource_type text
audience text
title text
prompt text
model_answer text
key_points jsonb
sort_order integer
status text
is_free_sample boolean
created_at timestamptz
updated_at timestamptz

Advantages:

Better access control
Better admin workflow
Better for paid content
Can later support other study resources

Disadvantages:

Requires migration
Requires RPC/API
Requires UI page
Recommendation

Use this approach:

Step 1: Convert oral questions into structured JSON for review.
Step 2: Do not import them into objective questions.
Step 3: Plan a separate Oral Prep feature.
Step 4: Later create a proper database-backed oral prep system.
9. Content Conversion Plan
Step 1 — Inspect the Source File

Before converting, inspect the received content file.

Determine:

where Public Financial Management questions start and end
where oral questions start and end
where Public Service Rules questions start and end
where Current Affairs questions start and end
whether numbering is consistent
whether options are consistently marked
whether answers are clearly marked
whether explanations exist
whether the oral questions have detailed answers separated cleanly

Do not transform blindly.

Step 2 — Split the Content

Split into four working files:

content/converted/public-financial-management.review.json
content/converted/public-service-rules.review.json
content/converted/current-affairs.review.json
content/converted/permanent-secretaries-oral.review.json

Use .review.json first to show they are not final production imports yet.

Step 3 — Convert Objective Questions

Objective JSON should follow the existing importer structure:

{
  "subject_slug": "public-financial-management",
  "batch_number": 1,
  "batch_position": 1,
  "difficulty": "medium",
  "question_text": "Question text here",
  "option_a": "Option A",
  "option_b": "Option B",
  "option_c": "Option C",
  "option_d": "Option D",
  "correct_option": "A",
  "explanation": "Explanation here",
  "reference_note": "Reference here",
  "source_note": "provided_client_content_pending_review",
  "status": "draft"
}
Step 4 — Convert Oral Questions

Oral JSON should not use the objective format.

Suggested format:

{
  "resource_type": "oral_prep",
  "audience": "permanent_secretaries",
  "title": "Permanent Secretaries Oral Prep",
  "prompt": "Question here",
  "model_answer": "Detailed answer here",
  "key_points": [
    "Point 1",
    "Point 2",
    "Point 3"
  ],
  "sort_order": 1,
  "source_note": "provided_client_content_pending_review",
  "status": "draft"
}
Step 5 — Human Review

Before importing or publishing:

check all correct options
check typos
check repeated questions
check unclear questions
check missing answers
check whether options A-D exist
check whether answers match the options
check if any current affairs question is time-sensitive
check whether oral answers are appropriate and complete
Step 6 — Import Only After Review

Do not publish immediately.

Recommended first import:

status = draft

After manual review:

status = published
10. Import Strategy

Do not overwrite clean seed files blindly.

Recommended flow:

First conversion output

Create:

content/converted/*.review.json
Review

Manually inspect converted JSON.

Test import locally

Use local Supabase:

supabase db reset
$env:SUPABASE_URL="http://127.0.0.1:54321"
$env:SUPABASE_SERVICE_ROLE_KEY="<local-service-role-key>"
npm run import:questions
If good, import into remote as draft

Set remote environment variables:

$env:SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_REMOTE_SERVICE_ROLE_KEY"
npm run import:questions

Do not paste remote service keys into chat.

Publish after review

Use Admin or SQL to publish reviewed questions.

11. Content Quality Rules

Do not publish questions that have:

missing options
missing correct answer
answer not matching A-D
unclear question text
duplicate content
broken formatting
oral-style subjective wording
time-sensitive current affairs without review
wrong module assignment
missing batch number
missing batch position

Avoid source notes like:

dev_seed

for real content.

Use source notes like:

provided_client_content_pending_review
provided_client_content_reviewed
verified_public_service_material
12. Real Question Batch Publishing Strategy

Recommended initial publishing order:

First publish one module only

Start with:

Public Financial Management Batch 1

Why:

30-question batch matches the real exam module structure.
It is enough to test full batch behavior.
It lets us test performance, review, retry, and unlock flow.

Then publish:

Public Service Rules Batch 1

Then:

Current Affairs Batch 1

After that, continue publishing later batches.

Do not publish all converted content at once unless fully reviewed.

13. Testing After Real Content Import

After importing real objective content, test:

Dashboard
module counts update
batch status updates
undersized warnings do not appear to candidates
CTAs still make sense
Practice
PFM Batch 1 loads 30 questions
PSR Batch 1 loads 20 questions
Current Affairs loads available questions
options render correctly
Next/Previous works
Submit works
Review
score percent is correct
pass/fail status is correct
explanations render
answer order is stable
Retry works
Free User
can choose one free module
cannot use another module for free
can retry once after failing
passing free Batch 1 requires unlock for further access
Paid User
can access all modules
can retry failed batches
can proceed to next batch after passing
14. Phase 5 — Real Content Pipeline and Oral Prep Planning

The next major phase should be:

Phase 5 — Real Content Pipeline and Oral Prep Planning
Goals
inspect the received content file
split objective and oral content
convert objective questions into batch JSON
convert oral questions into structured oral prep JSON
review converted content
import objective questions safely
plan oral prep feature separately
prepare real candidate testing
Phase 5 Deliverables

Expected deliverables:

docs/CONTENT_CONVERSION_REPORT.md
content/converted/public-financial-management.review.json
content/converted/public-service-rules.review.json
content/converted/current-affairs.review.json
content/converted/permanent-secretaries-oral.review.json

Optional later deliverables:

supabase/migrations/xxxx_create_oral_prep_resources.sql
src/pages/OralPrep.jsx
src/lib/oralPrepApi.js

Do not build oral prep until the data approach is approved.

15. Phase 5 Task Order
Task 1 — Commit Current Work

Before touching content:

git status
git add .
git commit -m "Complete authenticated UI and batch flow"
Task 2 — Create This Document

Create:

docs/NEXT_STEPS.md
Task 3 — Inspect Received Content File

Codex should inspect the file and report:

file path
detected sections
estimated question counts
formatting pattern
risks
whether automatic parsing is safe

Do not transform yet.

Task 4 — Build Conversion Plan

Create a plan for converting:

Public Financial Management objective questions
Public Service Rules objective questions
Current Affairs objective questions
Permanent Secretaries oral questions
Task 5 — Convert to Review JSON

Create review JSON files.

Do not overwrite existing clean seed files.

Task 6 — Validate Review JSON

Check:

counts
options
answers
batch numbers
batch positions
duplicate questions
missing fields
Task 7 — Human Review

Manually inspect samples from each file.

Task 8 — Import Locally

Import into local Supabase first.

Task 9 — Import Remote as Draft

Only after local success.

Task 10 — Publish Carefully

Publish one module batch at a time.

16. Things Not To Do Yet

Do not:

force oral questions into CBT
build voice mode
build AI subjective marking
publish unreviewed content
overwrite current clean seed files blindly
change Paystack
change auth
change batch progression logic
change grade-level filtering rules
import directly to production without local/staging test
make Current Affairs appear complete with only 10 questions
show oral prep as a scored exam
17. Immediate Next Codex Prompt

Use this after creating this document:

Read docs/PRODUCT_BLUEPRINT.md and docs/NEXT_STEPS.md first.

Do not change app code.
Do not change database schema.
Do not import content yet.

Inspect the new content file in the content folder.

Report:
1. exact file path
2. detected sections
3. question counts per section
4. formatting pattern for objective questions
5. formatting pattern for oral questions
6. whether correct answers are clearly detectable
7. whether options A-D are consistently present
8. whether explanations are present
9. risks in automatic parsing
10. recommended conversion approach

Do not transform the content yet.
Do not create JSON files yet.
This is inspection only.
18. Final Direction

The app is no longer just a demo.

The next value comes from content quality.

The strongest next move is not another UI pass. It is:

clean content → safe conversion → local import → review → publish carefully

Objective content should strengthen the CBT batch system.

Oral content should become a separate Oral Prep experience.

Both should support the same product goal:

help civil servants prepare seriously and confidently for promotion exams
