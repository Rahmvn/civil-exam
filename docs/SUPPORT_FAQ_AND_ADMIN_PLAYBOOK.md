im# PromotionSure Support, FAQ, and Incident Playbook

Status: launch-readiness plan  
Created: 22 July 2026  
Audience: product owner, support administrators, operations, and engineering

## 1. Purpose

PromotionSure needs two different support resources:

1. A short candidate FAQ that helps users solve common, safe problems themselves.
2. A private administrator playbook that explains how to identify the scope of a problem, what evidence to collect, what the current admin can safely do, and when the issue must move to operations or engineering.

The FAQ must reduce avoidable requests. The playbook must prevent guesswork. Neither should promise a resolution the system cannot currently perform.

This document complements `USER_PROBLEM_RESOLUTION_AUDIT.md`, which remains the technical failure inventory. This playbook turns that inventory into support operations.

## 2. Core Support Principle

Every issue must be answered in this order:

1. **What is affected?** One account, one module, a group of users, or the whole platform.
2. **What is the authoritative state?** Do not rely only on a screenshot or what one page displayed.
3. **Is money, access, submitted work, identity, or security at risk?** These cases receive priority.
4. **Is retrying safe?** Never tell a user to pay or submit again until the first outcome is known.
5. **Who can resolve it?** Candidate, support admin, payment operations, content admin, or engineering.
6. **How will we verify recovery?** A ticket is not resolved until the affected journey works again.

## 3. Support Boundaries

### Candidate self-service

Candidates may safely:

- correct form input;
- reset a forgotten password;
- reconnect and retry a read operation;
- refresh module/access status;
- resume an active practice where the app offers `Continue` or `Resume`;
- check an existing payment using the same reference;
- submit a help request without sending sensitive information.

Candidates must not be instructed to:

- pay again while an earlier payment is processing or unconfirmed;
- create another account to recover a purchase;
- delete browser data during an unresolved practice attempt;
- share a password, OTP, PIN, card number, CVV, bank credentials, auth token, or full card receipt;
- repeatedly submit an uncertain attempt;
- change device time to fix a timer.

### Support administrator

The current admin interface can:

- search and filter candidate help requests;
- read the candidate's message, category, email, page, date, and payment reference when supplied;
- move a request through `Received`, `In review`, `Resolved`, and `Closed`;
- save a candidate-visible resolution note;
- open a prepared Gmail message to the candidate;
- inspect the automatic Payment attention queue;
- inspect module lifecycle, published-set counts, sales availability, attempts, and active access counts;
- manage content lifecycle and corrections;
- inspect recent admin activity.

The current admin interface cannot safely:

- reset a candidate password;
- edit authentication email or identity;
- manually grant or revoke paid access;
- verify or refund a payment;
- cancel or rewrite a submitted attempt;
- repair database records;
- see a complete account timeline combining auth, entitlement, attempts, payments, and errors;
- publish a platform-wide incident notice.

Those are operational gaps, not actions an administrator should improvise.

## 4. Priority and Scope

### Priority

| Priority | Meaning | Examples | First response target |
| --- | --- | --- | --- |
| P0 | Security, money integrity, or cross-user data is at risk | successful payment with no access, wrong account data visible, payment mismatch | contain immediately; do not close until independently verified |
| P1 | Paid access, submitted work, identity, or a core journey may be lost | dashboard hides entitled module, uncertain submission, widespread login failure | begin investigation urgently |
| P2 | One core journey is blocked without known loss | cannot start a module, password reset issue, content unavailable | same support cycle |
| P3 | Secondary feature or presentation is degraded | receipt download, history detail, confusing copy | normal queue |
| P4 | Cosmetic issue with no functional impact | spacing, label, minor visual defect | product backlog |

### Scope

| Scope | How to recognise it | Response |
| --- | --- | --- |
| Individual | one user, one account, one device, or one payment reference | investigate the account and preserve privacy |
| Module/set | different users fail on the same module, set, question, or timer mode | pause unsafe starts or sales if necessary; content/engineering investigates |
| Cohort | users with a shared property are affected, such as free users or a specific service level | inspect access rules and recent changes |
| Platform | unrelated accounts and modules fail at the same time | declare an incident, stop repetitive ticket-by-ticket diagnosis |
| External provider | Paystack, email delivery, OAuth, or network provider is degraded | verify provider state, give truthful waiting guidance, avoid duplicate actions |

## 5. Intake Checklist

For every request, record only what is needed:

- candidate name and account email;
- category and a short description;
- affected module and practice-set number, when relevant;
- page or action where it happened;
- approximate time and timezone;
- device/browser and whether another device has the same problem;
- the exact message visible to the candidate;
- payment reference only for payment cases;
- whether the issue is still happening;
- whether a retry, refresh, sign-out, or second payment has already been attempted.

Never request passwords, OTPs, PINs, card details, bank credentials, access tokens, or complete answer text.

## 6. Triage Workflow

### Step 1: Protect the user

- If money may have been taken, tell the candidate not to pay again.
- If submission outcome is uncertain, tell the candidate not to submit repeatedly.
- If answers may still exist locally, do not tell the candidate to clear browser storage.
- If cross-user information is visible, treat it as P0 and stop normal handling.

### Step 2: Check scope

- Search the queue for the same module, page, wording, payment state, or time window.
- Check whether the issue reproduces with another controlled account.
- Check the module's lifecycle, published-set count, candidate availability, and sales state.
- Check Payment attention for money/access cases.

### Step 3: Establish the source of truth

Use the system that owns the state:

- authentication and sessions: Supabase Auth;
- candidate identity and service level: profile record;
- module visibility and start eligibility: server catalogue/access RPCs;
- paid access: payment order plus active entitlement;
- payment success: Paystack verification plus server fulfillment state;
- practice completion: server attempt state;
- published content: module, practice-set, and question lifecycle state;
- candidate-visible request outcome: support request status and resolution note.

### Step 4: Resolve or escalate

- Use the documented safe action.
- If the UI does not provide the necessary action, escalate instead of editing records informally.
- Link duplicate reports to one incident internally when the same root cause is confirmed.

### Step 5: Verify and close

Before selecting `Resolved`, confirm one of these:

- the candidate can complete the blocked action;
- access and payment state agree;
- the module/set is correctly available or truthfully unavailable;
- the candidate confirms recovery;
- engineering or operations provides verifiable evidence of recovery.

Use `Closed` for duplicates, spam, requests withdrawn by the candidate, or a resolved case after the follow-up window. Do not use `Closed` to hide unresolved work.

## 7. Candidate FAQ Content

The FAQ should be searchable, use plain language, and show no more than one primary action per answer. It should appear before the request form on `/help`, with the request form still easy to reach.

### Account and sign-in

#### I forgot my password

Use `Forgot password?` on the sign-in page. Open the newest reset email and follow the link. If the link has expired, request a new one. Never share the reset link or code with anyone.

**Contact support when:** no reset email arrives after checking the correct inbox and spam folder, or the newest link repeatedly fails.

#### My email or password is not accepted

Confirm that the email is the one used to create the account. Passwords are case-sensitive. If you are unsure of the password, reset it instead of repeatedly guessing.

**Contact support when:** password reset succeeds but the account still cannot sign in.

#### I did not receive an account email

Check spam/junk, search for `PromotionSure`, and wait a few minutes before requesting another email. Use only the newest link sent.

#### My name, email, or service level is wrong

Send a signed-in help request under `Account details or sign-in`. State what is wrong and what it should be. Do not create another account if the existing account has payment or practice history.

#### I was signed out

Sign in again. If you were in practice, use the available `Continue` or recovery action. Do not clear browser data until the attempt state is known.

### Modules and access

#### Why can I see only some modules?

The dashboard should show the current candidate catalogue, including modules that are available, locked, or coming soon. Refresh the page once. If modules still disappear, send a `Module access` request and name the missing modules.

#### A module is available in admin but I cannot see it

A module may exist without being candidate-ready. It needs the correct lifecycle state and published practice content. Sales availability controls new purchases separately from visibility and existing access.

#### The module says locked even though I paid

Open the module/access page and check the payment status once using the same reference. Do not pay again. If payment is confirmed but access remains locked, send a `Payment` request with the PromotionSure payment reference.

#### Why can I not buy a visible module?

The module may be visible while new sales are paused. Existing candidates may retain access even when new purchases are disabled.

#### My free practice is assigned to another module

Free practice is attached to the module you first confirmed. Continue that module or unlock another module. Support should not silently move completed free-practice history.

#### Practice is not available yet

The module may not have a published practice set yet, or the content may be temporarily paused. Return to the dashboard and choose another available module.

### Objective practice

#### The timer stays at 00:00 or the page keeps blinking

Leave the unstable page using the app's exit action if it responds, then reopen the module once. Do not repeatedly tap Start. If it happens again, send a `Technical problem` request with the module, set, device/browser, and approximate time.

#### I exited practice but the timer or session did not reset

Return to the dashboard and reopen the module. If the app still offers the same active session after a deliberate exit, send a `Practice attempt` request. Do not start multiple tabs for the same practice.

#### I refreshed or closed the page during practice

Reopen PromotionSure and use `Continue` or `Resume` if offered. The app may restore a saved draft, but unsaved work cannot always be recovered. Do not clear browser data before checking.

#### My answers are not saving

Check the connection indicator and keep the page open. If the app says the answer is unsaved, reconnect and wait for confirmation. Do not submit until the connection is stable unless the timer requires it.

#### I submitted but did not see a result

Do not submit repeatedly. Open Review/History to check whether the attempt completed. If no result appears, send a `Practice attempt` request with the module, set, and approximate submission time.

#### A question or answer appears wrong

Finish or safely exit the attempt, then send a `Question or answer content` request. Include the module, practice-set number, question position, and a brief explanation. Do not paste a full paid question bank.

### Oral practice

#### The app says another oral practice is active

Use the `Resume` action to continue the existing attempt. Only one oral practice can be active at a time.

#### My oral response did not save

Keep the page open, reconnect, and wait for the save state to update. If the attempt advances but the response appears missing, stop and send a `Practice attempt` request with the module, set, question number, and time.

#### The timer expired while I was offline

Reconnect and let the app recover the server state. Do not open another oral set while the first attempt is being reconciled.

#### I cannot see the model answer

Model answers are available after the oral attempt is completed. Resume and complete the active attempt first.

### Payments

#### My payment was declined or cancelled

No module should unlock from an unsuccessful payment. Confirm the provider did not debit you before starting a new payment.

#### Payment is still processing

Do not pay again. Wait and use `Check again` with the same reference. Processing can take time to reach a final state.

#### I was charged but the module is locked

Do not pay again. Use the payment reference shown by PromotionSure to check the payment once, then send a `Payment` request if access is still missing.

#### I returned from payment without a success page

Open PromotionSure again and check the module/access page. Payment verification and access can complete even when the return page was interrupted.

#### I need a receipt

Use the payment history/receipt action when available. If the receipt cannot be generated, keep the payment reference and contact support; receipt failure does not invalidate a confirmed payment.

#### I want a refund or I disputed the payment

Send a `Payment` request with the PromotionSure reference and reason. Do not send card or bank credentials. Refunds and disputes require payment operations review and must not be promised by first-line support.

### Connection and device

#### PromotionSure says I am offline

Reconnect to the internet and retry the current action once. Read-only pages are safe to refresh. Payment and submission actions should be checked before repeating.

#### The page is blank, blinking, or outdated

Close duplicate PromotionSure tabs, reopen the site, and refresh once. If the problem continues, report the page, device/browser, approximate time, and whether another device behaves the same way.

#### Buttons or text highlight when I tap on mobile

A brief touch response is normal; persistent selection or a control that does not activate is not. Report the exact control and device/browser.

#### Can I use multiple tabs or devices during practice?

Use one tab and one device for an active timed practice. Multiple active views can create confusing session state.

### Support and safety

#### What should I include in a help request?

Include what you tried, what you expected, what happened, the affected module/page, and the approximate time. For a payment issue, include only the PromotionSure payment reference.

#### What should I never send?

Never send a password, OTP, PIN, card number, CVV, bank login, access token, or full authentication link. PromotionSure support should never ask for these.

#### How do I follow my request?

Open `/help` while signed in. The request will show as `Received`, `In review`, `Resolved`, or `Closed`, with a resolution note when supplied.

## 8. Internal Resolution Playbooks

### 8.1 Account and authentication

| Symptom | Scope check | Admin action | Escalate when | Verification |
| --- | --- | --- | --- | --- |
| Incorrect password | search for similar reports; confirm user is using the correct email | direct candidate to password reset; retain ticket if reset fails | reset email absent/repeatedly invalid; auth outage suspected | candidate signs in successfully |
| Confirmation/reset email absent | compare multiple accounts and email providers | ask candidate to check spam and use the newest email only | delivery fails across users or provider logs show failure | newest link opens and completes |
| Account email/name is wrong | confirm signed-in account and whether payment/history exists | collect requested correction; mark In review | identity field needs privileged change | corrected account retains access/history |
| Session expires repeatedly | determine device-specific vs multi-user | ask candidate to sign in once and retry; record browser/time | repeated across accounts, token/session errors, or practice loss | session remains active through the journey |
| Admin routed as candidate | check whether other admin pages fail | do not change user metadata; escalate role/profile authority issue | always | admin role is verified server-side and route opens |

### 8.2 Module visibility and entitlement

| Symptom | Scope check | Admin action | Escalate when | Verification |
| --- | --- | --- | --- | --- |
| One candidate cannot see a module | compare another candidate; check module lifecycle and published sets | refresh authoritative catalogue; record missing module and account | entitlement/catalogue disagree | module appears with correct action |
| Many candidates cannot see one module | check module status, published set count, candidate availability | content admin corrects lifecycle/publication if misconfigured | state is correct but module is still absent | two controlled candidate accounts see it |
| Module visible but cannot start | inspect published sets and candidate availability | correct content availability if it is an admin configuration issue | server denies valid access or active attempt conflicts | candidate starts exactly one valid attempt |
| Paid candidate appears locked | check Payment attention, provider state, fulfillment, and active entitlement | tell candidate not to pay again; link/open payment request | payment succeeded without active access | entitlement active and module starts |
| Module exists but is not on sale | confirm this is intentional | enable sales only after price, content, and launch decision are approved | unclear commercial decision or payment config | eligible candidate sees purchase action |
| Free module is different from expectation | confirm first free-module assignment and attempts | explain policy; do not rewrite history casually | assignment occurred without candidate confirmation or state contradicts record | correct assigned module is shown consistently |

### 8.3 Objective practice

| Symptom | Scope check | Admin action | Escalate when | Verification |
| --- | --- | --- | --- | --- |
| Timer at 00:00/blinking | reproduce with same module/set and mobile browser; search same-module reports | mark In review; advise one safe exit/reopen; preserve details | repeats, affects more than one account, or page is unusable | timer starts once, page remains stable |
| Exit does not end session | determine objective vs oral and whether active state remains server-side | advise return to dashboard and reopen once | deliberate exit leaves a stale active session | no stale resume; a new session starts cleanly |
| Start fails | check module/set availability and existing active session | correct content config if applicable; otherwise retain chosen module/set in case notes | valid published content and access still fail | start allocates and navigates once |
| Questions unavailable after start | check whether set was archived/replaced/unpublished | pause unsafe starts; content admin verifies publication | allocated attempt references unavailable content | controlled attempt loads all questions |
| Draft/answers lost | identify refresh, tab close, storage restrictions, or device switch | do not promise recovery; collect attempt/time/device | server/local recovery should exist but does not | recovered draft or truthful clean restart |
| Submit outcome uncertain | check Review/History before advising retry | tell candidate not to submit repeatedly | no completed result and session cannot resume | exactly one completed attempt/result exists |
| Review missing/partial | check whether summary exists and attempt belongs to user | direct to history and retry read once | authoritative attempt exists but detail fails | owned result and answers load |

### 8.4 Oral practice

| Symptom | Scope check | Admin action | Escalate when | Verification |
| --- | --- | --- | --- | --- |
| Active-attempt conflict | identify active module/set | tell candidate to resume existing attempt | resume metadata/action is missing | active attempt opens correctly |
| Response save fails | check connection and whether question advanced | tell candidate to keep page open and reconnect | server state and displayed response disagree | save state confirms without duplicate advance |
| Timer/offline advance conflict | capture question number and time | stop new attempts; mark In review | server current question is unclear | attempt resumes at one authoritative question |
| Question removed mid-attempt | check content activity and other reports | pause/repair affected content through safe lifecycle workflow | any active attempt references missing content | active attempt completes or exits safely |
| Model answer unavailable | confirm attempt completion | direct candidate to finish/resume | completed attempt still cannot load review | model answer and key points display |

### 8.5 Payment and access

| Symptom | Authoritative check | Admin action | Escalation | Verification |
| --- | --- | --- | --- | --- |
| Cancelled/declined | provider status is not success; no active entitlement | explain no access was unlocked; candidate may begin a fresh payment after confirming no debit | provider/account shows contradictory debit | new payment is optional and old order stays non-active |
| Processing longer than expected | Payment attention shows `Processing delayed` after the threshold | tell candidate not to pay again; keep In review | payment remains non-final or provider is degraded | final provider state is recorded |
| Success but no access | provider success plus fulfillment not fulfilled/entitlement inactive | treat as P0; keep reference; do not ask for another payment | always to payment operations/engineering | active entitlement exists and module starts |
| Missing/changed callback reference | look up only an owned payment reference | return candidate to access/status check | owned payment cannot be found or foreign reference appears | correct owned order is displayed |
| Duplicate payment concern | compare references, amounts, module, and timestamps | do not promise refund; preserve both references | more than one successful charge | operations records final disposition |
| Refund pending/dispute | Payment attention label and provider record | acknowledge review; avoid access/refund promises | always to payment operations | provider and entitlement follow approved policy |
| Receipt failure | confirmed payment remains authoritative | provide/copy reference and retry receipt action later | receipt generation consistently fails | receipt works or alternative confirmation is delivered |

### 8.6 Content quality and availability

| Symptom | Scope check | Admin action | Escalate when | Verification |
| --- | --- | --- | --- | --- |
| Wrong answer/explanation | identify module, set, question position, version | review source; use `Correct` for published questions | answer affects scoring/history or source is disputed | replacement is reviewed and published safely |
| Duplicate/missing question | inspect set validation and question positions | correct draft or create a published revision/replacement | active attempts are affected | readiness passes and candidate set is complete |
| Set will not publish | inspect every readiness blocker | fix count, positions, options, answer, model answer, or key points | validation is incorrect despite valid content | validation passes and one deliberate publish succeeds |
| Published set disappears | inspect lifecycle/activity and module status | restore only through the supported lifecycle action | unexplained mutation or active attempts affected | catalogue and controlled start agree |
| Module active with zero published sets | confirm launch intent | publish validated content or change module lifecycle/candidate availability | it was previously live or paid users are affected | no misleading Start/Purchase path remains |

### 8.7 Technical and platform incidents

| Symptom | Scope check | Admin action | Escalate when | Verification |
| --- | --- | --- | --- | --- |
| Blank/blinking/render loop | compare routes, browsers, accounts, and app version | collect minimum reproduction; advise one reload | repeatable or affects multiple users | affected route remains stable after reload/navigation |
| Offline/network error | distinguish user connection from service failure | advise reconnect and one safe retry | unrelated networks/accounts fail | health checks and user journey succeed |
| Stale app after deployment | compare version/asset behavior | advise a normal refresh once | schema/client mismatch persists | current client loads and reads correctly |
| Rate limiting | identify action and repeated requests | ask candidate to wait; avoid rapid retries | legitimate traffic is broadly blocked | action succeeds after cooldown |
| Browser storage unavailable/corrupt | identify private mode, restrictions, or storage error | avoid clearing recoverable attempt data; test supported browser | active practice cannot recover safely | clean supported session works without lost server state |
| Wrong timer/time behavior | compare server state, device clock, and module | capture device/timezone and stop repeated starts | reproduced or device time is not the cause | timer follows authoritative duration consistently |
| Cross-user data visible | no broad reproduction needed before containment | capture minimal evidence, stop normal handling, restrict exposure | immediately P0 security | security owner confirms containment and regression test passes |

## 9. Complete Technical Issue Index

The following IDs are the maintained exhaustive engineering inventory in `USER_PROBLEM_RESOLUTION_AUDIT.md`. Support should cite the matching ID in an escalation when known.

| Area | IDs | Operational meaning |
| --- | --- | --- |
| Navigation/startup | NAV-01 to NAV-07 | deployment configuration, route/render, offline, partial reads, stale client |
| Authentication/account | AUTH-01 to AUTH-10 | credentials, reset, OAuth, sessions, profile/role, identity correction |
| Module/access | MOD-01 to MOD-08 | catalogue, lifecycle, publication, sales, free assignment, entitlement contradiction |
| Objective practice | OBJ-01 to OBJ-10 | start, navigation, questions, drafts, submit idempotency, result/review |
| Oral practice | ORAL-01 to ORAL-08 | active conflict, autosave, timer/advance, content, review, rating, limits |
| Payment/entitlement | PAY-01 to PAY-14 | eligibility, initialization, provider state, fulfillment, callbacks, replay, mismatch, refunds, receipts |
| Profile/support | PROF-01 to PROF-04 | profile saving/correction, support path, unknown incidents |
| Admin/content | ADM-01 to ADM-09 | validation, imports, publication, concurrency, dependencies, audit, admin authority |
| Platform/operations | OPS-01 to OPS-08 | secrets, observability, health, incidents, version drift, rate limit, storage, time/browser |

## 10. Response Templates

Templates are starting points. The administrator must replace bracketed text and remove irrelevant sentences.

### Acknowledgement

> Hello [first name],
>
> Thank you for reporting this. We are checking [short description of the affected action]. Please do not [pay/submit/start] again while we confirm the current state. We will update this request when the check is complete.
>
> Kind regards,  
> PromotionSure Support

### Need one more detail

> Hello [first name],
>
> To investigate this, please reply with [module and set / exact on-screen message / approximate time / browser and device]. Do not send your password, OTP, PIN, or card details.
>
> Kind regards,  
> PromotionSure Support

### Payment received, access under investigation

> Hello [first name],
>
> We can see that this payment needs an access check. Please do not make another payment for the same module. We are reviewing the payment and module access using reference [reference].
>
> Kind regards,  
> PromotionSure Support

### Resolved

> Hello [first name],
>
> We have resolved the issue affecting [action/module]. Please sign in and try [single verification step]. If the same problem continues, reply to this request with the approximate time it happened.
>
> Kind regards,  
> PromotionSure Support

### Known incident

> Hello [first name],
>
> This is part of a wider issue affecting [journey]. Your account is not the only one affected. [State what is safe: your confirmed payment remains recorded / do not submit again / no action is required.] We will update you when service is restored.
>
> Kind regards,  
> PromotionSure Support

## 11. Admin Resolution Notes

A candidate-visible resolution note should state:

- what was found, in plain language;
- what was changed or confirmed;
- the single action the candidate should take next;
- any safety instruction that still applies.

Good example:

> Your payment was confirmed and access to Public Service Rules is now active. Return to the dashboard and open the module. You do not need to pay again.

Bad examples:

- `Fixed.`
- raw database or provider errors;
- internal blame or speculation;
- `Try again` when the outcome of the first action is uncertain;
- a promise of refund, access, or data recovery that has not been verified.

## 12. Product Implementation Plan

### Phase 1: Launch-safe knowledge base

- Add FAQ search and compact topic sections to the signed-in Help page.
- Keep the first answer visible and use expandable answers for the rest.
- Add contextual links from known error states to the relevant FAQ answer.
- Keep `Send a request` available after each answer.
- Track only anonymous FAQ usefulness events; do not store sensitive query text.

### Phase 2: Better intake

- Prefill category, module, page, stable problem code, and payment reference when the app already knows them.
- Let candidates attach a screenshot only after storage, retention, malware, and privacy rules are defined. Do not launch uploads casually.
- Add duplicate-suggestion prompts when an open request already matches the same user/reference.
- Give every request a short candidate-facing reference.

### Phase 3: Scalable support operations

- Add priority, assignment, tags, and last-response timestamps.
- Separate private internal notes from candidate-visible resolution notes.
- Add saved views: unassigned, payment risk, waiting longest, module cluster, and recently reopened.
- Add safe canned responses with required editable placeholders.
- Add a genuine account diagnostic drawer combining profile, active entitlements, recent attempts, payments, and sanitized error events.
- Keep privileged mutations out of the diagnostic drawer unless each action has authorization, confirmation, audit logging, and a rollback/reconciliation design.

### Phase 4: Incident management

- Detect clusters by stable problem code, route, module/set, and time window.
- Allow related tickets to attach to one incident without losing individual history.
- Add a platform incident banner with start time, affected journeys, safe user action, and recovery state.
- Notify affected open requests when an incident is resolved.
- Create operational dashboards and alerts for payment fulfillment failures, submission uncertainty, profile/role failures, and render loops.

### Phase 5: Governance and learning

- Review the top FAQ searches, request categories, repeated modules, reopen rate, first-response time, and verified-resolution time weekly.
- Convert repeated tickets into product fixes or clearer FAQ answers.
- Review all P0/P1 incidents with a written root cause and regression test.
- Test backup/restore and support-data retention before launch.
- Review this playbook after every material product or policy change.

## 13. Launch Gates for Support

Do not call support launch-ready until:

- every P0/P1 class has containment and a named escalation owner;
- the candidate FAQ is available on mobile and keyboard accessible;
- every FAQ answer has a safe next action and clear escalation point;
- payment success without access appears automatically in Payment attention;
- support can identify account, module, set, time, and reference without requesting secrets;
- internal notes cannot accidentally be shown as candidate resolution notes;
- administrators cannot perform unaudited entitlement/payment mutations;
- a platform incident can be communicated without replying to thousands of tickets individually;
- the team has tested one account-specific issue, one module-wide issue, one payment-access issue, and one platform outage drill;
- resolved cases are verified, not merely marked resolved.

## 14. Immediate Recommended Order

1. Approve the FAQ topics and wording in this document.
2. Build a compact searchable FAQ into `/help`; do not create another oversized support landing page.
3. Add contextual FAQ links from payment, access, practice, and authentication errors.
4. Add priority, internal notes, assignment, and request reference to the admin queue.
5. Build the read-only account diagnostic drawer.
6. Add incident grouping and a platform status message before expecting high user volume.
7. Run support drills and convert failures into automated regression tests.

The first implementation should be the FAQ and improved intake. The diagnostic and incident tools follow because they require careful permissions and data design.
