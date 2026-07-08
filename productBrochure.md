FPS Exam Practice
Client-Side Product Documentation
1. Project Overview

FPS Exam Practice is a web-based examination practice platform designed for Nigerian civil servants preparing for promotion examinations.

The platform helps users practise questions based on their grade level, review weak areas, monitor their preparation progress, and unlock full access when they need more practice content.

The app is designed to be simple, focused, and serious. It is not a general learning website. It is specifically structured around civil service examination preparation.

The current app supports the following main areas:

Public landing page
User authentication
Candidate dashboard
Grade-level-based practice access
Timed practice sessions
Question review
Weak-area tracking
Payment/access page
User profile
Admin question management

The route structure already supports the major user flows, including dashboard, subject-based practice, review, profile, access, payment verification, and admin management.

2. Purpose of the App

The purpose of FPS Exam Practice is to provide a structured digital environment where civil servants can prepare for promotion exams without depending only on scattered past questions, WhatsApp files, or unorganized materials.

The app is built to help users:

Practise exam-style questions
Focus on relevant modules
Prepare according to their grade level
Track performance over time
Review missed questions
Identify weak areas
Continue preparation after each attempt
Unlock full exam packs when ready

The long-term goal is to make the app a reliable digital practice platform for civil service promotion examinations.

3. Target Users

The primary users are Nigerian civil servants preparing for promotion examinations.

The app currently targets officers within grade levels such as:

GL 07
GL 08
GL 09
GL 10
GL 11
GL 12
GL 13
GL 14
GL 15
GL 16
GL 17

A Permanent Secretary track can also be added as a separate category later.

4. Core Exam Modules

The app is structured around major examination modules. The current core modules are:

4.1 Public Financial Management

This module covers topics such as:

Financial Regulations
Public funds
Approvals
Accountability
Government expenditure
Internal control
Financial responsibility
4.2 Public Service Rules

This module covers topics such as:

Appointments
Promotions
Discipline
Conduct
Leave
Retirement
Civil service procedures
4.3 Current Affairs / General Knowledge

This module covers topics such as:

Nigerian governance
National issues
History
Public institutions
Civic awareness
General knowledge relevant to promotion exams

The app can support more modules later if required.

5. User Flow
5.1 Public Landing Page

The landing page introduces the app to new visitors.

It explains:

What the app is for
Who it is designed for
The main exam modules
How users can start
The free practice model
Full access option

The landing page should remain simple and trustworthy. It should not overload users with too much text.

Main action:

Get started

If the user is already signed in, the action becomes:

Open dashboard
5.2 Account Creation

New users create an account using:

Full name
Email
Password

After account creation, the user can proceed into the app.

Authentication is handled through Supabase Auth in the current implementation. The Auth page supports sign-in and sign-up modes.

5.3 Profile / Exam Setup

Before a user can practise, the app needs important exam identity details.

Required setup information includes:

Full name
Phone number
State
Grade level
Organization name, if available

The grade level is especially important because it determines which questions and modules the user should see.

The setup now happens through a modal-based flow, not necessarily a separate standalone setup page. The dashboard should guide incomplete users with simple wording such as:

Set your grade level

or:

Welcome, Abdulrahman

Add your grade level to begin practice.

Once the profile is complete, the user’s level is locked to their account because it affects:

Question pool
Practice history
Review data
Progress tracking
6. Authenticated Dashboard

The dashboard is the main user workspace after login.

Its purpose is to show the user:

Their preparation status
Available modules
Free question allowance
Recommended next step
Review and progress information when available

The dashboard already loads important user data such as candidate summary, subjects, module availability, progress, attempts, review queue, and onboarding modal state.

6.1 No-Content Dashboard State

When questions have not yet been uploaded for the user’s level, the dashboard should remain calm and minimal.

It should not look like a full analytics dashboard.

Example:

Welcome, Abdulrahman

Your GL 13 practice modules are being prepared. Once questions are uploaded, you’ll be able to practise, review weak areas, and track your progress here.

Free questions: 20/20

Then:

Module readiness

Public Financial Management                Coming soon
Public Service Rules                       Coming soon
Current Affairs / General Knowledge        Coming soon

Then:

After practice

Scores, weak areas, and recent attempts will appear here after your first session.

In this state, the app should not show:

Fake progress
Fake scores
“0 sessions”
“0 weak areas”
“No attempt” repeatedly
Large analytics cards
Large access cards
Start Practice button

The rule is:

No content available = readiness screen.
Content available = full dashboard.
6.2 Active Dashboard State

When practice content is available, the dashboard becomes fuller.

It can show:

Free questions remaining
Attempts
Access status
Module progress
Recommended next action
Weak areas
Recent attempts
Continue practice button

Example dashboard sections:

Welcome, Abdulrahman

Continue your preparation from where you stopped.

Then:

Free questions: 12/20
Attempts: 3
Access: Free

Then:

Recommended next

Review missed questions before your next session.

Then:

Module progress

Public Financial Management        70%
Public Service Rules               55%
Current Affairs                    No attempt
7. Practice Flow

The practice system is subject-based.

There is no generic practice route. Actual practice happens through a subject route such as:

/practice/:subjectSlug

This means the user must choose a module before entering practice. The app route structure already reflects this subject-specific practice design.

7.1 Choosing a Module

When modules are available, the dashboard shows available module cards or rows.

Each module can show:

Module name
Availability status
Sessions completed
Last score
Weak areas
Start or Continue action

Button behavior:

No content available        → Coming soon
Content available           → Start / Continue
Free limit reached          → Unlock full access
Paid user                   → Continue practice

The app must never show:

Start practice

when no questions exist for that module.

7.2 Timed Practice Session

A practice session is timed.

The current implementation uses:

30 questions
30 minutes

The practice page manages:

Current question
Selected answer
Answered count
Flagged questions
Time spent
Timer
Submission
Upgrade prompt when free limit is reached

The Practice page already contains logic for loading subjects, loading practice questions, handling the timer, tracking answers, and submitting attempts.

7.3 Practice Interface

The practice screen should allow users to:

Read each question
Select one answer
Move between questions
See progress
Flag questions
Submit when done
Automatically submit when time ends

The interface should be clear and exam-like, not playful.

8. Free Practice and Access Model

The app allows users to begin with free practice.

Current free question limit:

20 free questions

The purpose of this is to let users experience the platform before paying.

The app tracks:

Number of answered questions
Free questions remaining
Whether the free limit has been reached
Whether the user has paid access

Access-related logic is used across the dashboard, practice page, and access page. The Access page currently loads candidate summary, calculates remaining free questions, and initializes payment when the user chooses to unlock.

8.1 Free User

A free user can:

Sign up
Set exam details
Practise available questions
Use up to the free question limit
Review completed attempts
Decide whether to unlock full access
8.2 Paid User

A paid user can:

Access all available questions for their level
Continue practice beyond the free limit
Review weak areas
Track progress
Use all active exam pack content

If paid access has an expiry date, the app can show:

Active until [date]

If no expiry date is available:

Full access is active.
8.3 Free Limit Reached

When the free limit is reached, the app should show an upgrade message only if there is content available to unlock.

It should not show unlock prompts for empty modules.

Correct behavior:

Content exists + free limit reached = Unlock full access
No content exists = Coming soon
9. Review System

The Review page helps users learn from completed attempts.

After a session, the user can review:

Score
Total questions
Percentage
Correct answers
Wrong answers
Explanations
Recommended next action

The Review page currently supports loading an attempt review, review queue, fallback result data, and recommended action based on score.

9.1 Review Summary

Example:

Latest session

70%

Public Service Rules — 21/30

The app can guide the user based on performance.

Example:

You cleared the mastery line. Repeat the module only if you want a stronger margin.

or:

Use the weak-area queue below, then return to the same module for another run.
9.2 Weak Areas

Weak areas should appear after practice attempts.

If the user has no attempts, the app should simply say:

Complete a practice session to see what needs review.

It should not show fake weak areas.

10. Recent Attempts

Recent attempts allow users to see their practice history.

Each attempt can show:

Subject
Score
Percentage
Date
Link to review

If no attempts exist, the app should say:

Your attempts will appear after your first practice session.

In the no-content state, recent attempts do not need to be shown as a separate large card.

11. Profile Page

The Profile page shows the user’s saved account information.

Current profile fields include:

Full name
Email
Phone number
State
Organization
Service level

The Profile page currently renders these account details inside the authenticated app frame.

Profile details matter because the user’s grade level determines the question pool and progress history.

12. Access Page

The Access page explains the user’s current access status.

It shows:

Free account or paid access
Free questions remaining
Answered questions
Payment action if unpaid
Paid access status if already unlocked

The Access page should be clear and simple.

It should not pressure users unnecessarily when no content exists yet.

Access information is most useful when:

Questions are available
User is close to the free limit
User has reached the free limit
User wants full access
User is already paid
13. Payment Verification

After payment, the user is returned to the app for verification.

The payment verification page checks payment status using the payment reference.

If successful:

Payment confirmed. Full access is now active on your account.

If not successful:

We could not confirm payment yet. Please try again shortly.

The Payment Verify page currently handles reference lookup, payment verification, success state, and return navigation.

14. Admin Console

The Admin Console is used to manage the question bank.

Admin users can:

View active exam pack
View subjects
View question counts
Add questions
Edit questions
Save question explanations
Set service level scope
Set difficulty
Publish or keep questions in draft/review status
View audit logs

The Admin page currently supports question management, question validation, active pack loading, subject loading, question counts, admin questions, and audit logs.

14.1 Question Fields

A question can include:

Exam pack
Subject/module
Service level
Difficulty
Question text
Option A
Option B
Option C
Option D
Correct option
Explanation
Reference note
Source note
Status

Published questions should include explanations.

14.2 Question Status

Questions can support statuses such as:

Draft
Review
Published

Only clean and approved questions should be published for users.

15. Empty State Philosophy

The app must handle empty states properly.

This is important because the platform may launch before all questions are uploaded.

Good empty states should be:

Calm
Honest
Short
Not broken-looking
Not fake
Not repetitive

Bad empty states include:

Showing fake progress
Showing “0%” like the user failed
Showing “Start Practice” when no questions exist
Showing “Unlock Access” for unavailable modules
Repeating “questions are being prepared” many times
Showing full analytics before any practice exists

Correct rule:

If content is unavailable, show readiness.
If content is available, show dashboard activity.
16. Mobile Experience

The app should be mobile-first because many civil servants may use phones.

Mobile requirements:

Compact header
Clear app name
Grade level badge
Simple hamburger menu
Vertical menu rows
No horizontal nav links inside mobile menu
No huge menu card
No oversized sign-out button
No horizontal overflow
Short dashboard sections
Compact readiness list
Minimal empty states

Mobile header target:

FPS Exam Practice        GL 13        Menu

Opened mobile menu:

Dashboard
Practice
Review
Access
Profile

Sign out

The mobile dashboard should avoid becoming a long wall of cards.

17. Desktop Experience

Desktop can use a sidebar layout.

Desktop sidebar should contain:

App name
Subtitle
Grade level badge
Dashboard
Practice
Review
Access
Profile
Sign out

The sidebar should be light and functional. It should not look like a large decorative card.

Main desktop content should be constrained to a comfortable width so simple dashboard states do not stretch awkwardly.

18. Navigation Behavior

Authenticated navigation should include:

Dashboard
Practice
Review
Access
Profile
Sign out

Important behavior:

Practice nav → /dashboard#modules

This is because practice is subject-specific and should not automatically start a random module.

The actual practice page remains:

/practice/:subjectSlug

This avoids surprising the user.

19. Error Handling

The app should never expose raw developer or database errors to users.

Users should not see:

Column names
Table names
Supabase internal errors
PGRST messages
“relation does not exist”
“column does not exist”
raw schema errors

The app should show friendly messages such as:

We could not load your dashboard right now. Please try again.

or:

We could not load questions for this module. Please try again.

Raw errors can be logged for developers, but not displayed to users.

20. Visual Design Direction

The visual style should be:

Minimal
Calm
Official
Exam-focused
Professional
Trustworthy

The app should avoid:

Too many colors
Too many cards
Too many shadows
Too many badges
Repeated headings
Random font sizes
Loud gold labels
Button-looking disabled states
Marketing-style dashboard sections

The dashboard should feel like a civil service study portal, not a marketplace, not a social app, and not a flashy SaaS dashboard.

21. Recommended Color Direction

A restrained palette is better.

Suggested direction:

Background: #f8fafc
Surface: #ffffff
Text: #0f172a
Muted text: #64748b
Border: #e2e8f0
Primary green: #064e3b
Soft green: #ecfdf5
Soft warning: #f8f5e8
Warning text: #8a6d1d

Green should be used mainly for:

Active nav
Primary action
Important status

Gold or beige should be used only for subtle “Coming soon” status.

22. Content Upload Readiness

The app is designed to support gradual content upload.

If questions are not ready for a level, the user should see:

Your GL 13 practice modules are being prepared.

Then:

Module readiness

Public Financial Management        Coming soon
Public Service Rules               Coming soon
Current Affairs                    Coming soon

This allows the app to launch or test without pretending content exists.

23. Future Improvements

Future improvements can include:

More exam modules
Permanent Secretary track
Better analytics
Score trend graph
Leaderboard, if appropriate
Admin bulk upload
CSV import for questions
More detailed topic tagging
Subscription/expiry management
Email reminders
WhatsApp reminders
Past question year filtering
Timed mock exams across all subjects
Certificate or completion report
24. Current Product Rules

The app should follow these core rules:

Rule 1

Do not allow practice without a completed profile.

Rule 2

Do not show practice buttons where no questions exist.

Rule 3

Do not show unlock buttons for unavailable modules.

Rule 4

Do not show fake analytics.

Rule 5

Do not treat unavailable modules as failed attempts.

Rule 6

Keep empty states calm and honest.

Rule 7

Keep mobile simple and clean.

Rule 8

Keep the dashboard focused on preparation, not decoration.

25. Summary

FPS Exam Practice is a structured civil service exam preparation platform.

It allows users to:

Create an account
Set their grade level
Practise relevant modules
Use free practice questions
Unlock full access
Review completed attempts
Track weak areas
Manage their profile

It also gives admins a way to manage the question bank and prepare content for different grade levels.

The most important design principle is clarity.

When content exists, the app should behave like a full practice dashboard.

When content does not exist, it should behave like a calm readiness screen.

The product should feel official, trustworthy, focused, and easy to use.