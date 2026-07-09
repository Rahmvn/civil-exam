# FPS Exam Practice - Product Blueprint

## 1. Product Summary

FPS Exam Practice is a civil service promotion exam practice platform.

The app helps civil servants prepare for promotion examinations by practising structured questions grouped by exam modules. Users can sign up, complete their profile, practise available modules, review their performance, and unlock full access through Paystack payment.

This is not a school quiz app, not a flashy SaaS dashboard, and not a general learning marketplace. It should feel official, calm, simple, trustworthy, and exam-focused.

The product should help users answer one question quickly:

> "Can I practise for my promotion exam here, see my score, and improve before the real exam?"

Everything in the app should serve that purpose.

---

## 2. Product Name

Working product name:

**FPS Exam Practice**

FPS may stand for Federal Public Service depending on final branding. The app should avoid overexplaining the name in UI until the final brand direction is confirmed.

Tone:

- Serious
- Clear
- Professional
- Calm
- Not playful
- Not childish
- Not overdesigned

---

## 3. Target Users

Primary users are civil servants preparing for promotion examinations.

They may not be highly technical. The app must therefore be simple, direct, and easy to use on mobile.

Expected user needs:

- They want to practise exam questions.
- They want to know if they are improving.
- They want to review wrong answers.
- They want a simple payment flow to unlock more access.
- They do not want a confusing dashboard.
- They do not need unnecessary analytics before they have attempted questions.
- They need a mobile-friendly CBT-like experience.

The app should assume many users will use mobile phones.

---

## 4. Core Product Model

The app is built around these core concepts:

```text
User
-> Profile
-> Exam Pack
-> Modules
-> Questions
-> Practice Attempts
-> Review
-> Access / Entitlement
```

### 4.1 User

A user signs up and logs in.

The user has an authenticated account and a profile.

### 4.2 Profile

The user profile may contain:

- Full name
- Email
- Phone number
- Grade level
- Department or organization if needed later
- Other relevant exam identity fields

Important:

- Grade level is stored for identity, reporting, and possible future filtering.
- Grade level must not currently block question access.

### 4.3 Exam Pack

An exam pack represents the active exam preparation package.

For now, the app should load the active exam pack automatically.

Only questions belonging to the active exam pack should be used in practice.

### 4.4 Modules

The current modules are:

- Public Financial Management / Financial Regulations
- Public Service Rules
- Current Affairs / General Knowledge

Each module has:

- Name
- Slug
- Description
- Question count
- Availability state

Expected slugs:

- `public-financial-management`
- `public-service-rules`
- `current-affairs`

Slug names must remain consistent across:

- Database
- Import JSON files
- Frontend routes
- Dashboard module cards
- Practice page

### 4.5 Questions

Questions are grouped by module.

Current product rule:

- Questions are a shared question pool grouped by module.

This means:

- Questions are not grade-level-specific for now.
- Any authenticated user can practise available published questions.
- Grade level must not be used to block module availability.
- Grade level may be stored for future use.
- Later, level-specific overrides may be added, but they must not break shared questions.

A question should include:

- `subject_slug`
- `difficulty`
- `question_text`
- `option_a`
- `option_b`
- `option_c`
- `option_d`
- `correct_option`
- `explanation`
- `reference_note`
- `source_note`
- `status`

Correct option should be one of:

- `A`
- `B`
- `C`
- `D`

Question statuses:

- `draft`
- `published`
- `archived`

Only published questions should be shown to users in practice.

Development seed questions must be clearly marked and must not be confused with official exam content.

### 4.6 Practice Attempts

A practice attempt is created when a user submits answers.

An attempt should store:

- User
- Exam pack
- Module
- Questions answered
- Selected answers
- Correct answers
- Score
- Total questions
- Date/time submitted

Practice must work even when there are fewer than full production batch sizes during development.

The app should not crash or show empty content simply because the module has only a few test questions.

### 4.7 Review

After submitting practice, the user should be able to review:

- Score
- Correct answers
- Wrong answers
- Explanations
- Reference notes if available

Review must be simple and useful.

The review page should help the user understand what they got wrong, not just display a score.

### 4.8 Access / Entitlement

The app has a free access model and a paid access model.

Users can practise a limited free batch experience before unlocking full access.

After the free allowance is used, the user should be encouraged to unlock full access.

Payment is handled by Paystack.

Access status is stored in entitlements.

Key fields include:

- `user_id`
- `exam_pack_id`
- `paystack_reference`
- `status`
- `amount_kobo`
- `expires_at`
- `metadata`

Paid access must be verified server-side.

Frontend must never contain:

- Paystack secret key
- Supabase service role key
- Any private backend secret

---

## 5. Current Confirmed Working Backend Flows

The following flows are considered working and must not be broken casually:

### 5.1 Authentication

Users can sign in and sign up.

### 5.2 Profile / Onboarding

Users can complete profile information.

Grade level exists as part of profile identity.

### 5.3 Question Import

Questions can be imported from JSON files using:

```bash
npm run import:questions
```

The importer:

- Runs on Node 20
- Uses `ws` as the Supabase realtime transport
- Uses a server-side Supabase client
- Reads the service role key from environment variables
- Handles inserts and updates separately
- Avoids duplicate and null-id issues on rerun

### 5.4 Shared Question Pool

The app now follows a shared question-pool model.

Questions should be loaded by:

- Active exam pack
- Module / subject
- Published status
- Access and free-limit rules

Questions should not be blocked by grade level.

### 5.5 Paystack Payment

Paystack test mode flow works.

Edge Functions:

- `initialize-paystack-payment`
- `verify-paystack-payment`
- `paystack-webhook`

Payment rules:

- Initialize payment server-side.
- Verify payment server-side.
- Activate entitlement only after successful verification.
- Verification must be idempotent.
- The same reference verified twice must not duplicate entitlement.
- Already-paid users should not initialize unnecessary new payments.
- Webhook acts as backup.

Paystack secret key must only exist in server-side Supabase Edge Functions.

---

## 6. Main User Flow

The ideal user journey:

Landing page -> Sign up / Sign in -> Complete profile -> Dashboard -> Choose module -> Practice batch -> Submit -> Review answers -> Continue practice or unlock access

### 6.1 First-Time User

A new user should experience:

1. Opens app
2. Understands what the app does
3. Signs up
4. Completes profile
5. Lands on dashboard
6. Sees available modules
7. Starts a batch
8. Submits answers
9. Reviews score and explanations

### 6.2 Returning Free User

A returning unpaid user should see:

1. Remaining free access
2. Available modules
3. Previous attempts if any
4. Access prompt only where relevant

### 6.3 Paid User

A paid user should see:

1. Full access active
2. Available modules
3. Progress and attempt history
4. Access expiry if relevant

### 6.4 No-Content State

If no questions exist yet, the app should show a calm readiness state.

Example:

```text
Welcome, Abdulrahman

Your practice modules are being prepared.
Once questions are uploaded, you'll be able to practise, review weak areas, and track your progress here.

Modules
Public Financial Management - Coming soon
Public Service Rules - Coming soon
Current Affairs / General Knowledge - Coming soon
```

Important:

- Do not show fake analytics.
- Do not show Start buttons when no questions exist.
- Do not show "questions for this level."
- Do not imply grade level is blocking questions.
- Do not show a large access/payment card when no content exists.

---

## 7. Batch Progression Model

The product should eventually move from simple shared-question access to structured batch progression inside each module.

Rules:

- Each module will have about 100 questions.
- Public Financial Management / Financial Regulations uses 30-question batches.
- Public Service Rules uses 20-question batches.
- Current Affairs / General Knowledge uses 20-question batches.
- Batch size is based on the real exam structure.
- Users attempt one batch at a time.
- A batch is a fixed group of questions.
- If the user scores 70% or higher, the batch is passed.
- Passing a batch unlocks the next batch.
- If the user scores below 70%, the user goes to the review page.
- The review page shows mistakes, correct answers, explanations, and references.
- The user can retry the same batch.
- Retrying the same batch uses the same questions but shuffled.
- The next batch must not unlock until the current batch is passed.
- During development only, the app may allow smaller batches if there are fewer seed questions.

The app should eventually track:

- current batch per module
- attempt count per batch
- highest score per batch
- passed status
- last attempt date

---

## 8. Dashboard Specification

The dashboard is the main authenticated home screen.

Purpose:

Help the user choose a module, continue practice, and understand their access and progress state.

The dashboard should not feel like a generic admin dashboard.

It should not overload users with empty charts or fake metrics.

The dashboard should ultimately show module batch progress, not just random question access.

### 8.1 Dashboard States

The dashboard must support these states:

- A. No questions/content available
- B. Questions available but user has no attempts
- C. User has attempts/progress
- D. Free limit reached
- E. Paid user

### 8.2 State A - No Questions Available

Show:

- Welcome message
- Explanation that modules are being prepared
- Module readiness list
- Free access summary if relevant
- No large access card
- No fake analytics
- No progress cards

Do not show:

- Start buttons
- Fake progress
- Huge empty cards
- Payment CTA as the main focus
- "questions for this level"

### 8.3 State B - Questions Available, No Attempts Yet

Show:

```text
Welcome, Abdulrahman
Choose a module to begin practice.

Free access: available

Modules
Public Financial Management         Start Batch 1
Public Service Rules                Start Batch 1
Current Affairs / General Knowledge Start Batch 1

After practice
Your score, weak areas, and recent attempts will appear here.
```

This should be the main current dashboard state after importing questions.

No fake progress should be shown yet.

### 8.4 State C - User Has Attempts

Show:

- Welcome
- Free or paid access status
- Module list
- Recent attempts
- Basic progress
- Review shortcut
- Current batch status per module where available

Possible metrics:

- Average score
- Total attempts
- Best module
- Weakest module

Only show these when real attempt data exists.

### 8.5 State D - Free Limit Reached

If an unpaid user has used the free allowance:

Show:

- Modules still visible
- Clear access message
- Unlock full access button
- Explanation of what payment unlocks

Do not hide the whole app behind a confusing wall.

### 8.6 State E - Paid User

Show:

- Full access active
- Expiry date if applicable
- Modules
- Attempts/progress
- Review

Do not keep pushing payment CTA after access is active.

---

## 9. Practice Page Specification

The practice page is the most important product screen.

Purpose:

Let users answer questions with minimal distraction.

It should feel like a clean CBT practice screen.

Route:

`/practice/:subjectSlug`

There is no generic `/practice` route unless intentionally added later.

### 9.1 Practice Layout

Desktop:

Top:

- Module name
- Current batch number
- Question count/progress
- Timer if available
- Access/free count if relevant

Main:

- Question text
- Options A-D

Bottom:

- Previous
- Next
- Submit

Mobile:

- Compact header
- Batch number
- Question 1 of N
- Timer
- Question text
- Options
- Navigation buttons
- Submit

### 9.2 Practice Rules

Practice page should:

- Load questions for the selected module.
- Use the active exam pack.
- Use published questions only.
- Respect access and free-limit rules.
- Allow small dev batches.
- Save answers locally during the session.
- Allow the user to move between questions.
- Submit the attempt safely.
- Show the current batch number where batch progression is active.

Practice page should not:

- Require exactly a full production batch during development.
- Crash when only a few dev questions exist.
- Show grade-level blocking copy.
- Say "questions for this level."
- Use grade level as a filter.
- Show unnecessary cards or panels.
- Hide questions behind overcomplicated UI.

### 9.3 Empty Module State

If the selected module has no published questions:

Use copy like:

> Questions for this module are not available yet.

Do not say:

> Questions for this level are not available yet.

### 9.4 Free Limit State

If the user reaches the free limit:

Show:

> You've used your free batch access. Unlock full access to continue practising all modules.

Button:

**Unlock full access**

---

## 10. Review Page Specification

The review page appears after a submitted attempt.

Purpose:

Help the user understand performance and learn from mistakes.

Review should clearly show whether the user passed the batch or needs to retry it.

### 10.1 Review Summary

Show:

- Score: 7/10
- Correct: 7
- Wrong: 3
- Module: Public Service Rules
- Batch: 1
- Date: Today
- Result: Passed or Retry required

### 10.2 Answer Review

For each question, show:

- Question text
- User answer
- Correct answer
- Whether correct/wrong
- Explanation
- Reference note if available

### 10.3 Review Style

Correct answers should be clear.

Wrong answers should be clear but not aggressive.

Avoid too many colors.

Avoid making the page feel like a punishment. It should feel like learning.

### 10.4 Empty Review State

If the user has no attempts:

> No attempts yet. Complete a practice session and your review will appear here.

---

## 11. Free Access Strategy

The free access model should follow structured batch access, not open-ended question counting.

Recommended model:

- Free users can complete Batch 1 of one selected module.
- If they fail the free batch, they can review and retry that same batch once.
- To access another module, Batch 2, unlimited retries, or full progress history, they must unlock full access.
- Paid users get all modules, all batches, unlimited retries, review history, and progress tracking.

This model should eventually replace older free-question-count thinking at the product level.

---

## 12. Access Page Specification

The Access page manages payment and unlock.

Purpose:

Clearly show whether the user has free or full access, and let unpaid users unlock.

Route:

`/access`

### 12.1 Unpaid User

Show:

- Free batch access is active
- You can try a limited batch before unlocking full access
- Unlock full access
- Price

Keep it short.

Avoid long marketing text.

### 12.2 Paid User

Show:

- Full access active
- You can practise all available modules and batches
- Expires: [date]

Do not show another payment CTA if the user is already paid.

### 12.3 Payment Button

Button text:

- Unlock full access

or:

- Continue to payment

On click:

- Call `initialize-paystack-payment`
- Receive `authorization_url`
- Redirect user to Paystack
- Do not expose secret key

---

## 13. Payment Verify Page Specification

Route:

`/payment/verify`

Purpose:

Confirm Paystack payment and activate access.

The page should read:

- `reference`
- `trxref`

Then call the server-side verify function.

### 13.1 Loading State

> Verifying your payment...

### 13.2 Success State

> Payment successful. Full access is now active.

Button:

**Go to dashboard**

### 13.3 Failed State

> We could not verify this payment. If you were debited, please contact support with your payment reference.

Do not show raw backend errors to users.

### 13.4 Missing Reference

> No payment reference was found. Please return to the Access page and try again.

---

## 14. Profile Page Specification

Purpose:

Let the user view or update profile details.

Profile fields may include:

- Full name
- Email
- Phone number
- Grade level

Grade level should be shown as identity, not as a blocker.

Do not write copy that implies:

> Your grade level controls available questions.

Better:

> Your grade level helps us personalize your exam profile.

---

## 15. Admin Page Specification

Purpose:

Help the admin manage questions and content.

Admin should eventually support:

- Add question
- Edit question
- Delete/archive question
- Filter by module
- Filter by status
- View question count by module
- Import status
- Draft/published workflow

Current priority:

The import script is enough for bulk content.

Do not overbuild admin before core user UI is stable.

Admin page should not distract from the main user product.

---

## 16. Landing Page Specification

The landing page is for unauthenticated users.

Purpose:

Explain the product and get users to start.

The landing page should answer:

- What is this?
- Who is it for?
- What can I practise?
- How does access work?
- How do I start?

Suggested sections:

- Hero
- Modules
- How it works
- Access/pricing
- FAQ
- CTA

Tone:

- Direct
- Trustworthy
- Exam-focused
- Not hype-heavy

Example hero copy:

> Prepare for your civil service promotion exam with focused practice questions.
>
> Practise key modules, review your answers, and track your progress before the exam.

CTA:

**Start practising**

---

## 17. Navigation Specification

Authenticated navigation should include:

- Dashboard
- Practice
- Review
- Access
- Profile
- Sign out

Since there is no generic `/practice` route currently, the Practice nav item should either:

- Point to `/dashboard#modules`
- Open the module section
- Be removed until a general practice page exists

Do not link to a broken route.

### 17.1 Desktop Nav

Desktop nav should be simple and horizontal.

Avoid too many buttons.

Active route should be subtle.

### 17.2 Mobile Nav

Mobile nav must be compact.

Header:

`FPS Exam Practice      GL 13      Menu`

or similar.

Mobile menu:

- Dashboard
- Practice
- Review
- Access
- Profile
- Sign out

Rules:

- Vertical menu only.
- No horizontal nav items inside mobile dropdown.
- No huge rounded dropdown card.
- No giant dark close button.
- No giant green Sign out button.
- Sign out should be a normal row.
- Menu rows should be around 44-48px tall.
- Active item should be subtle.
- App name should stay readable.
- User name does not need to be in the mobile header.

---

## 18. Visual Design Principles

The design should feel:

- Calm
- Official
- Focused
- Trustworthy
- Clean
- Mobile-first

Avoid:

- Flashy SaaS gradients
- Random colors
- Overly large cards
- Too many shadows
- Too much green
- Fake analytics
- Cluttered dashboards
- Oversized mobile nav
- Repeated headings
- Cartoonish visuals

### 18.1 Color Direction

Use restrained colors.

Suggested feel:

- Deep green for brand/accent
- White/off-white background
- Dark text
- Muted gray text
- Soft border colors
- Gold accent only if needed

Do not use many bright colors.

### 18.2 Typography

Text should be readable and calm.

Avoid:

- Too many font sizes
- Huge headings everywhere
- Tiny unreadable mobile text
- All-caps overuse

### 18.3 Cards

Cards should be used only when useful.

Avoid making every small thing a big card.

Module rows may be better than large cards on mobile.

### 18.4 Buttons

Primary action:

- Start
- Unlock full access
- Submit

Secondary action:

- Review
- Back
- Previous
- Next

Avoid too many filled buttons on one screen.

---

## 19. Content and Copy Rules

Copy should be short and clear.

Use:

> Questions for this module are not available yet.

Do not use:

> Questions for this level are not available yet.

Use:

> Choose a module to begin practice.

Do not use:

> Explore your personalized learning dashboard.

Use:

> Full access active.

Do not use:

> Congratulations, you have unlocked premium success features.

Use "batch" where relevant in dashboard, practice, review, and access copy.

The tone should be practical, not fake motivational.

---

## 20. Important Anti-Patterns

Codex and future contributors must avoid these.

### 20.1 Product Logic Anti-Patterns

Do not:

- Use grade level to block questions.
- Bring back grade-level-specific filtering unless explicitly requested.
- Require exactly a full production batch before practice can start.
- Show an empty dashboard when imported questions exist.
- Show Start button for modules with no questions.
- Create duplicate payment entitlements.
- Verify payment on the frontend.
- Put secret keys in frontend code.
- Import dev seed questions through production migrations.
- Randomly select a new batch every time.
- Unlock the next batch below 70%.
- Let failed users proceed without passing.
- Treat shuffled retry as a new batch.
- Mix questions from multiple batches in a normal batch attempt.
- Give free users access to too much of the question bank.

### 20.2 UI Anti-Patterns

Do not:

- Redesign the whole app during a small bug fix.
- Add random colors.
- Add fake charts.
- Add fake progress.
- Add huge cards just to fill space.
- Repeat the same heading in multiple places.
- Make mobile nav oversized.
- Turn Sign out into a giant CTA.
- Show Access/payment card when no content exists and payment is irrelevant.
- Use "questions for this level" copy.

### 20.3 Development Anti-Patterns

Do not:

- Change working backend logic during UI polish.
- Change routes without checking `App.jsx`.
- Change database schema casually.
- Modify payment functions during dashboard redesign.
- Modify import script during visual redesign.
- Touch auth, payment, or question logic unless the task requires it.

---

## 21. Frontend Refactor Plan

The frontend should be improved in controlled phases.

Do not rewrite everything at once.

### Phase 1 - Stabilize Real App States

Goal:

Make sure real data appears correctly.

Tasks:

- Dashboard detects available modules.
- Practice loads imported questions.
- Review works after submit.
- Access state shows free/paid correctly.
- Mobile nav works.

### Phase 2 - Authenticated UI Redesign

Goal:

Improve logged-in user experience.

Order:

1. App shell / nav
2. Dashboard
3. Practice
4. Review
5. Access
6. Profile

Do not focus on the landing page yet.

### Phase 3 - Practice Experience

Goal:

Make practice feel like a serious CBT tool.

Tasks:

- Clean question layout
- Better option selection
- Clear navigation
- Submit confirmation
- Mobile-first spacing
- Small batch support

### Phase 4 - Review Experience

Goal:

Make review useful.

Tasks:

- Score summary
- Correct/wrong display
- Explanations
- Retry and continue actions
- Recent attempts integration

### Phase 5 - Admin / Content

Goal:

Prepare for real question entry.

Tasks:

- Question counts by module
- Filter by module/status
- Draft/published flow
- Import validation
- Clear source notes

### Phase 6 - Landing Page

Goal:

Prepare public/client-facing page.

Tasks:

- Hero
- Modules
- How it works
- Pricing/access
- FAQ
- Start CTA

### Phase 7 - Production Readiness

Goal:

Prepare real launch.

Tasks:

- Replace dev questions with real questions
- Confirm Paystack live mode later
- Confirm RLS/security
- Confirm mobile responsiveness
- Confirm error states
- Confirm no secrets exposed
- Confirm build passes

---

## 22. Testing Checklist

Before calling the product ready, verify:

### Auth

- Sign up works
- Sign in works
- Sign out works
- Profile setup works
- Returning user stays logged in

### Dashboard

- Shows modules when questions exist
- Shows Coming soon when no questions exist
- Does not say "questions for this level"
- Does not show fake analytics before attempts
- Shows paid/free state correctly
- Shows module batch progress where available

### Practice

- Loads questions by module
- Works with small question batches
- Shows the current batch number where active
- Allows selecting answers
- Allows navigation
- Submits attempt
- Handles free limit
- Works for paid user

### Review

- Shows score
- Shows correct/wrong answers
- Shows explanations
- Shows pass or retry state
- Handles no attempts

### Access / Payment

- Unpaid user can initialize Paystack checkout
- Paystack redirects back to verify page
- Verify activates entitlement
- Duplicate verify is safe
- Paid user sees full access
- Already-paid user does not start unnecessary payment
- Failed/missing reference states are friendly

### Content

- Questions import correctly
- Second import does not duplicate questions
- Question slugs match subjects
- Status is published
- Dev questions are marked clearly
- Real questions can replace dev questions

### Security

- No Paystack secret key in `src/`
- No service role key in `src/`
- No secrets committed
- Payment verification is server-side
- Entitlements are not client-trusted

### Build

- `npm run lint`
- `npm run build`

Both must pass.

---

## 23. Standard Instruction for Codex

For future work, every Codex task should start with this:

> Read docs/PRODUCT_BLUEPRINT.md first.

Follow the product model strictly.

Do not contradict the shared question-pool model.

Do not use grade level as a question filter.

Do not change working backend, payment, auth, or import logic unless the task explicitly requires it.

Do not redesign unrelated pages.

Keep changes focused and report exactly what changed.

---

## 24. Current Product Priority

Current priority after backend/payment success:

Dashboard -> Practice -> Review -> Access

The app should now be treated as a working product, not a placeholder.

The next major goal is:

Make the authenticated user flow feel clean, serious, and ready for real candidates.

Landing page and final marketing polish should come after the internal app flow is strong.

---

## 25. Final Product Direction

FPS Exam Practice should become a simple, trustworthy, paid exam-preparation tool for civil servants.

The strongest version of the app is not the one with the most features.

The strongest version is the one where a user can:

- Sign in
- Choose a module
- Practise a batch
- Submit answers
- Review mistakes
- Unlock access
- Continue improving

without confusion.

Every design and engineering decision should protect that flow.
