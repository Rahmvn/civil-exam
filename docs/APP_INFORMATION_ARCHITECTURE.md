# App Information Architecture

## 1. Purpose

This document defines the information architecture for the Federal Public Service Promotion Exam app as it exists today and as it should be clarified before future screen-by-screen UI redesign.

This is not a visual design document.

This document is for:

- screen planning
- UX writing consistency
- access-state consistency
- future redesign sequencing
- backend/frontend responsibility clarity

It should help the team redesign each authenticated and public screen without changing the underlying product rules by accident.

## 2. Product Context

FPS Exam Practice is a structured exam-practice product for Nigerian civil servants preparing for promotion examinations.

The app is not a general learning platform and not a content marketplace.

The core product promise is:

- choose a module
- start a batch
- answer questions
- see a result
- review mistakes
- continue or unlock more access

The product is batch-based, not free-question-counter-based.

## 3. Current Product Rules

### Access rules

- Free users can access only `Batch 1` of one selected module.
- The free module is selected only after explicit confirmation of `Start free batch`.
- Free users get one retry if they fail the first attempt.
- Free users must unlock full access after passing Batch 1.
- Free users must unlock full access after failing twice.
- Free users cannot start another module once a free module is selected.
- Free users cannot start Batch 2+.
- Paid users can access any published batch in any module at any time.
- Paid users are not blocked by progress.
- Progress affects recommendations only.
- Draft, archived, unpublished, or unavailable batches are not startable.

### Content status rules

- `public-financial-management` Batch 1 and Batch 2 are live.
- `public-service-rules` Batch 1 to Batch 7 are live.
- `public-financial-management` Batch 3 is `Coming Soon` because it has only `20/30` questions and is intentionally on hold.
- `current-affairs` is `Coming Soon` / fact-check hold.
- Oral Prep is a future separate section and must not be treated like CBT content.

## 4. Architecture Principles

### 4.1 Backend owns access

The backend must decide:

- whether a batch is startable
- whether payment is required
- whether retry is allowed
- what the batch state is
- what next action should appear after submission

The frontend must display the backend state, not invent access policy locally.

### 4.2 Recommendation is not access control

Recommendation should influence:

- copy
- ordering
- emphasis
- “recommended next” labels

Recommendation must not:

- hide valid paid-user options
- block published batches
- force paid users into strict sequential practice

### 4.3 Mobile-first content hierarchy

Most users are expected to use phones.

So each screen should prioritize:

- one clear page purpose
- one main action
- calm supporting information
- no crowded header
- no repeated copy
- no fake analytics

### 4.4 Official and trustworthy tone

Tone should be:

- calm
- professional
- direct
- helpful
- not desperate
- not marketing-heavy
- not playful

## 5. User Types And Experience Model

### 5.1 Logged-out visitor

Access rights:

- can view public landing/auth prompts only

Locked areas:

- dashboard
- practice
- review
- access/account content

Main CTA:

- `Sign in`

Secondary CTA:

- `Create account`

Message tone:

- clear
- welcoming
- practical

Dashboard behavior:

- not visible

Practice behavior:

- not visible

Result/review behavior:

- not visible

### 5.2 New free user

Definition:

- authenticated
- profile incomplete or newly completed
- no selected free module
- no attempts

Access rights:

- may complete onboarding
- may choose one module
- may start Batch 1 after confirmation

Locked areas:

- all Batch 2+
- full access benefits

Main CTA:

- `Start Batch 1`

Secondary CTA:

- `Unlock full access`

Message tone:

- encouraging
- simple
- not pushy

Dashboard behavior:

- explain free access clearly
- show available modules
- show Coming Soon modules calmly

Practice behavior:

- should start only after confirmation

Result/review behavior:

- not yet relevant before first attempt

### 5.3 Free user with no selected module

Access rights:

- can choose any one module’s Batch 1 if published

Locked areas:

- other batches
- paid-only continuation

Main CTA:

- `Start Batch 1`

Secondary CTA:

- `Unlock full access`

Message tone:

- “choose one module to begin”

Dashboard behavior:

- module cards should show batch availability
- other modules should not appear locked yet

Practice behavior:

- direct practice route should not silently lock anything

Result/review behavior:

- no special state yet

### 5.4 Free user with selected module

Access rights:

- Batch 1 of selected module only

Locked areas:

- other modules
- Batch 2+

Main CTA:

- `Continue Batch 1` or `Retry Batch 1`

Secondary CTA:

- `Unlock full access`

Message tone:

- informative
- not punitive

Dashboard behavior:

- selected module should be clearly recognizable
- non-selected modules should show payment lock

Practice behavior:

- selected module Batch 1 reload should work

Result/review behavior:

- should explain retry or unlock outcome clearly

### 5.5 Free user after failed first attempt

Access rights:

- one retry on the same free Batch 1

Locked areas:

- other modules
- Batch 2+

Main CTA:

- `Retry Batch 1`

Secondary CTA:

- `Unlock full access`

Message tone:

- supportive
- not shaming

Dashboard behavior:

- should highlight retry availability

Practice behavior:

- same batch questions, reshuffled order

Result/review behavior:

- next action should be retry, not next batch

### 5.6 Free user after failed second attempt

Access rights:

- review past result
- access payment page

Locked areas:

- further practice in free module
- other modules

Main CTA:

- `Unlock full access`

Secondary CTA:

- `Back to dashboard`

Message tone:

- firm but calm

Dashboard behavior:

- module should show payment lock

Practice behavior:

- should not be allowed back into the batch

Result/review behavior:

- should clearly explain retry is exhausted

### 5.7 Free user after passing Batch 1

Access rights:

- review the passed result
- access payment page

Locked areas:

- Batch 2+
- other modules

Main CTA:

- `Unlock full access`

Secondary CTA:

- `Back to dashboard`

Message tone:

- positive
- completion-focused

Dashboard behavior:

- selected free batch should show passed state
- next available action should be unlock

Practice behavior:

- should not start Batch 2 without payment

Result/review behavior:

- should not offer next batch to free user

### 5.8 Paid user with no attempts

Access rights:

- any published batch in any module

Locked areas:

- only unpublished/draft/archived/unavailable batches

Main CTA:

- `Start Batch N`

Secondary CTA:

- `Review` only if prior history exists

Message tone:

- open-ended
- capable

Dashboard behavior:

- show all published batch choices
- recommendation may emphasize one batch but must not hide others

Practice behavior:

- explicit batch start should work from any published batch

Result/review behavior:

- not applicable before first attempt

### 5.9 Paid user with attempts/progress

Access rights:

- any published batch in any module
- retries
- review history

Locked areas:

- only unpublished/draft/archived/unavailable batches

Main CTA:

- `Continue`, `Retry`, or `Start Batch N` depending on context

Secondary CTA:

- `Review`

Message tone:

- informative
- progress-aware

Dashboard behavior:

- show recommendation
- show recent attempts
- show per-batch state
- keep all published batches available

Practice behavior:

- retry or jump-in should both work

Result/review behavior:

- should offer retry and, where relevant, next published batch

## 6. Main App Sections

### 6.1 Dashboard

Purpose:

- main product home
- show access status
- show module and batch availability
- help user decide what to do next

Information shown:

- welcome
- access summary
- module list
- recommended next step
- recent attempts
- review queue

Primary action:

- start / continue / retry a batch

Secondary actions:

- unlock full access
- open review
- go to profile

What should not be shown:

- fake analytics
- fake readiness counts
- repeated headings
- grade level as content filter

Mobile priority:

- one clear top summary
- one module list
- one recent/history area

Free-user version:

- selected free module matters
- locked modules show access prompt

Paid-user version:

- all published batches accessible

### 6.2 Modules / Module Area

Purpose:

- show modules as exam content groups

Information shown:

- module title
- description
- published batch list
- progress summary
- batch cards

Primary action:

- choose a batch

Secondary actions:

- review
- unlock

What should not be shown:

- random marketing copy
- fake percentages when no attempts exist

Mobile priority:

- module title
- state
- top available batch cards

Free-user version:

- payment lock on non-selected or later batches

Paid-user version:

- all published batches visible and selectable

### 6.3 Practice

Purpose:

- complete one batch attempt

Information shown:

- module
- batch number
- question position
- question text
- answer options
- answered count
- timer
- question map

Primary action:

- answer and submit batch

Secondary actions:

- previous/next
- flag question
- return to modules

What should not be shown:

- explanations during answering
- answer key during practice
- unrelated dashboard clutter

Mobile priority:

- question
- options
- navigation
- submit

Free-user version:

- same screen, but batch selection is limited upstream

Paid-user version:

- same screen, broader accessible batch range

### 6.4 Result

Purpose:

- show the outcome of the just-submitted batch

Information shown:

- score
- pass/fail
- pass mark
- correct/wrong counts
- attempt number
- next action

Primary action:

- retry / next batch / unlock full access

Secondary actions:

- review
- back to dashboard

What should not be shown:

- dense analytics
- hidden next step

Mobile priority:

- score
- status
- next action

Free-user version:

- no next-batch CTA

Paid-user version:

- next published batch CTA when relevant

### 6.5 Review

Purpose:

- help users learn from mistakes

Information shown:

- attempt summary
- question list
- chosen answer
- correct answer
- explanation
- reference note

Primary action:

- retry or continue

Secondary actions:

- back to dashboard
- unlock access

What should not be shown:

- irrelevant stats
- payment pressure for paid users

Mobile priority:

- top summary
- answer cards
- action buttons

Free-user version:

- retry or unlock path

Paid-user version:

- retry and possibly next batch

### 6.6 Access / Payment

Purpose:

- explain free vs full access
- initialize payment

Information shown:

- current access state
- what full access unlocks
- pricing
- support note

Primary action:

- unlock full access

Secondary actions:

- return to dashboard

What should not be shown:

- desperate upsell copy
- misleading scarcity

Mobile priority:

- status
- price
- benefits
- CTA

Free-user version:

- explain current usage and restriction

Paid-user version:

- show active status and expiry if available

### 6.7 Profile / Account Menu

Purpose:

- identity and account information

Information shown:

- name
- grade level
- profile details
- sign out

Primary action:

- view account details

Secondary actions:

- admin access if applicable

What should not be shown:

- practice content controls

Mobile priority:

- compact account summary

### 6.8 Empty States

Purpose:

- prevent blank screens
- explain what is missing

Information shown:

- short explanation
- one next step

Primary action:

- back to dashboard or access

Secondary actions:

- none unless useful

What should not be shown:

- raw errors

### 6.9 Error States

Purpose:

- explain failure without exposing backend internals

Information shown:

- friendly reason
- one recovery action

Primary action:

- retry / back / unlock depending on context

Secondary actions:

- contact support later if needed

What should not be shown:

- SQL/RPC raw messages

## 7. Dashboard Information Structure

Recommended hierarchy:

1. welcome / user state
2. access badge or access card
3. selected free module summary if applicable
4. recommended next action
5. module cards
6. batch cards inside each module
7. recent attempts
8. review queue / weak areas
9. support footer

### 7.1 Welcome / user state

Should show:

- greeting
- current high-level state

Examples:

- incomplete profile
- modules available
- modules being prepared
- continue from your latest batch

### 7.2 Access badge / access card

Should show:

- free or full access
- selected free module if any
- expiry for paid users if relevant

Should not dominate the page when content is unavailable.

### 7.3 Selected free module

Should show only when relevant:

- selected module name
- Batch 1 restriction
- retry availability if applicable

### 7.4 Recommended next action

Purpose:

- guide without blocking

May recommend:

- Start Batch 1
- Retry Batch 1
- Continue Batch N
- Unlock full access

For paid users, this is advisory only.

### 7.5 Module cards

Each module card should summarize:

- what the module is
- what is live
- how the user is doing
- what they can do next

### 7.6 Batch cards

Batch cards are the access-control detail layer.

They should be nested inside the module card or module section.

For paid users, all published batch cards should be visible and actionable.

### 7.7 Progress summary

Use only real data:

- last score
- attempts count
- recent attempts
- review queue items

Avoid fake graphs.

### 7.8 Live / Coming Soon indicators

Needed because modules are not equally complete.

Current expected behavior:

- PFM Batch 1 live
- PFM Batch 2 live
- PFM Batch 3 Coming Soon
- PSR Batch 1 to 7 live
- Current Affairs Coming Soon

### 7.9 Payment CTA

Should appear:

- when locked state exists
- when free progression is exhausted
- in the access section

Should not overwhelm paid users or no-content states.

### 7.10 Resume / Retry / Review actions

Dashboard should support:

- resume active/recommended batch
- retry failed batch
- review completed attempt

## 8. Module Card Structure

### 8.1 Public Financial Management

Title:

- `Public Financial Management`

Description:

- financial regulations, expenditure control, approvals, accountability

Live batch count:

- 2 live

Coming Soon state:

- Batch 3 Coming Soon

User progress:

- attempts
- best/latest result
- next recommended batch

Access state:

- free user: only Batch 1 if selected
- paid user: any live batch

CTA buttons:

- start / continue / retry / unlock / coming soon

### 8.2 Public Service Rules

Title:

- `Public Service Rules`

Description:

- conduct, discipline, appointments, service-wide rules

Live batch count:

- 7 live

Coming Soon state:

- none required for current live set

User progress:

- same structure as PFM

Access state:

- free user: only Batch 1 if selected
- paid user: any live batch

CTA buttons:

- start / continue / retry / unlock

### 8.3 Current Affairs

Title:

- `Current Affairs`

Description:

- governance, history, civic and general knowledge content

Live batch count:

- 0 live

Coming Soon state:

- fact-check hold

User progress:

- none until published

Access state:

- unavailable for all users

CTA buttons:

- `Coming soon`

### 8.4 Oral Prep Later

Title:

- `Oral Prep`

Description:

- future non-CBT oral/interview preparation resource

Live batch count:

- not applicable yet

Coming Soon state:

- future section

Access state:

- excluded from current CBT flow

CTA buttons:

- not currently shown as a practice batch module

## 9. Batch Card Structure

Each batch card should define:

- Batch number
- Status
- Question count if known
- Best score
- Last attempt date
- Attempts count
- Primary button
- Secondary button if useful
- Lock reason when locked

### Status set

- `Available`
- `Passed`
- `Failed`
- `Locked`
- `Coming Soon`

### 9.1 Free user Batch 1

Status options:

- available
- failed with retry
- passed then locked for continuation

Primary button:

- `Start free batch`
- `Retry Batch 1`
- `Unlock full access`

Secondary button:

- `Review`

Lock reason examples:

- free module not selected yet
- retry exhausted
- passed free batch

### 9.2 Free user Batch 2+

Status:

- locked

Primary button:

- `Unlock full access`

Lock reason:

- later batches require full access

### 9.3 Paid user published batch

Status:

- available / passed / failed

Primary button:

- `Start Batch N`
- `Continue Batch N`
- `Retry Batch N`

Secondary button:

- `Review`

Lock reason:

- none

### 9.4 Coming Soon batch

Status:

- coming soon

Primary button:

- disabled `Coming soon`

Lock reason:

- not enough published questions / fact-check hold / unpublished

### 9.5 Completed passed batch

Free user:

- state leads to unlock

Paid user:

- review and retry remain available

### 9.6 Completed failed batch

Free user:

- retry once or unlock after retry loss

Paid user:

- retry anytime
- next published batch may still be available

## 10. Practice Screen Information

### Required information

- module name
- batch number
- question number
- question text
- options A-D
- selected answer
- answered count
- unanswered count
- progress indicator
- question navigation
- submit button

### Supporting information

- pass mark
- access state label
- timer

### Primary action

- submit batch

### Secondary actions

- previous
- next
- jump via question map
- flag question
- back to modules

### Exit/back behavior

- returning to modules should be available
- but the product should not silently reset access state

### Locked/error state

If no eligible batch context exists:

- show friendly explanation
- direct user back to dashboard/modules

### Product decisions for practice

Timer now or later:

- timer exists now and should remain part of the architecture

Can unanswered questions be submitted:

- yes, but current UI effectively requires at least one answered question
- unanswered questions should count as unanswered, not crash submission

Should explanations show during practice:

- no

Can users jump between questions:

- yes

## 11. Result Screen Information

### Required information

- score percentage
- passed / failed status
- correct count
- wrong count
- unanswered count if captured
- pass mark
- module name
- batch number
- attempt number

### Main next action area

Should always show one dominant next step based on backend `next_action`.

### Optional actions

- retry
- review
- unlock full access
- next batch for paid users
- back to dashboard

### Scenarios

#### Free pass

- status: passed
- main CTA: `Unlock full access`

#### Free fail first attempt

- status: failed
- main CTA: `Retry Batch 1`

#### Free fail second attempt

- status: failed
- main CTA: `Unlock full access`

#### Paid pass with next batch

- status: passed
- main CTA: `Start Batch N+1`

#### Paid fail with next batch

- status: failed
- main CTA: `Retry Batch N`
- secondary: `Try Batch N+1`

#### Paid last batch complete

- status: passed
- main CTA: `Back to dashboard`

## 12. Review Screen Information

### Attempt summary

Should show:

- module
- batch
- score
- pass mark
- attempt number
- completion date

### Filters

Possible future filters:

- all
- wrong only
- correct only

Useful later, but not required for the first redesign pass.

### Answer card structure

Each reviewed question should show:

- question text
- user answer
- correct answer
- explanation
- reference
- correctness state

### Score recap

Should remain visible near the top.

### Actions

Free user:

- retry or unlock

Paid user:

- retry
- next published batch if relevant

Always:

- back to dashboard

## 13. Access / Payment Page Information

### Purpose

- explain what access means
- explain what free users have already used
- provide payment action

### Information to show

- current status
- what full access unlocks
- modules and batches included
- unlimited retries
- review history
- progress tracking
- price
- trust/support note

### Paystack CTA

- one clear payment action
- no clutter around it

### Trust / security note

- payment is verified
- if access does not reflect, keep reference and return after verification

### Pricing

- show current active pack price
- presentation should be factual, not salesy

### What happens after payment

- full access becomes active
- all published modules and batches become available

### What free users have already used

- selected free module if any
- whether retry remains

### Tone

- official
- useful
- not desperate

## 14. Empty And Error States

### No attempts yet

Message:

- `Your recent attempts and review items will appear here after your first submitted batch.`

### No published questions

Message:

- `Questions for this module are not available yet.`

### Batch Coming Soon

Message:

- `This batch is not available yet.`

For PFM Batch 3:

- it should remain unavailable until enough content exists

### Current Affairs hold

Message:

- `Current Affairs batches are being prepared and reviewed before release.`

### Free module not selected yet

Message:

- `Start your free batch from the dashboard to continue.`

### Free module locked to another module

Message:

- `Your free batch is already locked to another module. Unlock full access to continue.`

### Retry exhausted

Message:

- `Unlock full access to continue.`

### Passed free batch

Message:

- `You passed the free batch. Unlock full access to continue.`

### Paid user no next batch

Message:

- `You passed the latest published batch in this module.`

### Network/API failure

Message:

- `We could not load this right now. Please try again.`

### Onboarding incomplete

Message:

- `Complete your details to start practice.`

### Payment not confirmed yet

Message:

- `We could not confirm your payment yet. Please try again.`

## 15. Current Screen Mapping

### Existing key files

- `src/pages/Dashboard.jsx`
- `src/pages/Practice.jsx`
- `src/pages/Review.jsx`
- `src/pages/Access.jsx`
- `src/components/AppFrame.jsx`
- `src/lib/appApi.js`
- `src/lib/errors.js`

### Existing behavior map

- `Dashboard.jsx`
  - main authenticated home
  - free-batch confirmation modal
  - module and batch card rendering
  - recent attempts and review queue
- `Practice.jsx`
  - batch session loading and submission
  - explicit `?batch=N` support
- `Review.jsx`
  - result summary + full answer review
  - next action handling
- `Access.jsx`
  - access summary + Paystack initialization
- `AppFrame.jsx`
  - authenticated shell
  - desktop nav
  - bottom mobile nav

## 16. Future Redesign Sequence

Recommended order for later UI redesign:

1. App shell / navigation
2. Dashboard overview
3. Module card + batch card system
4. Practice screen
5. Result / review summary layer
6. Full review screen
7. Access / payment screen
8. Profile / account details

Reason:

- the shell and dashboard define navigation and hierarchy
- practice/result/review depend on already-agreed batch vocabulary
- access page should reflect the same architecture language

## 17. Bottom Line

The app structure should now be understood as:

- one authenticated study home
- three CBT modules at different release states
- batch-based access and progression
- backend-owned access rules
- recommendation-driven, not progress-blocked, paid experience
- clear separation between:
  - available
  - locked
  - coming soon
  - retry
  - review
  - unlock

This architecture should be preserved during future redesign work so that the UI becomes clearer without changing the product rules underneath it.
