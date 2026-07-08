# COMPRO Exam Practice App Plan

## Summary
Build a mobile-first React + Supabase paid practice app for Nigerian civil servants preparing for 2026 COMPRO I, II & III exams. Use a 20-question free trial, then unlock the 2026 COMPRO pack after a ₦2,500 Paystack payment, valid until the exam season ends. No standalone Node.js backend is needed for v1; use Supabase Auth, Database, Storage if needed, and Supabase Edge Functions for Paystack secrets/webhooks.

Source basis: OHCSF lists 2026 COMPRO I, II & III circulars and COMPRO services on its official site: https://ohcsf.gov.ng/ohcsf-circular/

## Key Changes
- Product flow:
  - Public landing/dashboard explains COMPRO preparation value and starts free practice.
  - Users sign up with email/password before their trial progress or payment is saved.
  - Free users can attempt 20 published questions total.
  - Paid users unlock the full 2026 COMPRO pack until the configured season end date.
  - Practice supports subject filters, COMPRO level filters, timed mock mode, instant explanations, review history, and score summaries.

- Tech stack:
  - Keep React + Vite frontend.
  - Keep Supabase client in the app for auth and user-safe reads/writes.
  - Add Supabase Edge Functions for `initialize-paystack-payment`, `verify-paystack-payment`, and Paystack webhook handling.
  - Do not add Express/Node.js server unless future needs exceed Edge Functions.

- Database model:
  - `profiles`: user metadata, role `candidate/admin`, created date.
  - `exam_packs`: COMPRO 2026 pack, price, active dates, trial question limit.
  - `subjects`: Public Service Rules, General Knowledge, Current Affairs, Verbal Reasoning, Quantitative Aptitude, and editable future subjects.
  - `questions`: question text, options A-D, correct option, explanation, subject, COMPRO level I/II/III, difficulty, year/source note, status `draft/review/published`.
  - `attempts`: user, mode, pack, started/completed timestamps, score.
  - `attempt_answers`: selected option, correctness, time spent per question.
  - `entitlements`: user pack access, Paystack reference, expiry date, payment status.
  - `admin_audit_logs`: admin content/payment actions.

- Admin workflow:
  - Admin-only question upload form with fields for question, options, correct answer, explanation, subject, COMPRO level, difficulty, source/year note, and publish status.
  - Published questions must have answer + explanation.
  - Admin dashboard shows draft/review/published counts and lets admins edit or unpublish questions.
  - CSV import can be added after the form, using the same validation rules.

- Access control:
  - Supabase RLS protects all tables.
  - Candidates can read only published questions they are allowed to access.
  - Candidates can write only their own attempts/answers.
  - Admins can manage questions, subjects, packs, and audit logs.
  - Paystack secret keys live only in Edge Function environment variables.

## Implementation Plan
- Phase 1: Foundation
  - Replace prototype data with Supabase-backed auth, profile creation, and route guards.
  - Add database migrations/schema for profiles, packs, questions, attempts, answers, entitlements, and RLS.
  - Seed COMPRO 2026 pack, core subjects, and a small set of sample published questions.

- Phase 2: Candidate Experience
  - Build mobile-first dashboard showing trial usage, paid status, subjects, and recommended practice.
  - Build practice engine with filters, timer, question navigation, answer selection, submit, score, explanations, and review.
  - Enforce the 20-question free limit from Supabase, not only in frontend state.

- Phase 3: Payment
  - Add Paystack checkout start from the app.
  - Edge Function initializes Paystack transaction for ₦2,500.
  - Verification/webhook creates or updates `entitlements`.
  - Paid users immediately unlock all published COMPRO 2026 questions.

- Phase 4: Admin Content
  - Add admin route protected by `profiles.role`.
  - Build question create/edit/publish screens.
  - Add validation so published questions require options A-D, correct option, explanation, subject, and COMPRO level.
  - Track admin changes in audit logs.

- Phase 5: Launch Polish
  - Add empty/loading/error states.
  - Add simple analytics events for signup, trial start, trial exhausted, checkout started, payment success, mock completed.
  - Add FAQ/support contact for payment issues.
  - Prepare deployment on Vercel/Netlify plus Supabase project configuration.

## Test Plan
- Auth:
  - New user signs up, profile is created, and dashboard loads.
  - Logged-out users are redirected from practice/admin-only pages as appropriate.

- Trial:
  - Free user can answer up to 20 questions.
  - Free user cannot access more than 20 trial questions after refresh or new device login.
  - Paid user bypasses trial limit.

- Practice:
  - Timer, navigation, answer saving, submit, scoring, and explanations work on mobile and desktop.
  - Filters return only published questions matching selected subject/COMPRO level.

- Payment:
  - Successful Paystack test payment creates active entitlement.
  - Failed/cancelled payment does not unlock content.
  - Duplicate webhook does not create duplicate entitlement.

- Admin:
  - Admin can create, edit, publish, and unpublish questions.
  - Non-admin cannot access admin routes or mutate question records.
  - Invalid question cannot be published.

## Assumptions
- v1 targets COMPRO promotion exams, not FCSC recruitment CBT.
- v1 covers COMPRO I, II & III together.
- Free trial is 20 questions total per account.
- Paid pack is ₦2,500 for COMPRO 2026 access until exam season ends.
- Every published question must include answer + explanation.
- Launch platform is a mobile-first web app, with PWA/native app deferred.
- Paystack is the payment provider.
- Supabase Edge Functions replace the need for a separate Node.js backend in v1.




 now i want you to critically understand me, what we want to build is an app for an exam, civil service promotional exam, so there are going to be questions and people are going to use it to test themselves for that exam on different subjects, and they are going to pay, we must be stragetic, it should be engaging but mature, its basically a software for them to learn and prepare for their exam, with explanations, reference, rubust if necessary, but easy to use and simple, it must not look like a vibe coded slop, and it must be original, so they feel the quality, and after they use a free trial, its either they pay one time or smth, lets plan that. So yh, i think thats all, lets plan strategically, from ui to db




Before any tools or code — let me show you I       actually gelay out thestrategy, then lock the few decisions that change  everything
                                                   What I unde
                                                   This isn't nesssoftware for a high-stakes, career-defining test.  Your user irvant, on amid-range phone, on metered data, who is paying    because pas — moremoney, more seniority. That reframes everything:   
- The buyer's only real question is "Will this     actually hed outcomesbeat features.                                     - "Quality tent +explanations that cite real authority (Public      Service Rulessionalinterface that respects their time.                - "Not vibeespokedesign system, not a generic template look. One    consistent,
- "Engaging but mature" = motivation through       progress aneas,review), not cartoon badges and confetti.          - "Simple + surfacewith real depth underneath (learn mode, mock mode, spaced revi
                                                   The single s contenttrust. If one answer is wrong or unexplained, they stop believ systemshould be built to protect and showcase content
quality.

Strategic p

1. Two distof a realprep tool):                           - Learn / P explanation + reference, no timer. This is where v- Mock Examack untilthe end, then full review. This is wheis proven.
                                      2. A learnidump:
- Every wrong answer feeds a "Review yspots" queu
- Readiness score per subject & level know where next. Thisis the retention engine and the thing screenshotsof-mouth.

3. Credibil
- Every published explanation carries a
reference/cr, section). Cheap to author, enormous trust payoff.
- A "reportflag issues→ you fix → they trust you more. Turns the crowd
into your Q
- Your existing draft → review → published workflow
already sup

4. Monetiza nature:it's a seasonal exam, so a one-time "2026 Season
Pass" fits n. The trial should end on a high (great explanation on question
20), not a bebulk/agency licensing — selling seats to a ministry
or departme ₦2,500 ×individuals.

UI / design direction (how we avoid "slop")

- A real design-token system: one deliberate color
palette (yoained goldis already a mature, civil-service-appropriate base
— we refiney), one type scale, consistent spacing/radii/elevation. Every
screen draw
- Content-first, distraction-free question screen —
it should f-made exam,big tap targets, thumb-reachable actions.
- Original,nts(buttons, cards, progress, result summary),
intentionall motion —never the generic gradient-card AI-dashboard look.
- Built foron cheapAndroids, and a PWA so it installs and works offline
/ low-data iator here.

Data model schema,which is already solid)

Keep what's there; add strategically:
- topics un + betteranalytics).
- Structureyond thefree-text source_note).
- bookmarks
- user_question_stats (times seen/correct, mastery,
next-review+ readiness.
- question_reports (user-flagged issues → QA loop).
- promo_codts, agencydeals) + renewal-aware entitlements.
- Readiness scoringserver-side, as we already secured).

I'll turn all of this into a concrete UI wireframe set + migra the fourforks below — because each one changes the schema, the paywall











compro_level / "COMPRO" — so the app won't build correctly against this schema until Steps 2–4 are done. That's expected; I'll fix them in sequence.

To apply this (when you're ready): supabase db reset locally, or re-push — it recreates the schema from scratch with the new seed.

Ready for your "ok" to proceed to Step 2 — Edge Functions (remove compro-2026 slug and "COMPRO" text; point them at the active pack).













im building a  exam practice app for civil servant promotion exam in ngeria for levels 7 to 17 and permanent secreteries, comming soon, the questions are on ground already. So the objective is it would be easy to use but not shallow, user would signup with name, phone number , email, state, level, probably civil service organization, and other necessary stuff, but signup musnt be overwhelming . Then the user goes to the dashboard, the current dashboard is definitely not it, we have to define what would be essential in the dashboard and what would also be useful. Then the user probably sees the button to practice the exam, there are going to be three modules, 