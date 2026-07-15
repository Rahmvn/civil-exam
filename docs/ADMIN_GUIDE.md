# PromotionSure Admin Guide

## Purpose

This guide is for administrators who manage modules, practice sets, questions, publishing, and corrections in PromotionSure.

It is written to be:

- simple to follow
- accurate to the current admin UI
- safe for day-to-day operations
- clear enough to use without developer help

Use this guide when you need to:

- create a new module
- add or publish practice content
- import questions in bulk
- correct a published question
- stop sales or retire a module
- understand what the admin labels mean

## How To Open The Admin

Administrators use the normal PromotionSure sign-in flow.

After sign-in:

- open `/admin`
- use `Content` to manage modules and practice sets
- use `Activity` to review recent admin changes

If you cannot open `/admin`, your profile may not currently have the `admin` role.

## Admin Areas

### Content

This is where you manage:

- modules
- practice sets
- questions
- pricing and sales availability
- question imports
- publishing

### Activity

This shows:

- who made a change
- what changed
- when it changed
- the affected module, set, or question

## Core Terms

### Module

A module is a subject area such as:

- English Language
- Public Service Rules
- Mathematics

A module can contain multiple practice sets.

### Practice set

A practice set is a numbered set inside a module, such as:

- Practice set 1
- Practice set 2

Candidates start practice through published practice sets.

### Question

A question belongs to one practice set and has:

- a position
- four answer options
- one correct answer
- an explanation

### Correction

A correction is the safe way to update a published question.

It does not overwrite history immediately. It creates a reviewed replacement that can be published when ready.

## Safe Working Rules

Follow these rules every time:

1. Keep unfinished work in `Draft`.
2. Do not publish a set until every readiness check passes.
3. Do not edit a published question directly. Use `Correct`.
4. Use `Available for purchase` only when pricing and content are ready.
5. Archive content rather than trying to delete historical records.
6. Review imports before confirming them.

## Module Workflow

### Create A Module

1. Open `Content`.
2. Select `Create module`.
3. Enter the module name.
4. Set the module status.
5. Set the default questions per practice set.
6. Set the pass mark.
7. Set the module price.
8. Save the module.

After creation, build and publish at least one valid practice set before treating the module as live content.

### Module Statuses

### Draft

- private to administrators
- not visible to candidates
- best for unfinished work

### Coming soon

- visible to candidates
- not ready to start
- not intended for active practice yet

### Active

- ready for real use
- can contain published practice
- can be made available for purchase

### Retired

- no longer part of the active catalogue
- should be used for content that is no longer being offered

### Module Settings Fields

### Module name

The subject title shown to administrators and candidates.

### Status

Controls the module lifecycle.

### Module position

Controls where the module appears in the module list.

- lower number = earlier in the list
- higher number = later in the list

Example:

- `10` appears before `50`
- `50` appears before `100`

### Questions per practice set

The default target question count for new practice sets in that module.

### Pass mark (%)

The default pass threshold for practice sets in that module.

### Module price (NGN)

The module price for future purchases.

Changing the price does not rewrite old purchases.

### Available for purchase

Controls new sales only.

Turning it off:

- stops new purchases
- does not remove access already granted
- does not remove past attempts
- does not remove receipts or history

### Module Summary Labels

These labels appear in the module workspace:

### Sets

The total number of practice sets in the module.

### Published sets

The number of practice sets currently published.

### Total attempts

The total number of attempts recorded for that module.

This is not the same as unique users.

### Current access

The number of active access records that currently make the module available.

This is an access count, not a simple sales count.

## Practice Set Workflow

### Create A Practice Set

1. Open a module.
2. Select `Add practice set`.
3. Enter the required question count.
4. Save.

The system assigns the set number automatically.

### Practice Set Statuses

### Draft

- questions can be added, edited, removed, or imported
- best for active content preparation

### In review

- set is being checked for readiness
- can still be returned to draft

### Published

- candidates can use the set
- published questions should be corrected through revisions

### Archived

- no new attempts should start from the set
- historical records remain preserved

### Practice Set Readiness

Before a set can move forward safely, it should be complete.

The readiness checks look for:

- the expected number of questions
- valid question positions
- four distinct answer options
- a valid correct answer
- explanations
- no duplicate question text in the same set

If the readiness block says the set is blocked, resolve every listed issue before moving forward.

### Practice Set Actions

### Add one question

Use this when you want to enter or edit a single question manually.

### Upload questions

Use this when you already prepared a full question file.

### Send for review

Use this when the draft set is complete and ready for a final check.

### Return to draft

Use this when a review set still needs editing.

### Publish set

Use this only after the set is complete and validated.

### Archive set

Use this when the set should no longer accept new candidate attempts.

## Question Workflow

### Add Or Edit A Question

When adding or editing a question:

1. enter the question text exactly as candidates should see it
2. fill all four answer options
3. select the correct answer letter
4. add the explanation
5. save

Additional details are available under `Additional details`.

### Question Fields

### Position

The question order within the practice set.

Use simple ascending positions such as:

- 1
- 2
- 3
- 4

Do not repeat a position inside the same practice set.

Candidates see questions in position order, so confirm the order before review and publication.

### Explanation

Explains why the correct answer is right.

This is especially important before publication.

### Difficulty

One of:

- easy
- medium
- hard

### Reference

The source reference, rule, chapter, section, or supporting authority.

### Internal source note

An internal admin note about where the question came from.

### Correct A Published Question

Use this process for published questions:

1. open the published question
2. select `Correct`
3. edit the correction
4. save the correction
5. preview it carefully
6. publish the correction when ready

This preserves history safely. Old candidate attempts remain linked to the version that was originally answered.

### Question Order And Arrangement

Treat question order as part of the final publishing check.

- use clear ascending positions
- check that no position is duplicated
- confirm that the final order matches the order candidates should see
- do not use published corrections to rearrange the set

When adding questions manually, the next position is usually filled automatically from the current highest position.

## Bulk Import Guide

### When To Use Bulk Import

Use bulk import when you have prepared many questions already and want to upload them in one step.

Bulk import is best for:

- a new practice set
- a large draft update
- structured content prepared in a spreadsheet

### Accepted File Types

The admin accepts:

- `.csv`
- `.xlsx`
- `.json`

Limits:

- maximum 200 questions per import
- maximum 5 MB file size

### Recommended Import Method

Use the template from the admin UI instead of creating headers from memory.

Steps:

1. open the target practice set
2. select `Upload questions`
3. select `Download template`
4. fill the file
5. upload the completed file
6. review the preview and validation messages
7. confirm the import only when no blocking errors remain

If you are relying on automatic positions, keep the spreadsheet rows in the same order you want candidates to see.

### How To Write The File Correctly

Before uploading:

- use one row for one question only
- write the complete question exactly as candidates should see it
- fill all four options
- make sure the four options are different from one another
- set `correct_answer` to `A`, `B`, `C`, or `D`
- confirm that the chosen correct answer letter matches the real correct option
- include the explanation before publication
- keep positions unique
- keep the rows in the final order you want candidates to see if you are relying on file order
- review spelling, punctuation, and answer consistency before upload

### Import Columns

The standard template includes:

- `position`
- `question_text`
- `option_a`
- `option_b`
- `option_c`
- `option_d`
- `correct_answer`
- `explanation`
- `reference`
- `difficulty`

The `position` column controls question order.

If the position field is left blank during import, positions are assigned from the file order starting after the current last question in the set.

### Import Validation Rules

The import checks for:

- missing required fields
- invalid or duplicate positions
- repeated question text
- repeated answer options
- invalid correct answer letters
- invalid difficulty values
- conflicts with existing questions in the same set

If one row fails, do not assume partial success. Review the preview and fix the file first.

## Publishing Checklist

Before publishing a practice set, confirm all of the following:

- the expected number of questions is present
- question positions are correct and not duplicated
- every question has four distinct answer options
- every correct answer is set correctly
- every explanation is present and readable
- the order of questions is final
- recent imports or corrections have been previewed

Use review as the final check stage, not as a storage state for unfinished work.

## Activity Guide

Use `Activity` when you need to verify:

- who created or changed content
- whether an import happened
- whether a module or set was updated
- when a correction was published

Treat the activity log as the administrative record of recent actions.

## Deleting, Archiving, And Stopping Sales

These actions are not the same.

### Turn off sales

Use `Available for purchase` when you want to stop new purchases but keep existing access intact.

### Archive

Use archive when content should no longer be available for new use, but history must remain.

### Delete

Delete is only for content with no meaningful history.

In general:

- delete only unused drafts or empty unused content
- archive anything that may already be part of candidate history

## Common Admin Tasks

### Launch A New Module

1. create the module
2. keep it in `Draft` while preparing content
3. create a practice set
4. add questions manually or import them
5. resolve readiness issues
6. send the set for review
7. publish the set
8. confirm the module settings
9. enable `Available for purchase` only when ready

### Add Another Practice Set To An Existing Module

1. open the module
2. select `Add practice set`
3. set the target question count
4. add or import questions
5. complete review checks
6. publish when ready

### Fix A Wrong Published Question

1. open the published practice set
2. find the question
3. select `Correct`
4. save the correction
5. preview the correction
6. publish the correction

### Stop New Sales For A Module

1. open the module
2. open `Settings`
3. turn off `Available for purchase`
4. save

### Remove An Empty Unused Module

Only do this if the module has no meaningful usage history.

If the delete action is available:

1. open the module
2. use the delete action in the unused module area
3. confirm carefully

## Troubleshooting

### A Set Will Not Publish

Check:

- question count
- explanations
- duplicate question text
- option validity
- readiness errors

### An Import Is Blocked

Check:

- required columns
- duplicate positions
- duplicate questions
- answer option duplication
- difficulty values
- file size

### A Module Cannot Be Retired

If the module still has active access or live commercial impact, stop sales first and review its current state before trying again.

### A Published Question Needs A Small Edit

Do not try to treat it like a draft question. Use `Correct`.

## Recommended Admin Habits

- name modules clearly and consistently
- keep unfinished work in draft
- preview before publishing
- use imports for large prepared batches
- use manual entry for careful one-off edits
- review the activity log after major actions
- avoid last-minute publishing without checking readiness

## Quick Reference

### Use Draft when

- the content is incomplete
- you still need to edit questions
- you are still importing or checking content

### Use In review when

- content is complete
- you are performing final checks

### Use Published when

- candidates should be able to use the set

### Use Archived when

- the set should no longer start new attempts
- history still needs to remain available

## Final Reminder

The safest admin workflow is:

1. create privately
2. complete the content
3. validate carefully
4. publish deliberately
5. correct published mistakes through revisions
6. archive instead of deleting historical content

When unsure, choose the safer path that preserves history.
