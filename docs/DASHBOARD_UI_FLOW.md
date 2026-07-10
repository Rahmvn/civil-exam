# Dashboard UI Flow

## Scope

This document defines the dashboard UI flow for FPS Exam Practice before the next dashboard redesign pass.

This is a planning document only.

This document does not:

- implement UI
- edit React components
- change backend logic
- change Supabase migrations
- change payment logic
- change access rules
- import or publish content

The dashboard must remain:

- minimal
- accurate
- mobile-first
- serious
- calm

The dashboard is not the review page.

The dashboard should answer only:

1. What is my access status?
2. What should I do next?
3. What modules or batches are available?
4. What did I recently attempt?
5. Where do I go to review more?

The dashboard must not become:

- a full review history page
- an analytics-heavy page
- a marketplace
- a wall of repeated batch cards
- a home for fake metrics

## Inputs Preserved

This document aligns with:

- `docs/APP_INFORMATION_ARCHITECTURE.md`
- `docs/APP_USER_AND_SCREEN_FLOWS.md`
- `docs/UI_VISUAL_DIRECTION.md`
- `docs/BATCH_ACCESS_AND_PROGRESSION_POLICY.md`

It preserves these product rules:

- Free users can access only Batch 1 of one selected module.
- The free module is locked only after explicit Start Free Batch confirmation.
- Free users get one retry only if the first free attempt fails.
- Free users must unlock full access after passing Batch 1.
- Free users must unlock full access after failing twice.
- Free users cannot access another module after choosing a free module.
- Free users cannot access Batch 2+.
- Paid users can access any published batch in any module at any time.
- Paid users are not blocked by progress.
- Progress affects recommendation only, not paid-user access.
- Draft, archived, unpublished, or hold-state batches are not startable.

# 1. Dashboard Principles

- The dashboard is a calm home screen.
- The dashboard should not show every detail.
- The dashboard should not show all review records.
- The dashboard should not show heavy analytics.
- The dashboard should not invent data.
- The dashboard should only show real backend data or documented content status.
- The dashboard should guide the user to one next action.
- The dashboard should expose modules clearly.
- The dashboard should remain useful for both free and paid users.
- The dashboard should not block paid users based on progress.
- The dashboard should preview review activity, not replace Review.
- The dashboard should prefer compact summaries over repeated nested cards.

Operational rule:

- If information belongs to attempt history, filters, score trends, or explanation review, it belongs to Review, not Dashboard.

# 2. Dashboard Visual Structure

## Mobile order

The dashboard mobile order should be:

1. Top greeting/header
2. Access status card
3. Recommended next action card
4. Modules overview
5. Recent attempts preview
6. Review shortcut if needed

## Hierarchy

### A. Header

- greeting
- user name
- access/avatar area
- no heavy nav inside content
- bottom nav handles main app navigation

### B. Access status card

- compact
- clear
- one status: `Free Access` or `Full Access`
- one short explanation
- one CTA only if needed

### C. Recommended next action card

- one card only
- one primary CTA
- one secondary CTA maximum
- backend-driven
- must never hide other paid-user options

### D. Modules overview

- compact cards
- shows available modules
- shows live/coming-soon status
- does not show every batch by default

### E. Recent attempts preview

- max 2 or 3 attempts
- compact rows or small cards
- `Review` action
- `View all reviews` link

## Visual direction rules

- Bright, quiet surfaces
- White cards on off-white background
- Deep green only for true primary emphasis
- Soft borders
- Limited badge usage
- One or two useful visuals only, such as a score ring or slim progress bar
- No large dashboard-stat board
- No stacked analytics panels

# 3. Header Flow

For all authenticated users:

- show greeting
- show first name if available
- show compact access/avatar area

Example:

`Welcome, Bola`

Header rules:

- Keep the greeting short.
- Do not repeat a large `Dashboard` title block under the header.
- Do not add grade-level-as-access messaging.
- Do not place module filters or heavy controls in the header area.
- Let bottom navigation handle major movement across Home, Modules, Practice, Review, and Account.

# 4. Access Status Card Flow

## Shared rules

- Exactly one access state is shown.
- Copy should be one short paragraph or two short lines.
- One main CTA at most.
- Access copy should explain entitlement, not every rule in full.
- Upsell copy should stay calm and factual.

## Free user: no selected module

Title:

`Free Access`

Copy:

`Choose one module and try Batch 1 for free.`

Main CTA:

`Choose free module`

Secondary:

- `Unlock Full Access` only if needed and visually subdued

Display rules:

- No selected module yet
- Do not lock other modules before confirmation
- PFM Batch 1 and PSR Batch 1 can be presented as valid free choices if published

## Free user: selected module

Title:

`Free Access`

Copy:

`Your free module is Public Financial Management. Batch 1 is available based on your attempt state.`

Show:

- selected module
- retry status if relevant
- unlock CTA if relevant

Avoid:

- long explanation
- aggressive upsell

## Free user: after pass

Title:

`Free Access`

Copy:

`You passed your free batch. Unlock full access to continue with other published batches.`

Main CTA:

`Unlock Full Access`

Secondary:

`Review latest attempt`

## Free user: after first failed attempt

Title:

`Free Access`

Copy:

`You have one retry available for your free batch.`

Main CTA:

`Retry Batch 1`

Secondary:

`Review latest attempt`

## Free user: after second failed attempt

Title:

`Free Access`

Copy:

`Your free attempts are complete. Unlock full access to continue.`

Main CTA:

`Unlock Full Access`

Secondary:

`Review latest attempt`

## Paid user

Title:

`Full Access`

Copy:

`All published batches are available. Progress recommends your next step, but does not lock access.`

Optional small line:

- `Active until [date]` only when real entitlement expiry exists

Main CTA:

- usually none
- or `Manage Access` only if that route is intentionally exposed

# 5. Recommended Next Action Flow

There should be one recommendation card only.

## Supported recommendation states

### 1. Complete your account

- shown if profile is incomplete
- CTA: `Complete account`

### 2. Choose your free module

- free user
- no selected module
- CTA: `Choose module`

### 3. Start free Batch 1

- free user
- selected module
- no attempt yet
- CTA: `Start Batch 1`

### 4. Retry free Batch 1

- free user
- failed first attempt
- CTA: `Retry Batch 1`
- secondary: `Review latest attempt`

### 5. Unlock full access

- free user passed Batch 1 or failed twice
- CTA: `Unlock Full Access`
- secondary: `Review latest attempt`

### 6. Start recommended paid batch

- paid user
- CTA: `Start Batch N`
- secondary: `Review latest attempt` if it exists

### 7. Review latest attempt

- use when there is no more urgent start, retry, or unlock action
- CTA: `Review latest attempt`

### 8. Explore modules

- use when there are no attempts and no stronger recommendation
- CTA: `View modules`

## Recommendation rules

- Only one primary CTA
- One secondary CTA maximum
- No competing recommendation cards
- Recommendation must come from real backend access and progress data
- Recommendation must not be invented from client guesses
- Paid users can ignore the recommendation and open any published batch
- Recommendation should describe the next best action, not every possible action

# 6. Modules Overview Flow

The main dashboard should show module-level cards only.

It should not show a long wall of all batches for all modules on the main dashboard.

## Module card fields

- module title
- short description
- status line
- small progress or best score only when real
- primary CTA

## Module content states

### Public Financial Management

- status: `2 live, 1 coming soon`
- Batch 1 and Batch 2 live
- Batch 3 coming soon

### Public Service Rules

- status: `7 live`
- Batch 1 to Batch 7 live

### Current Affairs

- status: `Coming soon`
- fact-check hold
- not startable

### Oral Prep

- later
- not CBT batch flow
- do not show as active CBT module unless product explicitly wants future visibility

## Module card CTAs

### Paid user

- PFM: `View batches`
- PSR: `View batches`
- Current Affairs: `Coming soon` or `Learn more`
- Oral Prep: `Coming soon` if it is shown at all

### Free user with no selected module

- PFM: `Start Batch 1` or `Choose this module`
- PSR: `Start Batch 1` or `Choose this module`
- Current Affairs: `Coming soon`
- other modules should not look locked before selection

### Free user with selected module

- selected module: `Start`, `Retry`, or `Review Batch 1` depending on state
- non-selected published modules: `Unlock Full Access`
- Current Affairs: `Coming soon`

## Module card density rule

Each module card should feel like a compact summary, not a mini dashboard inside a dashboard.

Avoid putting all of these on the main dashboard at once:

- large progress ring
- four-stat subgrid
- multiple badges
- full batch list
- multiple stacked buttons

# 7. Batch Visibility Rule

## Placement rule

Dashboard:

- does not show all batch cards by default
- may show a compact batch preview only inside:
  - the recommended action card
  - the selected module card
  - an expanded single-module state
- should avoid rendering every batch for every module immediately

Module detail page:

- owns the full batch list for one module
- shows Batch 1, Batch 2, Batch 3, and so on
- is the correct long-term home for detailed batch cards

## Transitional rule

If the app does not yet have a dedicated module detail page:

- the dashboard may temporarily expand only one module at a time
- default should remain collapsed or compact
- only one module should expose full batch detail at once

## Compact batch card structure

```text
Batch 1    Passed
30 questions - 1 attempt - Best 80%
[Retry Batch]
[Review]

Batch 2    Available
30 questions - Not attempted
[Start Batch 2]

Batch 3    Coming Soon
More questions coming soon
[Disabled]
```

## Batch status labels

- Available
- Passed
- Failed
- Retry Available
- Locked
- Coming Soon
- Not Published

# 8. Recent Attempts Preview Flow

Dashboard recent attempts must stay small.

## Rules

- show max 2 attempts by default
- max 3 only if the screen still feels clean
- latest attempts only
- no repeated large cards
- no full explanations
- no analytics here

## Row structure

```text
PFM - Batch 1
80% - Passed - 7 Sep 2026
[Review]

PSR - Batch 4
60% - Failed - 6 Sep 2026
[Review]
```

At the end:

`View all reviews`

## Empty state

Title:

`No attempts yet`

Copy:

`Submit a practice batch to see your review history.`

CTA:

- `Start practice`
- or `View modules`

# 9. Review Architecture Decision

This decision should be treated as fixed for the next redesign phase.

## Dashboard owns

- latest 2 or 3 attempts only
- lightweight review preview
- a link to Review

## Dashboard does not own

- full attempt history
- attempt filters
- question explanations
- performance summaries
- deep review analytics

## Review page owns

- full attempt history
- filters:
  - All
  - Passed
  - Failed
  - Module
- minimal real analytics:
  - average score
  - attempts count
  - passed count
  - failed count
  - score trend if real
  - module performance if real
- links to Review Detail

## Review Detail owns

- one submitted attempt
- score summary
- all, wrong, correct, and unanswered filters
- question-by-question cards
- user answer
- correct answer
- explanation
- recommendation where available
- retry, next, or unlock action

## Transitional note

Until a dedicated Review History page ships, the current `/review` route may temporarily remain the entry point for review. The UI architecture should still treat full history and analytics as Review responsibilities, not Dashboard responsibilities.

# 10. Free User Dashboard States

## A. Free user, no selected module

Header:

`Welcome`

Access:

`Free Access - Choose one module and try Batch 1 for free.`

Recommendation:

`Choose your free module`

Modules:

- PFM and PSR available as free choices
- Current Affairs coming soon
- other modules not locked yet

Recent attempts:

- empty unless the user already has old attempts

## B. Free user, selected module, no attempt

Access:

`Free Access - Your free module is [module].`

Recommendation:

`Start Batch 1`

Modules:

- selected module available
- other modules locked for full access
- Batch 2+ locked

## C. Free user, failed first attempt

Access:

`Free Access - One retry available.`

Recommendation:

`Retry Batch 1`

Recent attempts:

- latest failed attempt preview

## D. Free user, failed second attempt

Access:

`Free Access - Free attempts complete.`

Recommendation:

`Unlock Full Access`

Recent attempts:

- latest attempt preview

## E. Free user, passed Batch 1

Access:

`Free Access - Free batch completed.`

Recommendation:

`Unlock Full Access`

Recent attempts:

- passed attempt preview

# 11. Paid User Dashboard States

## A. Paid user, no attempts

Access:

`Full Access`

Recommendation:

`Start a published batch`

Modules:

- PFM and PSR available
- Current Affairs coming soon

Recent attempts:

- empty state

## B. Paid user with attempts

Access:

`Full Access`

Recommendation:

- start next recommended batch
- or retry a weak batch

Modules:

- all published batches remain available

Recent attempts:

- latest 2 or 3 only

## C. Paid user failed previous batch

Access:

`Full Access`

Recommendation:

`Retry failed batch`

Important:

- still allow access to all other published batches from module cards or module detail

# 12. Data Rules

Dashboard can show only real data from:

- candidate summary
- module batch access rows
- published batch counts
- submitted attempts
- review queue
- entitlement/access state

Dashboard must not show:

- fake module count
- fake batch count
- fake topic analytics
- fake priority support
- fake notifications
- fake averages
- fake review data
- fake access expiry

If data is unknown:

- hide the field
- use `Not attempted`
- use `Coming soon`
- report backend inconsistency if needed

## Dashboard data behavior

- If review queue exists, use it only as a small hint for review activity.
- Do not expose the review queue as a mini history list with many rows.
- Do not show score rings or stat summaries for modules with no real attempt data.
- Do not fallback to outdated seed counts when backend data is wrong.

# 13. Known Content Status

## Public Financial Management

- Batch 1 live
- Batch 2 live
- Batch 3 coming soon

## Public Service Rules

- Batch 1 live
- Batch 2 live
- Batch 3 live
- Batch 4 live
- Batch 5 live
- Batch 6 live
- Batch 7 live

## Current Affairs

- coming soon
- fact-check hold
- not startable

## Oral Prep

- later
- not normal CBT batch content

# 14. Question Count Rules

Expected counts:

- PFM Batch 1: 30
- PFM Batch 2: 30
- PSR Batch 1 to 7: 20 each
- PFM Batch 3: coming soon
- Current Affairs: coming soon

Question count rules:

- Dashboard should not show old seed counts such as 3 questions for PFM.
- If backend returns wrong counts, do not silently hardcode over the backend unless existing trusted metadata supports it.
- If a count looks unreliable, hide the count rather than showing misleading data.
- Report the inconsistency separately when found.

# 15. Mobile Dashboard Wireflow

```text
Mobile dashboard

[Header]
Good morning, Bola
avatar

[Access Status Card]
Full Access
All published batches are available.
Progress recommends your next step, but does not lock access.

[Recommended Next Step]
Start PFM Batch 2
You scored 80% in Batch 1.
[Start Batch 2]
[Review latest attempt]

[Modules]
Public Financial Management
2 live - 1 coming soon
Best 80%
[View batches]

Public Service Rules
7 live
Best 100%
[View batches]

Current Affairs
Coming soon
[Unavailable]

[Recent Attempts]
PFM Batch 1
80% - Passed - 7 Sep 2026
[Review]

PSR Batch 1
60% - Failed - 6 Sep 2026
[Review]

[View all reviews]

[Bottom Nav]
Home - Modules - Practice - Review - Account
```

# 16. Desktop Dashboard Wireflow

Desktop may use two columns:

Left:

- greeting
- recommendation
- modules

Right:

- access card
- recent attempts

Desktop rules:

- mobile remains source of truth
- desktop may widen cards and create a calmer side column
- desktop must not reintroduce extra analytics or decorative dashboard panels

# 17. What To Remove From Current Dashboard

The next dashboard redesign should explicitly simplify or remove these patterns from the current dashboard implementation:

- large repeated recent-attempt cards beyond the most recent 2 or 3
- long walls of batch cards rendered under every module on first load
- excessive pill badges
- separate boxed stat clusters inside module cards when they do not help the next action
- duplicate review shortcut behavior if recent attempts already ends with `View all reviews`
- Current Affairs displayed as if it is live or startable
- any old question count sourced from seed data rather than trusted content status
- top-level metric tiles such as `Published batches`, `Recent attempts`, and `Review items` if they do not change the user decision
- multi-stat module subgrids when a simpler status line plus one real metric would do

## Keep only where justified

These patterns may stay only when they directly help the next decision:

- one score ring for a real score summary
- one slim progress bar for real module progress
- one recommendation badge when backend recommendation exists

# 18. Implementation Recommendation

Recommended next implementation step after this document:

- simplify current `Dashboard.jsx`
- create a compact `ModuleCard` component if useful
- create a compact `RecentAttemptRow` component if useful
- create a compact `AccessStatusCard` component if useful
- keep the full batch list for the later module-detail phase
- limit dashboard recent attempts to 2 or 3
- keep Review detailed for the later Review History and Review Detail phase

## Recommended implementation sequence

1. Reduce dashboard content to the agreed hierarchy.
2. Collapse module cards to summary mode by default.
3. Move full batch visibility to module detail or single-module expansion.
4. Limit recent attempts preview.
5. Add a clear `View all reviews` transition to Review.
6. Keep analytics and question explanations out of Dashboard.

# 19. Final Summary

## Final dashboard role

The dashboard is the authenticated study home. It should communicate access status, recommended next action, available modules, a small recent-attempt preview, and a path into Review. It should not become a history screen or analytics surface.

## Final review architecture

- Dashboard previews
- Review owns history and filters
- Review Detail owns explanations and per-question learning

## Free dashboard flow

- no selected module: choose one free module
- selected module: start or retry Batch 1
- passed or exhausted: unlock full access

## Paid dashboard flow

- show full access clearly
- recommend one next batch
- keep all published batches available
- preview only the latest attempts

## Minimal mobile structure

- header
- access card
- recommended next action
- module summaries
- recent attempts preview
- review link
- bottom nav

## What Codex should implement next

Codex should implement a simplified dashboard that follows this document exactly:

- compact access card
- single recommendation card
- compact module overview
- no default wall of all batch cards
- small recent-attempt preview
- clear handoff to Review for full history and explanations
