export const SUPPORT_TOPICS = [
  { id: "popular", label: "Popular" },
  { id: "account", label: "Account" },
  { id: "access", label: "Modules & access" },
  { id: "practice", label: "Practice" },
  { id: "payment", label: "Payments" },
  { id: "content", label: "Questions" },
  { id: "technical", label: "Technical" },
];

export const SUPPORT_FAQS = [
  {
    id: "forgot-password",
    category: "account",
    popular: true,
    question: "I forgot my password",
    answer: "Use Forgot password? on the sign-in page. Open the newest reset email and follow its link. If the link has expired, request a new one.",
    escalation: "No reset email arrives after you check the correct inbox and spam folder, or the newest link repeatedly fails.",
    requestTitle: "Password reset is not working",
    keywords: "login sign in reset email link expired",
  },
  {
    id: "sign-in-rejected",
    category: "account",
    question: "My email or password is not accepted",
    answer: "Confirm that you are using the email that created the account. Passwords are case-sensitive. If you are unsure of the password, reset it instead of repeatedly guessing.",
    escalation: "The password reset succeeds but the account still cannot sign in.",
    requestTitle: "I cannot sign in to my account",
    keywords: "incorrect credentials login rejected",
  },
  {
    id: "account-email-missing",
    category: "account",
    question: "I did not receive an account email",
    answer: "Check spam or junk, search your inbox for PromotionSure, and wait a few minutes before requesting another email. Use only the newest link sent.",
    escalation: "The newest message never arrives or its link repeatedly fails.",
    requestTitle: "Account email did not arrive",
    keywords: "verification confirmation otp recovery inbox spam",
  },
  {
    id: "account-details-wrong",
    category: "account",
    question: "My name, email, or service level is wrong",
    answer: "Send a signed-in help request stating what is wrong and what it should be. Do not create another account if this account has payment or practice history.",
    escalation: "Account information needs correction.",
    requestTitle: "My account information needs correction",
    keywords: "profile grade level identity correction change",
  },
  {
    id: "signed-out",
    category: "account",
    question: "I was signed out unexpectedly",
    answer: "Sign in again. If you were practising, use Continue or Resume when offered. Do not clear browser data until the attempt state is known.",
    escalation: "You are repeatedly signed out or cannot recover an active practice.",
    requestTitle: "I am being signed out unexpectedly",
    keywords: "session expired logout token practice",
  },
  {
    id: "missing-modules",
    category: "access",
    popular: true,
    question: "Why can I see only some modules?",
    answer: "Refresh the dashboard once. It should show the current catalogue, including modules that are available, locked, or coming soon. Starting one module should not make unrelated modules disappear.",
    escalation: "Modules remain missing after one refresh. Name the missing modules in your request.",
    requestTitle: "Modules are missing from my dashboard",
    keywords: "dashboard subjects disappeared catalogue hidden only one module",
  },
  {
    id: "module-locked-after-payment",
    category: "payment",
    popular: true,
    question: "The module is locked even though I paid",
    answer: "Check the payment status once using the same PromotionSure reference. Do not make another payment for the same module while the first payment is being checked.",
    escalation: "The payment is confirmed but the module remains locked. Include only the PromotionSure payment reference.",
    requestTitle: "Payment confirmed but module remains locked",
    keywords: "charged debit entitlement access unlock paid",
  },
  {
    id: "module-not-for-sale",
    category: "access",
    question: "Why can I not buy a visible module?",
    answer: "A module can remain visible while new sales are paused. Existing candidates may retain access even when new purchases are disabled.",
    escalation: "The page offers a purchase action but then says the module is unavailable.",
    requestTitle: "A visible module cannot be purchased",
    keywords: "not on sale unavailable purchase unlock price",
  },
  {
    id: "free-module-assigned",
    category: "access",
    question: "My free practice is assigned to another module",
    answer: "Free practice is attached to the module you first confirmed. Continue that module or unlock another module. Completed free-practice history cannot be moved casually.",
    escalation: "The assignment happened without your confirmation or the dashboard shows conflicting modules.",
    requestTitle: "My free module assignment is incorrect",
    keywords: "trial free batch subject locked another",
  },
  {
    id: "practice-not-available",
    category: "access",
    question: "The module says practice is not available yet",
    answer: "The module may not have a published practice set yet, or its content may be temporarily paused. Return to the dashboard and choose another available module.",
    escalation: "You previously used this module, paid for it, or other candidates can still start it.",
    requestTitle: "Practice is unavailable for my module",
    keywords: "coming soon unpublished no questions batch set",
  },
  {
    id: "timer-zero-blinking",
    category: "technical",
    popular: true,
    question: "The timer stays at 00:00 or the page keeps blinking",
    answer: "Use the app's exit action if it responds, return to the dashboard, and reopen the module once. Do not repeatedly tap Start or open the same practice in several tabs.",
    escalation: "It happens again. Include the module, practice set, device or browser, and approximate time.",
    requestTitle: "Practice timer is stuck or page is blinking",
    keywords: "flicker flash zero time mobile frozen reload",
  },
  {
    id: "exit-session-stuck",
    category: "practice",
    popular: true,
    question: "I exited practice but the session did not reset",
    answer: "Return to the dashboard and reopen the module once. A deliberate exit should not reuse an abandoned timer or leave you trapped on the practice page.",
    escalation: "The app still offers the stale session or timer after a deliberate exit.",
    requestTitle: "Practice session did not end correctly",
    keywords: "exit abandon timer reset resume active attempt",
  },
  {
    id: "practice-refresh",
    category: "practice",
    question: "I refreshed or closed the page during practice",
    answer: "Reopen PromotionSure and use Continue or Resume if offered. The app may restore a saved draft, but unsaved work cannot always be recovered. Do not clear browser data before checking.",
    escalation: "A recoverable attempt is missing or the app cannot resume or exit it.",
    requestTitle: "My practice did not recover after refresh",
    keywords: "closed browser draft answers reload continue",
  },
  {
    id: "answers-not-saving",
    category: "practice",
    question: "My answers are not saving",
    answer: "Keep the page open and check your connection. If the app shows an unsaved state, reconnect and wait for confirmation before leaving the page.",
    escalation: "The connection is stable but answers remain unsaved or disappear after moving forward.",
    requestTitle: "My practice answers are not saving",
    keywords: "draft offline response lost autosave",
  },
  {
    id: "submission-no-result",
    category: "practice",
    popular: true,
    question: "I submitted but did not see a result",
    answer: "Do not submit repeatedly. Open Review to check whether the attempt completed. Repeating an uncertain submission can create confusing results.",
    escalation: "No result appears and the attempt cannot be resumed. Include the module, set, and approximate submission time.",
    requestTitle: "Submitted practice has no result",
    keywords: "score finish completed history submit timeout",
  },
  {
    id: "active-oral-practice",
    category: "practice",
    question: "The app says another oral practice is active",
    answer: "Use Resume to continue the existing attempt. Only one oral practice can be active at a time.",
    escalation: "The app does not show a Resume action or opens the wrong oral set.",
    requestTitle: "I cannot resume my active oral practice",
    keywords: "spoken written response conflict another set",
  },
  {
    id: "oral-response-unsaved",
    category: "practice",
    question: "My oral-practice response did not save",
    answer: "Keep the page open, reconnect, and wait for the save state to update. Do not open another oral set while the first attempt is being recovered.",
    escalation: "The attempt advanced but the response appears missing. Include the question number and approximate time.",
    requestTitle: "An oral-practice response did not save",
    keywords: "oral answer draft advance timer offline",
  },
  {
    id: "model-answer-hidden",
    category: "practice",
    question: "I cannot see the oral-practice model answer",
    answer: "Model answers and key points appear after the full oral attempt is completed. Resume and finish the active attempt first.",
    escalation: "The attempt is completed but its model answers still do not load.",
    requestTitle: "Completed oral review has no model answer",
    keywords: "review key points hidden complete",
  },
  {
    id: "wrong-question-answer",
    category: "content",
    popular: true,
    question: "A question or answer appears wrong",
    answer: "Finish or safely exit the attempt, then report the module, practice-set number, question position, and a brief explanation of the concern.",
    escalation: "The question, correct answer, explanation, or source appears inaccurate or incomplete.",
    requestTitle: "A question or answer needs review",
    keywords: "incorrect option explanation duplicate typo source content",
  },
  {
    id: "payment-declined-cancelled",
    category: "payment",
    question: "My payment was declined or cancelled",
    answer: "An unsuccessful payment should not unlock a module. Confirm that the provider did not debit you before choosing whether to begin a new payment.",
    escalation: "Your bank or provider shows a debit even though PromotionSure shows the payment as unsuccessful.",
    requestTitle: "Declined payment may have debited me",
    keywords: "failed abandoned paystack cancelled card",
  },
  {
    id: "payment-processing",
    category: "payment",
    popular: true,
    question: "My payment is still processing",
    answer: "Do not pay again. Wait, then use Check again with the same reference. Processing payments can take time to reach a final state.",
    escalation: "The payment remains processing after the displayed waiting period.",
    requestTitle: "Payment has been processing too long",
    keywords: "pending delayed status verify reference",
  },
  {
    id: "payment-return-interrupted",
    category: "payment",
    question: "I returned from payment without a success page",
    answer: "Open PromotionSure again and check the module or Access page. Verification and access can complete even when the return page was interrupted.",
    escalation: "The payment is confirmed by the provider but no access or payment record appears.",
    requestTitle: "Payment return was interrupted",
    keywords: "callback redirect closed success page paystack",
  },
  {
    id: "payment-refund-dispute",
    category: "payment",
    question: "I need a refund or disputed a payment",
    answer: "Send a Payment request with the PromotionSure reference and reason. Do not send card or bank credentials. Refunds and disputes require payment review.",
    escalation: "A refund or dispute needs to be reviewed.",
    requestTitle: "Payment refund or dispute review",
    keywords: "reversal chargeback money return",
  },
  {
    id: "offline",
    category: "technical",
    question: "PromotionSure says I am offline",
    answer: "Reconnect and retry the current action once. Read-only pages are safe to refresh. Payment and submission outcomes should be checked before repeating them.",
    escalation: "Other sites work but PromotionSure repeatedly cannot connect, or several users are affected.",
    requestTitle: "PromotionSure cannot connect",
    keywords: "network failed fetch internet timeout",
  },
  {
    id: "blank-outdated-page",
    category: "technical",
    question: "The page is blank, blinking, or looks outdated",
    answer: "Close duplicate PromotionSure tabs, reopen the site, and refresh once. Avoid repeatedly reloading an active practice or payment page.",
    escalation: "The problem continues. Include the page, device or browser, approximate time, and whether another device behaves the same way.",
    requestTitle: "A page is blank, unstable, or outdated",
    keywords: "render crash stale deploy flicker flash white screen",
  },
  {
    id: "multiple-tabs",
    category: "technical",
    question: "Can I use multiple tabs or devices during practice?",
    answer: "Use one tab and one device for an active timed practice. Multiple active views can create conflicting or confusing session state.",
    escalation: "A single active tab still shows conflicting session or timer information.",
    requestTitle: "Practice shows conflicting session information",
    keywords: "browser device simultaneous timer conflict",
  },
];

export function findSupportFaqs({ query = "", topic = "popular" } = {}) {
  const normalizedQuery = String(query).trim().toLowerCase();

  return SUPPORT_FAQS.filter((item) => {
    const matchesTopic = topic === "popular" ? item.popular : item.category === topic;
    if (normalizedQuery) {
      const searchable = `${item.question} ${item.answer} ${item.escalation} ${item.keywords}`.toLowerCase();
      return searchable.includes(normalizedQuery);
    }
    return matchesTopic;
  });
}

const DEFAULT_ADMIN_GUIDANCE = {
  safety: "Preserve the user's current state and confirm whether retrying is safe before suggesting it.",
  checks: [
    "Decide whether this affects one account or several unrelated users.",
    "Confirm the page, action, exact message, and approximate time.",
    "Verify recovery before marking the request resolved.",
  ],
  escalate: "Escalate repeated or multi-user failures with the request reference and minimum reproduction details.",
};

export const ADMIN_SUPPORT_GUIDANCE = {
  account: {
    safety: "Never request a password, OTP, reset link, or authentication token. Do not tell a user with payment history to create another account.",
    checks: [
      "Confirm the candidate is referring to the signed-in account shown in this request.",
      "Separate a forgotten-password problem from an identity or profile correction.",
      "For repeated sign-outs, record the device, browser, time, and whether another account is affected.",
    ],
    escalate: "Identity changes, repeated reset failures, missing profiles, and role problems require privileged operations or engineering review.",
  },
  access: {
    safety: "Do not grant access informally or ask the candidate to buy again until entitlement and payment state are known.",
    checks: [
      "Check the module lifecycle, published-set count, candidate availability, and sales state.",
      "Determine whether the issue affects this account, all users of one module, or a wider cohort.",
      "If the candidate paid, check Payment attention using the payment reference.",
    ],
    escalate: "Escalate when the authoritative catalogue, entitlement, and candidate UI disagree.",
  },
  payment: {
    safety: "Do not ask the candidate to pay again. Never request card details, PIN, OTP, CVV, or bank credentials.",
    checks: [
      "Locate the exact PromotionSure reference in Payment attention.",
      "Compare provider status, fulfillment status, active entitlement, module, amount, and currency.",
      "If payment succeeded, confirm that the candidate can actually open the paid module.",
    ],
    escalate: "A successful payment without usable access, duplicate success, mismatch, dispute, or refund request requires payment operations review.",
  },
  practice: {
    safety: "Do not advise repeated submission, multiple tabs, or clearing browser data while an attempt may still be recoverable.",
    checks: [
      "Identify objective or oral practice, module, set, question position, and approximate time.",
      "Check whether the attempt can resume, has completed once, or remains in an uncertain state.",
      "Search for reports involving the same module or practice set.",
    ],
    escalate: "Escalate uncertain submissions, stale active sessions, lost saved responses, or any repeatable timer failure.",
  },
  content: {
    safety: "Do not edit a published question directly or remove content that may belong to active or historical attempts.",
    checks: [
      "Identify the module, set number, question position, and the candidate's specific concern.",
      "Check the authoritative source and whether scoring or active attempts are affected.",
      "Use the correction or replacement workflow for published content.",
    ],
    escalate: "Escalate disputed sources, scoring impact, missing allocated content, or multiple reports about the same question.",
  },
  technical: {
    safety: "Use one controlled retry only. Do not turn a render, network, payment, or submission failure into a retry loop.",
    checks: [
      "Record the route, device, browser, exact behavior, and approximate time.",
      "Check whether another controlled account and another network reproduce it.",
      "Search for the same route, module, wording, or time window in other requests.",
    ],
    escalate: "Escalate repeatable blinking, blank pages, timer faults, stale-client errors, or failures across unrelated accounts.",
  },
};

export function getAdminSupportGuidance(category) {
  return ADMIN_SUPPORT_GUIDANCE[category] ?? DEFAULT_ADMIN_GUIDANCE;
}
