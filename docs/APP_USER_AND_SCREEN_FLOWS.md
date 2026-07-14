# App User And Screen Flows

> **Current access model:** Users choose their own modules. One selected module's first practice set is free, with one retry after a failed first attempt; payment unlocks only the selected module. Older pack-wide `full access` flows below are superseded by [Practice Set Access And Progression Policy](./BATCH_ACCESS_AND_PROGRESSION_POLICY.md).

## Scope

This document defines the user flow, screen flow, and screen-state requirements for PromotionSure, a public service promotion exam practice app.

This is a planning document only.

This document does not:

- implement UI
- change React components
- change backend logic
- change Supabase migrations
- change payment logic
- import or publish content
- change access rules

This document is intended to be detailed enough that we can redesign and implement the app screen by screen without guessing or reinterpreting core product rules.

## Product Rules Preserved

- Free users can access only Batch 1 of one selected module.
- Free module is selected only after explicit Start Free Batch confirmation.
- Free users get one retry only if they fail the first free attempt.
- Free users must unlock full access after passing Batch 1.
- Free users must unlock full access after failing twice.
- Free users cannot access another module after choosing a free module.
- Free users cannot access Batch 2+.
- Paid users can access any published batch in any module at any time.
- Paid users are not blocked by progress.
- Progress affects recommendation only, not paid-user access.
- Draft, archived, unpublished, undersized-hold, or unavailable batches are not startable.
- PFM Batch 1 and 2 are live.
- PSR Batch 1 to 7 are live.
- PFM Batch 3 is Coming Soon because it is undersized and more questions are expected.
- Current Affairs is Coming Soon because it is on fact-check hold.
- Oral Prep is separate later and is not part of CBT batch flow.

## Attempt And Review Policy Preserved

- A started practice session is temporary.
- A submitted test is a permanent attempt.
- Every submitted attempt should be stored.
- Retrying creates a new attempt and must never overwrite an older attempt.
- Users can review submitted attempts later.
- Free users can review their own free attempts.
- Paid users can review all their submitted attempts.
- Users can only review attempts that belong to their own account.
- Review must be reachable from:
  1. Result screen immediately after submit
  2. Dashboard recent attempts
  3. Review tab / attempt history page
  4. Module or batch card secondary action where useful

## Current Implementation Notes

- Authentication uses progressive disclosure: sign-up collects name and email first, then the password.
- Profile details are optional and editable from Account. They never block practice, review, results, access, or payment.
- Grade level is not collected because no current product behavior uses it.
- The app already has routes for landing, auth, dashboard, practice, review, access, payment verification, profile, and admin.
- The current app does not yet have a dedicated Result screen. Result summary and answer review are currently merged into `Review.jsx`.
- The current app does not yet have a dedicated Review History page. `/review` currently behaves like "latest attempt review" rather than a true attempt index.
- The current app does not yet have a forgot-password flow.
- The current app uses profile onboarding after auth, not a separate pre-dashboard profile setup route.
- The current app already uses backend access RPCs and should continue to treat them as the source of truth.

# 1. App-wide Flow Summary

## Main flow map

```text
Logged out visitor
-> Landing / Auth entry
-> Sign up or Login
-> Dashboard
-> Choose module / Start free batch / Unlock full access
-> Practice
-> Submit confirmation
-> Result
-> Review
-> Retry / Next batch / Unlock / Dashboard
```

## Paid-user flow map

```text
Paid user
-> Dashboard
-> Any published module / batch
-> Practice
-> Result
-> Review
-> Retry / Next batch / Another batch / Dashboard
```

## Coming-soon flow map

```text
User taps unavailable module / batch
-> Coming soon state
-> Back to Dashboard or Modules
```

## Access-control summary

- Auth decides whether the user can enter authenticated space.
- Optional profile details do not participate in access control.
- Backend access RPCs decide whether a batch is available, locked, retryable, published, or coming soon.
- Payment verification decides when full access becomes active.
- Review ownership checks decide whether an attempt can be opened.

# 2. User Types And Their Flows

## A. Logged-out visitor

### What they see first

- Landing page with app name, short value proposition, module overview, access summary, and auth CTA.
- Auth entry points from landing hero, public nav CTA, or any protected-route redirect.

### Login/signup entry points

- Landing CTA
- Public nav CTA
- Redirect to `/auth?mode=sign-in` from protected routes
- Optional future auth-entry screen before separate login/signup pages

### Direct-route behavior

- Direct `/dashboard` visit redirects to sign-in with "Please sign in to continue."
- Direct `/practice/:subjectSlug` visit redirects to sign-in with the full intended route in `returnTo`.
- Direct `/review` visit redirects to sign-in with the full intended route in `returnTo`.
- Direct `/access` visit redirects to sign-in with the full intended route in `returnTo`.
- Direct `/payment/verify` visit redirects to sign-in if the session is missing.

### Redirect behavior after login

- If auth started from a protected route, the app should return the user to that target.
- Preserve full path plus query plus hash in a sanitized, refresh-safe `returnTo` parameter.
- If auth started voluntarily, default redirect is dashboard.

## B. New authenticated user with incomplete profile

### Required profile fields now

- Phone number
- State
- Grade level
- Civil service organization
- Onboarding completion timestamp

### Optional profile fields now

- Full name at signup, but it should still be editable later
- Email is auth-owned and already known

### Fields better treated as later

- Ministry or department split from generic organization
- Role or title
- Alternate phone
- Payment-history preferences

### Profile setup flow

- User signs up or signs in.
- User reaches dashboard if auth succeeds.
- If profile is incomplete and they try to start practice, review, or access, onboarding modal appears or route redirects back to dashboard with onboarding target.
- User completes profile and is returned to the intended next step.

### When they reach dashboard

- Immediately after auth.
- Dashboard becomes the safe staging screen for onboarding, access summary, and module discovery.

### Can they skip anything

- They can see dashboard shell and top-level messaging.
- They should not be able to start practice, access full review flow, or continue to access/payment without completing the required onboarding fields.
- Grade level should remain identity/reporting data, not a content filter.

## C. Free user with no selected module

### Dashboard state

- Access badge shows `Free Access`.
- Banner explains they can choose one module's Batch 1 for free.
- Available module cards show Batch 1 start action if published.
- Other modules should not appear locked yet.
- Batch 2+ should show locked-for-full-access state.

### Available module choices

- Public Financial Management Batch 1
- Public Service Rules Batch 1
- Current Affairs shown as Coming Soon, not selectable
- Oral Prep not treated as CBT content and should not appear as a normal practice module

### Start Free Batch button

- Appears only on eligible Batch 1 of a published module.
- Must route through explicit confirmation first.

### Confirmation modal

- Explains that starting this batch locks free access to that module.
- Explains that later batches and other modules require full access.
- Primary action: `Start Free Batch`
- Secondary action: `Cancel`

### When `free_module` is locked

- Only after explicit confirmation and successful backend batch start.
- Never on module-card view, route preview, or dashboard load.

### What must not happen silently

- Selecting a module by visiting a URL
- Selecting a module just by opening module detail
- Locking free access due to recommendation logic
- Locking free access due to failed batch load

## D. Free user with selected module but no attempt yet

### Dashboard state

- Access badge shows `Free Access`.
- Selected free module is named clearly.
- Batch 1 is available in that module.
- Other modules show `Locked - requires full access`.
- Batch 2+ shows `Locked - requires full access`.

### Selected module state

- Batch 1 primary CTA: `Start Batch 1` or `Continue Batch 1`
- Secondary CTA may be omitted until there is a submitted attempt

### Other module lock state

- Friendly message that free access is already locked to another module.
- Primary CTA: `Unlock Full Access`

### Batch 1 start flow

- Dashboard/module detail -> Batch 1 CTA -> Practice
- Backend validates selected free module and startability

### Batch 2+ lock flow

- Tap locked batch -> locked state or access modal -> `/access`

## E. Free user fails first attempt

### Result screen state

- Status: Failed
- Next action: `retry_free_batch`
- Main CTA: `Retry Batch 1`
- Secondary CTA: `Review Answers`
- Supporting CTA: `Unlock Full Access`

### Review option

- Must remain available from result screen.
- Must remain available later from dashboard/review history.

### Dashboard state after failure

- Selected module stays selected.
- Batch 1 shows `Retry available`.
- Other modules remain locked.
- Batch 2+ remains locked.
- Recommended next action becomes retry, not unlock as the only path.

## F. Free user fails second attempt

### Result screen state

- Status: Failed
- Next action: `unlock_full_access`
- Main CTA: `Unlock Full Access`
- Secondary CTA: `Review Answers`

### No more retry

- Retry must not be shown as a primary or secondary action anymore.
- Backend access row should reflect retry exhaustion.

### Dashboard state

- Selected module visible
- Batch 1 shows completed/locked-for-full-access state
- Other modules locked
- Clear upgrade CTA

## G. Free user passes Batch 1

### Result screen state

- Status: Passed
- Next action: `unlock_full_access`
- Main CTA: `Unlock Full Access`
- Secondary CTA: `Review Answers`
- Supporting CTA: `Back to Dashboard`

### Batch 2 lock

- Batch 2 remains locked for free users even after passing.
- No free-user next-batch CTA should appear.

### Dashboard state

- Selected module shows passed Batch 1
- Next recommended action is unlock
- Review remains accessible

## H. Paid user with no attempts

### Dashboard state

- Access badge shows `Full Access`.
- All published modules and batches are visible.
- Recommendation may highlight one sensible entry point, but every published batch remains startable.

### Can jump to any batch

- Yes, any published batch in any live module.
- Current published set:
  - PFM Batch 1
  - PFM Batch 2
  - PSR Batch 1 to 7

### Recommendation behavior

- Recommend earliest sensible unpublished-gap-safe batch.
- Recommendation must not remove access to other published batches.

## I. Paid user with attempts/progress

### Dashboard state

- Access badge shows `Full Access`.
- Progress summary uses real attempt data only.
- Module cards show batch states, attempts, best score, latest score, and recommended next batch.
- Recent attempts panel and review shortcut are visible.

### Batch status

- Passed batches remain retryable and reviewable.
- Failed batches remain retryable and may still allow forward movement to any other published batch.

### Review history

- Full attempt list across all paid attempts.

### Can still jump freely

- Yes. Progress influences default emphasis only.

## J. Paid user who failed a previous batch

### Not blocked

- A failed batch should never hard-block other published paid-user content.

### Retry recommended

- Dashboard and result copy should recommend retry first.

### Continue to another published batch

- Allowed if the later batch is published.

### Result/review button behavior

- Result can show `Retry Batch` as main CTA and `Try Next Batch` as secondary.
- Review detail can show `Retry Batch` and `Start Next Published Batch`.

# 3. Screen Inventory

Each screen below lists the required product behavior for redesign. "Current" indicates an existing route or component. "Planned" indicates a state we should introduce later without changing backend rules.

## 1. Landing / Auth Entry

- Status: Implemented as a concise module-first public service page.
- Purpose: Explain product and move visitors into account creation or sign-in.
- Entry points: Root route, public nav, post-sign-out.
- Exit points: Signup or Login. Authenticated root visits redirect to Dashboard.
- Primary CTA: `Start free practice`
- Secondary CTA: `Sign in`
- Data needed: Auth session only.
- Backend/RPC calls: None required.
- Free-user behavior: Explains one selected module and its first practice set without leading with batch terminology.
- Paid-user behavior: Existing authenticated users bypass the landing page.
- Mobile layout priority: Product purpose, main CTA, reassurance, and compact module availability.
- Error/empty states: None. Authentication links route directly without an intermediate modal.
- Edition context: Identify the current preparation content as the `2026 edition` once, near module availability, and note quietly that later-year editions will follow.

## 2. Login

- Status: Current, combined in `Auth.jsx`.
- Purpose: Authenticate an existing user.
- Entry points: Landing, auth redirect, signup switch link.
- Exit points: Dashboard or intended protected route.
- Primary CTA: `Login`
- Secondary CTA: `Create Account`, `Forgot Password` later
- Data needed: Email, password.
- Backend/RPC calls: `supabase.auth.signInWithPassword`
- Free-user behavior: Same as paid at auth stage.
- Paid-user behavior: Same as free at auth stage.
- Mobile layout priority: Form fields, login button, create-account link.
- Error/empty states: Invalid credentials, network failure, session load failure.

## 3. Signup

- Status: Current, combined in `Auth.jsx`.
- Purpose: Create new account.
- Entry points: Landing, login switch link.
- Exit points: Dashboard or the originally requested protected route.
- Primary CTA: `Create Account`
- Secondary CTA: `Login`
- Data needed: Full name, email, password.
- Backend/RPC calls: `supabase.auth.signUp`, optional immediate sign-in if needed
- Free-user behavior: Lands in the module-first Dashboard experience.
- Paid-user behavior: Not distinct yet until entitlement exists.
- Mobile layout priority: Short form, no extra fields.
- Error/empty states: Duplicate email, weak password, network failure.

## 4. Forgot Password

- Status: Later
- Purpose: Reset password.
- Entry points: Login screen.
- Exit points: Confirmation state, return to login.
- Primary CTA: `Send Reset Link`
- Secondary CTA: `Back to Login`
- Data needed: Email.
- Backend/RPC calls: Supabase password-reset flow.
- Free-user behavior: Same.
- Paid-user behavior: Same.
- Mobile layout priority: Single field and confirmation.
- Error/empty states: Missing email, invalid email, reset link send failure.

## 5. Profile Setup / Onboarding

- Status: Current as modal, can later become full-screen on small devices.
- Purpose: Capture minimum identity fields needed before protected product use.
- Entry points: Post-signup, first attempt to start practice, first attempt to open review/access.
- Exit points: Intended target, usually Dashboard or Practice.
- Primary CTA: `Save and Continue`
- Secondary CTA: `Cancel` or close only when the user is still on dashboard.
- Data needed: Existing profile, phone, state, grade level, organization.
- Backend/RPC calls: `get_profile`, `ensure_my_profile`, `update_profile`
- Free-user behavior: Must complete before starting free batch.
- Paid-user behavior: Must complete before practice/review/access too.
- Mobile layout priority: Required fields first, short explanation, one CTA.
- Error/empty states: Validation, save failure, expired session.

## 6. Dashboard

- Status: Current
- Purpose: Main study home and access summary.
- Entry points: Login, signup, profile completion, payment success, nav.
- Exit points: Module detail, practice, review, access, account.
- Primary CTA: Contextual `Start`, `Continue`, `Retry`, or `Unlock`.
- Secondary CTA: Review shortcut, module secondary actions.
- Data needed: Auth user, profile, candidate summary, subjects, progress, module batch access, recent attempts, review queue.
- Backend/RPC calls: `get_candidate_summary`, `get_subjects`, `get_module_progress`, `get_module_batch_access`, `get_recent_attempts`, `get_review_queue`
- Free-user behavior: Shows free-module selection or selected-module restriction.
- Paid-user behavior: Shows all published batches.
- Mobile layout priority: Greeting, access card, recommended next action, modules, recent attempts.
- Error/empty states: No content, modules load failure, attempts load failure, review queue empty.

## 7. Module Detail / Module Batch List

- Status: Planned as a dedicated screen or dashboard deep-link section.
- Purpose: Show one module with all its batch cards and contextual actions.
- Entry points: Dashboard module tap, Modules tab, recommendation card.
- Exit points: Practice, review, access, dashboard.
- Primary CTA: Batch-level CTA
- Secondary CTA: Review or Unlock where relevant
- Data needed: Selected module details, module batch access rows, progress, recent attempts for that module.
- Backend/RPC calls: `get_module_batch_access(subject_slug)`, `get_module_progress`
- Free-user behavior: Only selected free module Batch 1 may be startable.
- Paid-user behavior: Any published batch startable.
- Mobile layout priority: Module summary then batch list.
- Error/empty states: No published questions, coming soon, access denied, network failure.

## 8. Free Module Confirmation Modal

- Status: Current
- Purpose: Prevent silent free-module lock.
- Entry points: Free-user Batch 1 start CTA.
- Exit points: Practice if confirmed, dashboard if cancelled.
- Primary CTA: `Start Free Batch`
- Secondary CTA: `Cancel`
- Data needed: Module name, free-access rules.
- Backend/RPC calls: `start_practice_batch`
- Free-user behavior: Required when no free module selected.
- Paid-user behavior: Not used.
- Mobile layout priority: Short explanation and two buttons.
- Error/empty states: Start failure, expired session.

## 9. Locked Requires Payment State

- Status: Partly current, should be formalized across screens.
- Purpose: Explain why a batch cannot start and route to access.
- Entry points: Locked batch tap, result next action, review CTA, dashboard CTA, direct URL guard failure.
- Exit points: Access page, dashboard, modules.
- Primary CTA: `Unlock Full Access`
- Secondary CTA: `Back`
- Data needed: Lock reason, module, batch, access status.
- Backend/RPC calls: `get_batch_access_state` or `get_module_batch_access`
- Free-user behavior: Used often.
- Paid-user behavior: Used only for unpublished content or entitlement issues.
- Mobile layout priority: Reason first, unlock next.
- Error/empty states: Missing summary, stale access state.

## 10. Coming Soon State

- Status: Current as lightweight copy, should become formalized state.
- Purpose: Show unavailable content without implying a bug.
- Entry points: Coming-soon module or batch tap, direct route to unpublished batch.
- Exit points: Dashboard, Modules.
- Primary CTA: `Back to Dashboard`
- Secondary CTA: `Explore Available Modules`
- Data needed: Module or batch title, hold reason.
- Backend/RPC calls: `get_module_batch_access`, optional `get_batch_access_state`
- Free-user behavior: Same as paid.
- Paid-user behavior: Same as free.
- Mobile layout priority: Calm message and clear back path.
- Error/empty states: None; this is the empty-state variant.

## 11. Practice Screen

- Status: Current
- Purpose: Complete one attempt for one batch.
- Entry points: Dashboard, module detail, result retry/next, review retry/next, direct URL.
- Exit points: Submit confirmation, dashboard/modules, result.
- Primary CTA: `Submit Test`
- Secondary CTA: `Previous`, `Next`, `Question Map`, `Exit`
- Data needed: Auth, profile completion, candidate summary, selected subject, batch questions, local answers, timer state.
- Backend/RPC calls: `get_candidate_summary`, `get_subjects`, `get_practice_questions`, `submit_attempt`
- Free-user behavior: Only eligible free Batch 1 and retry path.
- Paid-user behavior: Any published batch.
- Mobile layout priority: Question text, options, nav, progress, submit.
- Error/empty states: Load failure, no questions, locked batch, expired session.

## 12. Question Map

- Status: Current inline sidebar map, planned responsive modal/bottom-sheet variant.
- Purpose: Jump between questions and show completion state.
- Entry points: Practice screen button.
- Exit points: Back to current question.
- Primary CTA: Tap question number.
- Secondary CTA: Close.
- Data needed: Question order, answered state, current index, flagged state.
- Backend/RPC calls: None.
- Free-user behavior: Same as paid.
- Paid-user behavior: Same as free.
- Mobile layout priority: Bottom sheet or full-screen sheet.
- Error/empty states: None if questions exist.

## 13. Submit Confirmation Modal

- Status: Planned
- Purpose: Prevent accidental submission and warn about unanswered questions.
- Entry points: Practice submit action.
- Exit points: Result on confirm, back to practice on cancel.
- Primary CTA: `Submit Test`
- Secondary CTA: `Cancel`
- Data needed: Answered count, unanswered count, batch info.
- Backend/RPC calls: `submit_attempt` after confirmation.
- Free-user behavior: Same as paid.
- Paid-user behavior: Same as free.
- Mobile layout priority: Counts and action buttons.
- Error/empty states: Submission failure.

## 14. Result Screen

- Status: Planned as separate screen or separate top-state before review detail.
- Purpose: Show just-submitted score and next action clearly.
- Entry points: Successful submit only.
- Exit points: Review detail, retry, next batch, unlock, dashboard.
- Primary CTA: Backend-driven next action.
- Secondary CTA: `Review Answers`, plus contextual third CTA if useful.
- Data needed: Attempt result payload, next action, next batch number, score summary.
- Backend/RPC calls: Uses `submit_attempt` response, may refresh `get_candidate_summary`.
- Free-user behavior: Never show next-batch CTA.
- Paid-user behavior: May show retry, next batch, or dashboard.
- Mobile layout priority: Status, score, next action.
- Error/empty states: Missing result payload fallback to review fetch.

## 15. Review History Page

- Status: Planned
- Purpose: Show all submitted attempts for the current user.
- Entry points: Review tab, dashboard shortcut, result CTA.
- Exit points: Review detail, retry, next batch, dashboard.
- Primary CTA: `Review Attempt`
- Secondary CTA: `Retry Batch` or `Start Practice`
- Data needed: Attempt list, filters, access status.
- Backend/RPC calls: New or extended attempt-history query, plus candidate summary.
- Free-user behavior: Only their own free attempts.
- Paid-user behavior: All attempts.
- Mobile layout priority: Filters, latest attempts first, simple cards.
- Error/empty states: No attempts yet, filter empty state, load failure.

## 16. Review Detail Page

- Status: Partly current via `/review?attempt=...`
- Purpose: Review one submitted attempt question by question.
- Entry points: Result, review history, dashboard recent attempts, batch card review action.
- Exit points: Retry, next batch, unlock, back to history, dashboard.
- Primary CTA: Contextual next action.
- Secondary CTA: Filter, back, retry, unlock.
- Data needed: Attempt summary, answer rows, explanations, references.
- Backend/RPC calls: `get_attempt_review(attempt_id)`
- Free-user behavior: Review own attempts only, unlock CTA where relevant.
- Paid-user behavior: Review all own attempts, retry or continue freely.
- Mobile layout priority: Summary first, answer cards next, actions persistent.
- Error/empty states: Invalid attempt, unauthorized attempt, stale review data.

## 17. Review Insights / Analytics

- Status: Planned, minimal
- Purpose: Show useful aggregate progress without fake analytics.
- Entry points: Dashboard progress summary, Review tab, maybe Account later.
- Exit points: Review history, dashboard.
- Primary CTA: `View Attempts`
- Secondary CTA: `Retry Recommended Batch`
- Data needed: Attempt counts, pass/fail totals, module accuracy, recent score trend.
- Backend/RPC calls: Likely aggregate attempt queries or computed summaries.
- Free-user behavior: Limited data set but still real.
- Paid-user behavior: Full history basis.
- Mobile layout priority: One ring, one trend line, a few bars.
- Error/empty states: No attempts yet, partial data.

## 18. Access / Payment Page

- Status: Current
- Purpose: Explain access state and initialize payment.
- Entry points: Locked screens, dashboard CTA, result CTA, review CTA, nav.
- Exit points: Paystack, dashboard, payment status pages.
- Primary CTA: `Unlock Full Access`
- Secondary CTA: `Back to Dashboard`
- Data needed: Candidate summary, price, entitlement state.
- Backend/RPC calls: `get_candidate_summary`, `initialize-paystack-payment`
- Free-user behavior: Explain selected free module and remaining path.
- Paid-user behavior: Show active access, no upsell.
- Mobile layout priority: Status, benefits, price, CTA.
- Error/empty states: Summary load failure, initialize failure, already-paid state.

## 19. Payment Pending

- Status: Planned as explicit UI state.
- Purpose: Explain that payment is being processed or verified.
- Entry points: Return from Paystack before verification completes, delayed verification, webhook lag.
- Exit points: Success, failed, access page, dashboard.
- Primary CTA: `Check Again`
- Secondary CTA: `Return to Access`
- Data needed: Payment reference, last verification result.
- Backend/RPC calls: `verify-paystack-payment`
- Free-user behavior: Same as paid.
- Paid-user behavior: Same as free.
- Mobile layout priority: Calm message, reference, next step.
- Error/empty states: Missing reference, verification timeout.

## 20. Payment Success

- Status: Current via `PaymentVerify.jsx`, but should be clearer as a state.
- Purpose: Confirm that full access is active.
- Entry points: Successful verification.
- Exit points: Dashboard, optional access page.
- Primary CTA: `Go to Dashboard`
- Secondary CTA: `View Access`
- Data needed: Verification result, candidate summary refresh.
- Backend/RPC calls: `verify-paystack-payment`, `get_candidate_summary`
- Free-user behavior: Becomes paid path from here forward.
- Paid-user behavior: Show already-active confirmation if reopened.
- Mobile layout priority: Success status then return path.
- Error/empty states: Summary refresh failure after success.

## 21. Payment Failed

- Status: Planned as explicit UI state.
- Purpose: Explain failed or unverified payment without raw errors.
- Entry points: Verification failure, cancelled payment, invalid reference.
- Exit points: Access page, support path later.
- Primary CTA: `Return to Access`
- Secondary CTA: `Try Again`
- Data needed: Reference, failure reason category.
- Backend/RPC calls: `verify-paystack-payment`
- Free-user behavior: Same.
- Paid-user behavior: Same.
- Mobile layout priority: Clear message and recovery options.
- Error/empty states: Missing reference, network failure during verify.

## 22. Account / Profile Page

- Status: Current
- Purpose: Show account identity and settings.
- Entry points: Nav, account menu, onboarding completion.
- Exit points: Edit profile later, access, support, sign out.
- Primary CTA: `Manage Account` or `Edit Profile` later
- Secondary CTA: `Sign Out`
- Data needed: Profile, access state, payment history later.
- Backend/RPC calls: `get_profile`, candidate summary for access badge later
- Free-user behavior: Shows free access status.
- Paid-user behavior: Shows full access status and history later.
- Mobile layout priority: Identity summary and key actions.
- Error/empty states: Missing profile data, session expired.

## 23. Sign Out Confirmation

- Status: Current
- Purpose: Prevent accidental sign-out.
- Entry points: Header sign out, account menu sign out.
- Exit points: Landing/auth after confirm, current page after cancel.
- Primary CTA: `Sign Out`
- Secondary CTA: `Cancel`
- Data needed: None.
- Backend/RPC calls: `supabase.auth.signOut`
- Free-user behavior: Same.
- Paid-user behavior: Same.
- Mobile layout priority: Clear two-button confirmation.
- Error/empty states: Sign-out failure if Supabase call fails.

## 24. Generic Error State

- Status: Current but inconsistent; should be unified.
- Purpose: Catch recoverable failures with friendly copy.
- Entry points: Any failed screen load or RPC error.
- Exit points: Retry, dashboard, access, auth as context requires.
- Primary CTA: `Try Again`
- Secondary CTA: Contextual back path.
- Data needed: Error category, screen context.
- Backend/RPC calls: Contextual retry.
- Free-user behavior: Same.
- Paid-user behavior: Same.
- Mobile layout priority: Error reason and next action.
- Error/empty states: This is the state.

## 25. Empty State

- Status: Current in several screens.
- Purpose: Explain why content is absent without confusion.
- Entry points: No attempts, no published questions, no review items, no payment ref.
- Exit points: Start practice, dashboard, access.
- Primary CTA: Contextual start or back.
- Secondary CTA: Optional.
- Data needed: Context.
- Backend/RPC calls: None beyond initial fetch.
- Free-user behavior: May include unlock CTA when relevant.
- Paid-user behavior: Usually back or start CTA only.
- Mobile layout priority: One sentence and one clear action.
- Error/empty states: No attempts yet, no published questions, no review items.

# 4. Authentication And Account Creation Flow

## Auth entry screen

### Required content

- App name
- `Sign in` and `Create account` modes
- `Continue with Google`
- Email and password fallback
- Minimal official design tone

### Recommended copy direction

- Headline: Prepare for your federal public service promotion exam with focused practice.
- Support copy: Choose a module, complete focused practice, review answers, and keep improving.
- Avoid grade-level-as-access copy.

## Signup screen

### Fields

- Full name
- Email
- Password
- No confirm-password field

### Actions

- Create Account button
- Continue with Google button
- Login link

### Error states

- Email already in use
- Weak password
- Network failure
- Account created but email confirmation required

## Login screen

### Fields

- Email
- Password

### Actions

- Login button
- Continue with Google button
- Forgot Password remains deferred until the recovery flow is implemented end to end
- Create Account link

### Error states

- Invalid credentials
- Unconfirmed email if Supabase requires it
- Network failure

## Hybrid authentication behavior

- Google OAuth and email/password are the supported interface paths.
- Google OAuth returns through `/auth/callback` and preserves the sanitized `returnTo` destination.
- A new user continues to the requested protected destination or Dashboard without a profile-completion gate.
- Existing users return to the requested protected page.
- Email confirmation, resend, and password recovery are intentionally deferred during active development.
- Email/password fields support browser autofill, password managers, paste, and password visibility.

## Profile setup screen

### Field policy

- Signup collects only the full name needed to identify the account.
- Phone number, state, and civil service organisation are optional and may be added later from Account.
- Optional details never control questions, modules, free practice, or purchased access.
- Once supplied, candidate-facing UI displays these values as read-only account records.
- Missing optional fields may still be added without reopening values already supplied.
- Grade level is not collected or used by the candidate flow.

### Legacy route behavior

- `/profile-setup` redirects safely to `/profile`.
- It does not force the optional-details form open or block access to the product.

### Keep it minimal

- No long explanation
- No duplicate identity questions
- No access or payment copy mixed into onboarding

# 5. Dashboard Flow

## Dashboard goals

- Show the user's current access state clearly.
- Show what they can do next.
- Show modules and batch states without hiding valid options.
- Surface review and recent attempts after real activity exists.

## Shared dashboard sections

- Greeting
- Access badge: `Free Access` or `Full Access`
- Selected free module summary if any
- Recommended next action
- Module cards
- Batch cards
- Progress summary
- Recent attempts
- Review shortcut
- Unlock CTA where relevant

## Free user with no selected module

Show:

- `Choose your free module` message
- PFM Batch 1 start option
- PSR Batch 1 start option
- Current Affairs as Coming Soon
- Batch 2+ rows visible but locked for full access
- No module should appear locked until selection happens

Must not do:

- Silently choose a module
- Treat dashboard view as consent
- Hide non-selected modules before selection

## Free user with selected module

Show:

- Selected free module badge
- Batch 1 card for that module
- Retry or review if attempt exists
- Other modules locked with clear reason
- Batch 2+ locked with unlock CTA
- Persistent unlock CTA in access card or locked rows

## Free user after passing/failing

Show:

- Review latest attempt
- Retry if allowed
- Unlock if retry exhausted or free batch passed
- Batch 2 remains locked
- Other modules remain locked

## Paid user

Show:

- All published modules and batches
- Recent attempts
- Progress summary using real data
- Recommended next action
- All batch actions still visible even when not recommended
- Coming Soon badges for PFM Batch 3 and Current Affairs

## Dashboard CTA rules

- Module-level CTA is the fast path.
- Batch-level CTA provides precision.
- Secondary batch action should expose review where an attempt exists.
- Recommended next action must not suppress alternative paid-user actions.

# 6. Module And Batch Flow

## Module card

### Fields

- Module title
- Short description
- Live batch count
- Coming Soon count
- Progress percentage if based on real attempts
- Best score if real
- Recommended batch
- Primary CTA

### Modules

- Public Financial Management
- Public Service Rules
- Current Affairs
- Oral Prep later, outside normal CBT list

### Module-card primary CTA rules

- Free no-selection user: `Start Batch 1`
- Free selected-module user: `Start Batch 1`, `Retry Batch 1`, or `Unlock Full Access`
- Paid user: `Start Batch N`, `Continue Batch N`, or `Retry Batch N`
- Coming Soon module: `Coming Soon`

## Batch card

### Fields

- Batch number
- Status
- Question count
- Attempts count
- Best score
- Last score
- Last attempt date
- Lock reason
- Primary button
- Secondary button

### Batch states

- `available`
- `completed_passed`
- `completed_failed`
- `locked_requires_payment`
- `unavailable_not_published`
- `coming_soon`
- `retry_available`
- `live`

### Button behavior

- `Start Batch`: open practice for that batch
- `Retry`: open same batch as a new attempt
- `Review`: open review history filtered to that batch or latest attempt for that batch
- `Unlock Full Access`: open access page
- `Coming Soon`: disabled or open calm info state
- `Continue`: open the recommended practice set; it does not resume an interrupted unsubmitted sitting

### Module-specific content map

- Public Financial Management
  - Batch 1: live
  - Batch 2: live
  - Batch 3: Coming Soon
- Public Service Rules
  - Batch 1 to 7: live
- Current Affairs
  - All batches: Coming Soon / fact-check hold
- Oral Prep
  - Not part of CBT module list yet

# 7. Practice Flow

## Practice screen content

- Module name
- Batch number
- Timer
- Question number
- Progress bar
- Answered/unanswered count
- Question text
- Answer options
- Selected answer
- Previous button
- Next button
- Question map button
- Submit button
- Exit/back behavior

## Practice rules

- No explanations during practice.
- Users can jump between questions.
- Unanswered questions are tracked.
- Submit should require confirmation.
- Active practice is intentionally non-resumable after a confirmed exit, reload, or closed tab.
- Leaving an active practice must show an exit warning where the browser permits it.
- Confirmed exit clears temporary answers, flags, order, position, and timer without recording an attempt.
- Switching apps without unloading the page does not exit; the absolute timer continues.
- Practice set 1 keeps authored question and option order.
- Practice set 2 onward shuffles questions and options once per new session.
- Direct URL access must still pass backend access checks.
- Locked access should show a friendly UI state, never raw RPC error text.

## Practice journey

1. User enters practice from dashboard, module detail, review retry, or direct link.
2. App resolves auth and profile status.
3. App resolves module and batch context.
4. App requests batch questions from backend using explicit batch number where available.
5. User answers questions in any order.
6. The mounted Practice screen holds temporary answers, flags, shuffled order, and timer state in memory only.
7. User opens question map to jump around.
8. User submits after confirmation.
9. Backend stores permanent attempt and returns result summary plus next action.
10. User is sent to Result, then Review.

## What happens on answer selection

- Selected option updates local answer state immediately.
- Question becomes `answered` in question map.
- No backend write happens yet.

## What happens on next/previous

- App changes current question index.
- Existing selected answer remains visible.

## What happens on question map

- User sees question-number grid with answered/unanswered/current states.
- Tapping a number jumps to that question.

## What happens when user submits with unanswered questions

- Submit confirmation shows counts.
- User may still submit.
- Unanswered items are recorded as unanswered.
- Current app behavior requiring at least one answer can remain as a minimal guard.

## What happens if questions fail to load

- Show friendly state: `We could not load this batch right now. Start again from the dashboard.`
- Show `Back to Dashboard`
- Show `Unlock Full Access` if the resolved issue is access-related

## What happens if session expires

- Redirect to sign-in
- Preserve intended return target if safe
- In-progress local answers may be lost unless later autosave is added

## What happens on exit

- The visible Exit action opens a confirmation immediately.
- Browser back and unload navigation are guarded where browser APIs permit it.
- Cancelling keeps the current session unchanged.
- Confirming clears the session and returns to Modules.
- Reopening starts from question 1 with a fresh timer and, for Practice set 2 onward, a fresh shuffle.
- No attempt or failure is written until submission succeeds.

# 8. Question Map Flow

## States

- Answered
- Unanswered
- Current question
- Flagged or marked if supported

## Behaviors

- Tap question number to jump
- Close returns to current question
- Desktop can use sidebar or modal
- Mobile should use bottom sheet or full-screen sheet
- Free and paid users see the same map

## Recommendation

- Keep question flagging in UI as a local aid only for now.
- Do not build server-side flagged-question persistence yet unless product later needs it.

# 9. Submit Confirmation Flow

## Trigger

- User taps submit from sidebar or final-question action.

## Modal content

- Batch name or module + batch
- Answered count
- Unanswered count
- Warning if unanswered questions remain

## Actions

- Primary: `Submit Test`
- Secondary: `Cancel`

## Loading state

- Disable modal actions
- Show `Submitting...`

## Error state

- Stay on practice screen
- Show friendly failure message
- Keep current answers intact

# 10. Result Flow

## Result data

- Score percentage
- Pass/fail
- Pass mark
- Correct count
- Wrong count
- Unanswered count
- Module
- Batch
- Attempt number
- Time spent if available
- `next_action`

## Result behavior by next action

### Free pass

- Main CTA: `Unlock Full Access`
- Secondary: `Review Answers`
- Supporting CTA: `Back to Dashboard`

### Free fail first attempt

- Main CTA: `Retry Batch 1`
- Secondary: `Review Answers`
- Supporting CTA: `Unlock Full Access`

### Free fail second attempt

- Main CTA: `Unlock Full Access`
- Secondary: `Review Answers`

### Paid pass with next batch

- Main CTA: `Start Next Batch`
- Secondary: `Review Answers`
- Supporting CTA: `Retry Batch`
- Supporting CTA: `Back to Dashboard`

### Paid fail with next batch

- Main CTA: `Retry Batch`
- Secondary: `Review Answers`
- Supporting CTA: `Try Next Batch`

### Paid last published batch

- Main CTA: `Back to Dashboard`
- Secondary: `Review Answers`
- Supporting CTA: `Retry Batch`

## Result design principle

- One dominant next step based on backend `next_action`.
- Result should be short, clear, and confidence-building.
- Deep answer review belongs to the next screen.

# 11. Review System Flow

## A. Review History Page

### Purpose

- Show all submitted attempts for the current user.

### Entry points

- Bottom-nav Review tab
- Dashboard recent attempts
- Module or batch card review action
- Result screen after submit

### Data shown

- Attempt list
- Module
- Batch
- Score
- Pass/fail
- Correct/wrong/unanswered
- Submitted date
- Attempt number
- Review button
- Retry button if allowed

### Filters

- All
- Passed
- Failed
- Module filter
- Recent
- Wrong-heavy later if we eventually support it

### Free-user behavior

- Show only their own free submitted attempts.
- Show unlock CTA for more practice and broader future value.

### Paid-user behavior

- Show all their submitted attempts.
- Allow retry of any published batch.
- Allow next-batch action where available.

### Empty state

- `No attempts yet.`
- CTA: `Start Practice`

## B. Review Detail Page

### Purpose

- Review one submitted attempt question by question.

### Data shown

- Attempt summary
- Module
- Batch
- Score
- Pass/fail
- Correct/wrong/unanswered count
- Question cards
- User answer
- Correct answer
- Explanation
- Unanswered state
- Reference/source note if available

### Filters

- All
- Wrong
- Correct
- Unanswered

### Actions

- Previous/next question
- Back to review history
- Retry batch
- Next batch if paid and available
- Unlock full access if free and needed

### Security

- Backend must ensure the current user owns the attempt.
- Frontend must never trust query-string attempt IDs.

### Important review-storage rule

- All submitted attempts are permanently stored.
- Retrying creates a new attempt record.
- Old attempts remain reviewable.
- Review should remain meaningful even if future content changes.

### Snapshot recommendation

- Attempt review should rely on stored attempt snapshots or stable historical answer data where possible.
- If question text/explanation later changes in the source bank, old review should still be understandable.

# 12. Review Insights / Analytics Flow

## Purpose

- Provide a small amount of useful progress feedback without turning the app into a fake analytics dashboard.

## Include

- Overall accuracy ring
- Score trend over recent attempts
- Attempt count
- Passed count
- Failed count
- Module performance bars
- Weak-module list

## Avoid

- Topic-level analytics without topic tags
- Too many charts
- Marketplace-style dashboard panels

## Animation

- Score ring fill
- Line chart draw
- Progress bar fill
- Count-up numbers
- Subtle transitions only

## Entry points

- Dashboard progress summary
- Review tab
- Account later if useful

## Recommendation

- Start by placing insights as a section inside Review History, not a separate route.
- Split into a dedicated page only if the history page becomes too long.

# 13. Access / Payment Flow

## Entry points

- Locked batch
- Dashboard unlock CTA
- Result unlock CTA
- Review unlock CTA
- Account/payment menu

## Access page content

- Current access state
- What full access unlocks
- All published batches
- Unlimited retries
- Detailed explanations
- Review history value
- Progress tracking
- Paystack CTA
- Price
- Support/trust note

## Payment flow

1. User taps `Unlock Full Access`.
2. Frontend calls `initialize-paystack-payment`.
3. Backend returns Paystack authorization URL or already-paid state.
4. User is redirected to Paystack.
5. Paystack returns user to verification route.
6. Frontend calls `verify-paystack-payment`.
7. Backend verifies and updates entitlement.
8. User is routed to success, pending, or failed state.
9. User returns to dashboard with full access active.

## States

- Payment loading
- Payment pending
- Payment success
- Payment failed
- Payment already active
- Payment verification delayed

## Important rules

- Verification is server-side.
- Frontend must not trust payment success query params.
- If verification is delayed, show the reference and provide a retry path.

# 14. Coming Soon And Locked Flow

## Coming Soon

### Used for

- PFM Batch 3
- Current Affairs
- Future Oral Prep
- Any unpublished or draft batch

### Message style

- Calm
- Not broken
- No raw database error

### Buttons

- `Back to Dashboard`
- `Explore Available Modules`
- `Notify Me` later if implemented

## Locked Requires Payment

### Used for

- Free user Batch 2+
- Free user different module after free module is selected
- Free user after retry exhausted
- Free user after passing free batch

### Message style

- Explain why the user is blocked
- Explain what full access unlocks
- Offer `Unlock Full Access`

# 15. Account / Profile Flow

## Content

- Profile information
- Access status
- Payment history later
- Settings later
- Support/help
- Sign out

## Entry points

- Header nav
- Account menu
- Bottom-nav Account tab

## Edit-profile recommendation

- Treat profile identity and supplied optional details as account records, not general settings.
- Full name and email are read-only on the Account page.
- Phone, state, and organisation may be added when missing, but supplied values are not editable in the candidate UI.
- Corrections to supplied values should be handled through support or an administrative workflow.
- The UI copy should not say grade level affects question access.

## Sign out confirmation behavior

- Confirm before sign-out.
- On confirm, clear auth session and route to landing or auth entry.

## Payment history

- Mark as later.
- Do not block redesign of core practice flow on payment-history UI.

# 16. Navigation Rules

## Recommended bottom nav

- Home
- Modules
- Practice
- Review
- Account

## Behavior decisions

- `Home` opens Dashboard.
- `Modules` opens dashboard modules anchor or a dedicated modules page later.
- `Practice` opens `/practice`, a recommendation launcher that requires an explicit start action.
- `Review` opens Review History.
- `Account` opens Profile/Account.

## Practice-tab recommendation

- `/practice` is a focused Practice Hub, not an automatic timed-session trigger, catalog, or duplicate Dashboard.
- The hub gives equal prominence to every module the user can currently practise. It must not infer a preferred subject from recent activity or database order.
- Each usable module shows only its name, completion percentage, and the appropriate Start, Continue, Retry, or Practice Again action. Practice-set numbering stays out of this normal path.
- Purchased modules may include a quiet `Choose practice set` route to module detail. This is a secondary manual path, not the default journey.
- If the user has not selected a free module and owns no modules, the hub asks them to choose a module. Every published module offers both `Try free` and `Unlock module`, so free practice is optional rather than a payment prerequisite.
- Modules that are published but not available to the user appear in a compact `More modules` list with an `Unlock module` action. They do not show progress, descriptions, or practice-set counts.
- Coming-soon modules do not appear in the Practice Hub. The Modules area remains the catalog and future-availability surface.
- Free-module selection still requires explicit confirmation, and all existing free and paid access rules remain backend-owned.
- During an active practice session, bottom nav should be hidden to prevent accidental exits.

## Screen-level nav rules

- Practice should show a back button to Modules or Dashboard.
- Result should prevent accidental back into submitted test.
- Review should show `Back to Result` when entered from a fresh submit and `Back to History` when entered from Review History.
- Payment success should route to Dashboard.
- Coming Soon should route back to Modules or Dashboard.

## Which screens show bottom nav

- Dashboard: yes
- Modules: yes
- Review History: yes
- Account: yes
- Practice: no
- Result: no or minimal
- Payment: no
- Auth: no

## Reason

- Active test-taking needs focus and low navigation risk.
- Result and payment are transitional states with a single intended next action.
- Home/Modules/Review/Account benefit from persistent app navigation.

# 17. Modal / Bottom Sheet Rules

## Free module confirmation

- Trigger: Free user taps first eligible Batch 1 start CTA.
- Content: Free access will lock to this module after you continue.
- Primary action: `Start Free Batch`
- Secondary action: `Cancel`
- Dismiss behavior: Tap outside or cancel
- Mobile treatment: Center modal or bottom sheet

## Submit confirmation

- Trigger: User taps submit inside practice.
- Content: Answered count, unanswered count, final confirmation
- Primary action: `Submit Test`
- Secondary action: `Cancel`
- Dismiss behavior: Cancel only
- Mobile treatment: Bottom sheet

## Locked requires payment

- Trigger: Locked batch/action
- Content: Why locked and what full access unlocks
- Primary action: `Unlock Full Access`
- Secondary action: `Back`
- Dismiss behavior: Allowed
- Mobile treatment: Bottom sheet

## Sign out confirmation

- Trigger: Sign out action
- Content: You will need to sign in again
- Primary action: `Sign Out`
- Secondary action: `Cancel`
- Dismiss behavior: Allowed
- Mobile treatment: Modal

## Question map

- Trigger: Question map button in practice
- Content: Numbered question grid with states
- Primary action: Tap question
- Secondary action: `Close`
- Dismiss behavior: Allowed
- Mobile treatment: Full-screen sheet or large bottom sheet

## Payment pending

- Trigger: Verification delayed or webhook lag
- Content: Payment reference, current status, next steps
- Primary action: `Check Again`
- Secondary action: `Return to Access`
- Dismiss behavior: Not until user chooses a next step
- Mobile treatment: Full-screen state

# 18. Data Dependency Map

## Core data objects

- Auth user
- Profile
- Access/entitlement summary
- Selected free module
- Module access rows
- Published batch counts
- Recent attempts
- Review detail
- Payment status
- Practice questions
- Submit result

## Screen to data map

### Landing/Auth entry

- Needs: Auth session only
- Must not trust: Client assumptions about existing account state

### Login/Signup

- Needs: Auth form state
- Must not trust: Local success without Supabase response

### Profile setup

- Needs: Profile record
- Must not trust: Unsaved client-only profile state

### Dashboard

- Needs:
  - auth user
  - profile
  - candidate summary
  - subjects
  - module progress
  - module batch access
  - recent attempts
  - review queue
- Must not trust:
  - locally guessed free/paid state
  - locally guessed batch availability

### Module detail

- Needs:
  - subject metadata
  - module batch access rows
  - module progress
- Must not trust:
  - static content lists without backend access state

### Practice

- Needs:
  - auth
  - profile completeness
  - candidate summary
  - subject data
  - practice questions
  - explicit batch number context
- Must not trust:
  - URL batch number alone
  - cached question set as proof of access

### Result

- Needs:
  - submit result payload
  - candidate summary refresh
- Must not trust:
  - locally computed next action

### Review history

- Needs:
  - current user's attempt list
  - candidate summary
- Must not trust:
  - client-supplied user or module ownership

### Review detail

- Needs:
  - attempt review rows
  - attempt summary
- Must not trust:
  - query param attempt ID as authorized

### Access/payment

- Needs:
  - candidate summary
  - active pack price
  - payment reference verification result
- Must not trust:
  - redirect params
  - client belief that payment succeeded

## Likely API / RPC calls

- `get_profile` or `ensure_my_profile`
- `update_profile`
- `get_candidate_summary`
- `get_subjects`
- `get_module_progress`
- `get_module_batch_access`
- `get_batch_access_state`
- `start_practice_batch`
- `get_practice_questions`
- `submit_attempt`
- `get_attempt_review`
- `initialize-paystack-payment`
- `verify-paystack-payment`

## Frontend data that must never be trusted for access control

- `subjectSlug` route param
- `batch` query param
- client-stored free-module choice
- client-stored payment success assumption
- local attempt score calculation for next-action decisions
- visibility of a button as proof of permission

# 19. Edge Cases

## User refreshes during practice

- The browser should warn before reloading where browser APIs permit it.
- If the user confirms the reload, discard temporary answers, flags, position, order, and timer.
- Show a neutral restart state before loading a fresh set; the new timer begins only after `Start again`.
- Re-run normal access checks and generate a new session when practice restarts.
- A refresh must never submit or create a permanent attempt.

## User opens practice URL directly

- Require auth.
- Require profile completion.
- Require backend batch access validation.
- If free module is not yet confirmed, show start-from-dashboard guidance.

## User opens review URL for another user's attempt

- Backend must deny it.
- Frontend shows friendly unauthorized or not-found state.

## User opens invalid attempt

- Show `This review could not be found.`
- CTA back to Review History or Dashboard.

## Payment succeeds but redirect fails

- Access should still become active when verification or webhook completes.
- User can return to Access later and see active status.

## Payment verification delayed

- Show pending state with reference.
- Provide retry verification button.

## No published questions

- Show Coming Soon or not-available state.
- No Start CTA.

## Unpaid user attempts paid batch URL

- Show locked-for-payment state, not raw RPC error.

## Paid user opens unpublished batch

- Show Coming Soon state.
- Do not treat paid status as override for unpublished content.

## App loses network

- Show recoverable network error state.
- Keep local practice answers in memory until refresh if possible.

## Expired session

- Redirect to sign-in.
- Preserve safe return path.

## Profile incomplete

- Redirect to dashboard onboarding flow.

## User signs out mid-flow

- Auth clears and protected screens redirect out.
- Unsaved in-progress practice answers are lost.

## Batch was published after user loaded dashboard

- Refresh dashboard data on return or pull-to-refresh.
- Avoid treating stale dashboard as authoritative.

## Batch was archived after user opened practice

- In-progress started session can complete if policy allows, or submission returns graceful failure if the batch became invalid.
- Product decision needed on whether already-started sessions remain submittable after archival.

## Submitted attempt contains old question snapshot

- Review should still display meaningful historical answers.
- Do not overwrite historical review with latest content silently.

# 20. Recommended UI Implementation Order

## Phase 1. Auth / account creation flow

- Likely files affected:
  - `src/pages/Landing.jsx`
  - `src/pages/Auth.jsx`
  - `src/components/ProfileOnboardingModal.jsx`
  - `src/lib/AuthGuards.jsx`
  - `src/lib/AuthContext.jsx`
- Complete:
  - Clean auth entry
  - Split login/signup if desired
  - Clear onboarding flow and redirect logic
- Test:
  - Signup
  - Login
  - Protected-route redirect
  - Onboarding return target
- Do not change:
  - Supabase auth backend logic
  - Access policy

## Phase 2. App shell and navigation

- Likely files affected:
  - `src/components/AppFrame.jsx`
  - shared CSS files
  - `src/App.jsx`
- Complete:
  - Final primary navigation
  - Mobile bottom nav rules
  - Sign-out confirmation
- Test:
  - Mobile nav
  - Active states
  - Hidden nav during practice
- Do not change:
  - Routes unless necessary and verified

## Phase 3. Dashboard and module cards

- Likely files affected:
  - `src/pages/Dashboard.jsx`
  - module/batch shared components if extracted
  - `src/lib/appApi.js`
- Complete:
  - Access summary
  - Module list
  - Batch cards
  - Free-module confirmation flow
- Test:
  - Free no-selection state
  - Free selected-module state
  - Paid all-published state
  - Coming Soon states
- Do not change:
  - Backend access logic

## Phase 4. Batch cards

- Likely files affected:
  - extracted dashboard/module card components
  - module detail page if introduced
- Complete:
  - Precise batch statuses
  - Review and retry secondary actions
  - Lock and coming-soon states
- Test:
  - Every batch state from backend
  - Correct CTA mapping
- Do not change:
  - Published content status

## Phase 5. Practice flow

- Likely files affected:
  - `src/pages/Practice.jsx`
  - `src/lib/practiceSession.js`
- Complete:
  - Focused layout
  - Question map
  - Submit confirmation
  - Better exit handling
- Test:
  - Direct URL guards
  - Free and paid batch start
  - Retry flow
  - Unanswered submission
  - Timer behavior
- Do not change:
  - Submit RPC contract

## Phase 6. Result flow

- Likely files affected:
  - new result screen or split review/result layer
  - `src/pages/Practice.jsx`
  - `src/pages/Review.jsx`
- Complete:
  - Dedicated result summary
  - Backend-driven next-action CTA
- Test:
  - All next-action variants
- Do not change:
  - Next-action backend rules

## Phase 7. Review history / detail

- Likely files affected:
  - `src/pages/Review.jsx`
  - new review-history components
  - `src/lib/appApi.js`
- Complete:
  - Review history
  - Review detail
  - Filters
  - Retry from history/detail
- Test:
  - Attempt ownership
  - Multiple attempts retained
  - Free vs paid review visibility
- Do not change:
  - Existing attempt storage rules

## Phase 8. Access / payment

- Likely files affected:
  - `src/pages/Access.jsx`
  - `src/pages/PaymentVerify.jsx`
- Complete:
  - Better payment states
  - Pending/success/failed UI
  - Stronger trust copy
- Test:
  - Initialize payment
  - Already-paid state
  - Missing reference
  - Delayed verification
- Do not change:
  - Edge Functions
  - Payment verification logic

## Phase 9. Account / profile

- Likely files affected:
  - `src/pages/Profile.jsx`
  - onboarding/profile form components
- Complete:
  - Better account summary
  - Access status
  - Edit profile later
- Test:
  - Profile display
  - Sign-out path
- Do not change:
  - Account permissions

## Phase 10. Analytics / insights

- Likely files affected:
  - review/dashboard components
  - new aggregate queries if later needed
- Complete:
  - Minimal real-data insights only
- Test:
  - No-attempt empty state
  - Real metrics display
- Do not change:
  - Attempt semantics

## Phase 11. Final mobile polish

- Likely files affected:
  - shared CSS
  - all main pages
- Complete:
  - spacing
  - sticky actions
  - bottom-sheet treatments
  - touch targets
- Test:
  - practice flow on mobile
  - dashboard reading order
  - payment flow on mobile
- Do not change:
  - product rules
  - access logic

# 21. Open Product Decisions

- Practice-tab routing is resolved: open the focused Practice Hub, preserve recent-module continuity, never start a timed practice session automatically, and show module choice when no genuine continuity exists.
- Should bottom nav show during active practice?
  - Recommendation: no.
- Should users be allowed to submit with unanswered questions?
  - Recommendation: yes, with explicit warning.
- Should question flagging ship now or later?
  - Recommendation: now as local-only UI, later for persistence.
- Should review insights be a separate page or a section inside Review?
  - Recommendation: start as a section inside Review.
- Should Current Affairs appear in dashboard now as Coming Soon?
  - Recommendation: yes.
- Should Oral Prep appear now or later?
  - Recommendation: later, or show only as non-CBT future content if business needs visibility.
- Should payment be one-time or duration-based in UI copy?
  - Recommendation: use whatever the entitlement model actually is; do not imply lifetime access unless confirmed.
- Should account creation collect ministry/department now or later?
  - Recommendation: later; keep onboarding lighter.
- If a published batch is archived after a user already started it, should submission still be accepted?
  - Recommendation needed.
- Should review rely on immutable question snapshots per attempt or current question text plus historical answer record?
  - Recommendation: immutable or stable historical snapshot behavior where feasible.

# 22. Final Summary

## Cleanest user journey

The cleanest journey is:

```text
Landing
-> Auth
-> Minimal profile setup
-> Dashboard
-> Start free batch or choose any published paid batch
-> Practice
-> Submit confirmation
-> Result
-> Review
-> Retry / Next / Unlock / Dashboard
```

## Most important screens

- Dashboard
- Practice
- Result
- Review History
- Review Detail
- Access / Payment

## Review / attempt storage decision

- Treat started practice as temporary client session state.
- Treat submitted test as permanent attempt record.
- Store every submitted attempt.
- Never overwrite an old attempt when retrying.
- Make all owned attempts reviewable later.

## Paid / free difference

- Free access is one confirmed Batch 1 in one module, with one retry if the first attempt fails.
- Paid access is all published batches in all live modules, with retries and free movement between modules and batches.
- Progress recommends, but does not restrict, paid-user access.

## First UI phase to implement

- Auth/account flow and navigation shell first.
- Then dashboard/module card clarity.
- Then practice/result/review split.

## Contradictions and cleanup notes identified during planning

- Resolved: the landing page now uses module-first practice language and direct authentication routes.
- Resolved: profile and landing copy no longer imply grade-level-scoped practice.
- Current review page combines Result and Review Detail into one screen; planned flows require a clearer separation.
- Current app has no dedicated Review History page yet, even though the product should support review from multiple entry points.
- Current auth redirect preserves pathname only; future redesign should preserve query and hash for precise return flows.
