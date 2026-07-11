# Review UI Flow

## 1. Purpose

The review experience should help the user:

- reopen past submitted attempts quickly
- understand exactly what happened in one attempt
- learn from wrong or unanswered questions
- decide the next sensible action without friction

The review experience should feel:

- calm
- serious
- mobile-first
- study-focused
- visually aligned with the current dashboard and module direction

It should not feel:

- like a report dump
- like a fintech analytics dashboard
- like a noisy admin table
- like a result-only celebration screen

## 2. Product Direction

Review should be split into two connected layers:

1. `Review History`
2. `Review Detail`

A light `Review Insights` section should live inside `Review History`, not as a separate route for now.

This matches the existing product direction in:

- `docs/APP_INFORMATION_ARCHITECTURE.md`
- `docs/APP_USER_AND_SCREEN_FLOWS.md`
- `docs/UI_VISUAL_DIRECTION.md`
- `docs/PRODUCT_BLUEPRINT.md`

## 3. Current State Vs Target

## Current state

Current `/review` behavior is a merged screen that combines:

- result summary
- full answer review
- small review queue section

Current strengths:

- attempt review data already exists
- latest-attempt review already works
- dashboard already links into review
- contextual next actions already exist

Current weaknesses:

- no true review history page yet
- no clear distinction between result and review detail
- no answer-state filters
- no compact attempt index for reopening old attempts
- no clear insights layer
- no strong visual hierarchy for study-oriented review

## Target state

The `Review` tab should open `Review History`.

From there, the user can open one attempt into `Review Detail`.

The structure should become:

1. `Review History`
2. `Review Detail`

Optional later refinement:

3. richer `Review Insights` inside history

## 4. Route Model

## Now

- `/review`
- `/review?attempt=...`

## Recommended near-term structure

- `/review`
  - review history default state
- `/review?attempt=...`
  - review detail state for one attempt

This keeps route safety simple and avoids backend changes right now.

## Future optional structure

- `/review`
- `/review/:attemptId`

This can wait until the review system is more mature.

## 5. Review History

## Goal

Help users reopen past attempts fast and understand where attention is needed.

## Entry points

- bottom-nav `Review`
- dashboard recent attempts
- module or batch review action
- result CTA after submit

## Primary jobs

- show recent submitted attempts
- show lightweight progress context
- let the user open any attempt quickly
- surface retry or next-batch actions where helpful

## Information to show

### A. Top summary strip

Keep this concise and useful.

Recommended content:

- page title: `Review`
- one-line support copy
- one compact score ring or score summary
- average score
- passed attempts count
- failed attempts count

This is not a giant hero card. It should feel like a compact header strip.

### B. Insights section

Keep this real and minimal.

Recommended first-pass content:

- average score
- pass rate
- recent score trend
- weak-area or module performance bars if data is sufficient

Recommended visuals:

- one moderate score ring
- one thin trend line
- a few slim horizontal bars

Do not add:

- stacked donuts
- decorative charts
- fake confidence metrics
- overcrowded analytics tiles

### C. Filters

Recommended first-pass filters:

- `All`
- `Passed`
- `Failed`
- `Recent`

Recommended later filters:

- module filter
- wrong-heavy

Filters should be compact chips or segmented control, not a heavy toolbar.

### D. Attempt list

Each attempt card should show:

- module name
- batch number
- score percent
- pass/fail state
- correct / wrong / unanswered counts
- submitted date
- attempt number

Primary action:

- `Review`

Secondary action:

- `Retry Batch`
- `Start Next Batch`
- `Unlock Full Access` when relevant for free users

## Attempt card structure

Each attempt card should feel compact, direct, and mobile-friendly.

Recommended hierarchy:

1. top row
- module
- batch
- pass/fail badge

2. middle row
- score emphasis
- compact counts
- submitted date

3. action row
- primary review action
- contextual secondary action

## Attempt card visual tone

- white card
- subtle border
- rounded corners
- strong score emphasis
- calm state badges
- no large paragraphs

## Empty state

Recommended content:

- title: `No attempts yet`
- support line: `Complete a batch and your reviews will appear here.`
- CTA: `Start Practice`

## 6. Review Detail

## Goal

Turn one submitted attempt into a calm, readable study session.

## Entry points

- review history
- dashboard recent attempts
- batch card review action
- result CTA after submit

## Primary jobs

- summarize the attempt clearly
- help the user inspect mistakes question by question
- help the user filter to the most useful answers
- provide the right next action

## Top structure

### A. Compact attempt summary

This should stay near the top and feel important but not oversized.

Recommended content:

- module
- batch
- score percent
- pass/fail state
- pass mark
- correct count
- wrong count
- unanswered count
- completion date
- attempt number

Recommended actions:

- `Retry Batch`
- `Start Next Batch` if relevant and allowed
- `Unlock Full Access` if relevant
- `Back to Review`
- `Back to Result` only when entered immediately after submit

### B. Visual summary

Recommended visuals:

- one score ring
- one compact metric strip
- optional question-state dot row

The summary should answer:

- How did I do?
- What went wrong?
- What should I do next?

### C. Filters

Recommended filters:

- `All`
- `Wrong`
- `Correct`
- `Unanswered`

These should sit directly below the summary area.

### D. Question review list

Question cards should follow immediately after the filters.

## Question card content

Each card should show:

- question number
- correctness state
- question text
- user answer
- correct answer
- explanation
- reference note if available

If unanswered:

- clearly show `Not answered`
- keep the state visually neutral rather than red

## Question card hierarchy

Recommended order:

1. question meta row
- question number
- correctness badge

2. question text

3. answer comparison
- your answer
- correct answer

4. explanation block

5. reference block

## Question card visual tone

- white card
- soft border
- generous internal spacing
- calm correctness treatment
- explanation block should feel instructional, not system-generated

## Correctness language

Use consistent visual language:

- correct: soft green accent
- wrong: soft warm red accent
- unanswered: neutral cool accent

Do not use harsh warning colors across the whole card.

## Navigation inside detail

First pass:

- allow scroll-based review
- include filters

Later enhancement:

- previous / next question controls
- question map or answer-state dots for faster jumps

## 7. Review Insights

## Placement

Place inside `Review History`, above the attempt list.

## Goal

Provide real performance context without overwhelming the page.

## Recommended first-pass metrics

- average score
- number of submitted attempts
- pass rate
- recent trend

## Recommended later metrics

- module-level accuracy
- weak-area patterning
- unanswered frequency

## Visual rules

- one ring maximum in the insights area
- one trend line maximum
- horizontal bars only where meaningful

## 8. Graphical Representation Rules

## Keep

- score ring for summary or insights
- slim progress bars for module or weakness summaries
- answered/correctness dots when they help navigation
- simple trend line for recent review performance

## Avoid

- multiple donuts in the same viewport
- decorative dashboards
- glossy badges everywhere
- chart-heavy layouts
- celebratory result-style visuals in review detail

## 9. Current Infrastructure Mapping

## Already available

### Current page

`src/pages/Review.jsx`

Currently provides:

- review summary derivation from attempt rows
- full answer review rendering
- contextual next action logic
- review queue section

### Current route

`src/App.jsx`

Currently provides:

- protected `/review` route
- completed-profile guard

### Current data

`src/lib/appApi.js`

Available now:

- `getAttemptReview(attemptId)`
- `getReviewQueue(limit)`
- `getRecentAttempts()`

## What current infrastructure supports immediately

Without backend changes, we can build:

- a cleaner review detail screen
- answer-state filters on the client
- better visual summary
- better question-card structure
- a review-history first pass using available recent attempts plus latest-review links

## What is likely needed later

For a full review-history experience, we will eventually want:

- a fuller attempt-history query than the small dashboard feed
- richer per-attempt summary fields if missing
- stronger aggregate summaries for insights

This is an enhancement, not a blocker for the first redesign.

## 10. Key UX Rules

## Rule 1

Review should feel like study support, not punishment.

## Rule 2

The page must answer the next-action question quickly.

## Rule 3

Wrong answers should be easy to scan without making the page aggressive.

## Rule 4

The user should never need to dig to reopen an old attempt.

## Rule 5

Insights should remain believable and simple.

## Rule 6

The bottom nav belongs on `Review History`, not on a focused practice-like screen if detail later becomes more immersive.

For now, if detail remains under `/review`, nav behavior can stay consistent with the current shell until we intentionally refine it.

## 11. Recommended Phase Order

## Phase A

Create proper `Review History` structure:

- top summary strip
- light insights section
- filters
- attempt list

## Phase B

Refine `Review Detail`:

- calmer top summary
- score ring
- client-side filters
- improved answer cards

## Phase C

Add stronger navigation and analytics:

- question jump aids
- trend line
- weak-area summaries
- richer history filtering

## 12. Proposed Build Scope For The Next Review Redesign

Recommended immediate scope:

1. redesign `/review` into review-history-first behavior
2. allow attempt detail opening from the history list
3. redesign the detail summary and answer cards
4. add client-side filters for `All`, `Wrong`, `Correct`, `Unanswered`
5. keep copy short and exam-focused

Recommended to defer:

- dedicated analytics page
- heavy charts
- advanced filtering
- backend/query redesign unless the current attempt feed proves too limited

## 13. Final Direction

The review experience should become:

- one calm review home
- one focused attempt detail
- one light insights layer

That gives the app:

- better navigation clarity
- stronger study value
- better alignment with the current UI direction
- room to grow without overbuilding the first pass
