const KNOWN_USER_MESSAGES = new Map([
  ["No active exam pack found", "This section is still being prepared."],
  ["No active exam pack is configured", "This section is still being prepared."],
  ["Choose a module before starting practice", "Choose a module to continue."],
  ["Complete your profile setup before starting practice", "Complete your details to start practice."],
  ["Complete your profile setup before submitting practice", "Complete your details to start practice."],
  ["Confirm your free batch start from the dashboard.", "Start your free batch from the dashboard to continue."],
  ["Your free batch is locked to another module. Unlock full access to continue.", "Your free practice is already assigned to another module."],
  ["Unlock full access to continue with another module.", "Unlock this module to practise it."],
  ["Unlock full access to continue to another batch.", "Unlock this module to continue."],
  ["You passed the free batch. Unlock full access to continue.", "You passed the free practice set. Unlock this module to continue."],
  ["You already used your free retry. Unlock full access to continue.", "Your free retry is complete. Unlock this module to continue."],
  ["You can retry your free batch once.", "You can retry your free batch once."],
  ["This batch is not available yet.", "This batch is not available yet."],
  ["Please sign in to continue.", "Please sign in to continue."],
  ["Unlock full access to continue.", "Unlock this module to continue."],
  ["Unlock full access to continue to the next batch.", "Unlock this module to continue."],
  ["Finish your active oral practice before starting another set", "You already have an oral practice in progress. Continue that active practice before starting another set."],
  ["Questions for this module are not available yet.", "Questions for this module are not available yet."],
  ["This batch is no longer available. Start again from the dashboard.", "This batch is no longer available. Start again from the dashboard."],
  ["Your service level is locked. Contact support if it needs correction", "Your service level is locked. Contact support if it needs correction."],
  ["Profile setup cannot be reopened", "Your profile has already been completed."],
  ["Free trial limit reached", "Your free batch access has been used."],
  ["Payment reference is required", "We could not confirm your payment yet. Please try again."],
  ["Payment has not been completed", "We could not confirm your payment yet. Please try again."],
  ["Payment was declined", "This payment was declined. No access was unlocked."],
  ["Payment was not completed", "This payment was not completed. No access was unlocked."],
  ["This payment reference does not belong to your account", "We could not confirm your payment yet. Please try again."],
]);

const NO_ROW_MARKERS = [
  "pgrst116",
  "cannot coerce the result to a single json object",
  "the result contains 0 rows",
];

const SCHEMA_MARKERS = [
  "undefined column",
  "schema cache",
  "could not find the",
];

const NETWORK_MARKERS = [
  "failed to fetch",
  "networkerror",
  "network request failed",
  "load failed",
  "fetch failed",
];

const AUTH_MARKERS = [
  "jwt",
  "session",
  "auth",
  "token",
  "not authenticated",
  "authentication",
];

const ACCESS_MARKERS = [
  "permission denied",
  "row-level security",
  "forbidden",
  "not allowed",
  "access denied",
];

const PAYMENT_MARKERS = [
  "paystack",
  "payment",
  "authorization_url",
];

const QUESTION_CONTENT_MARKERS = [
  "questions for this module are not available",
  "no active exam pack",
  "batch is not available",
  "batch is no longer available",
];

let appErrorReporter = null;

export function configureAppErrorReporter(reporter) {
  appErrorReporter = typeof reporter === "function" ? reporter : null;
}

function normalizeMessage(error) {
  return String(
    error?.message ??
      error?.error_description ??
      error?.details ??
      error?.hint ??
      error ??
      "",
  ).trim();
}

function getStatus(error) {
  const status = Number(error?.status ?? error?.statusCode ?? error?.context?.status ?? 0);
  return Number.isFinite(status) ? status : 0;
}

function includesAny(message, markers) {
  return markers.some((marker) => message.includes(marker));
}

export function isExpectedAbortError(error) {
  const message = normalizeMessage(error).toLowerCase();

  if (!message) return false;

  return includesAny(message, [
    "aborterror",
    "aborted",
    "signal is aborted",
    "request was cancelled",
    "request was canceled",
    "the user aborted a request",
  ]);
}

export function logAppError(context, error) {
  if (error?.__loggedByApp) return;
  if (isExpectedAbortError(error)) return;

  try {
    if (error && typeof error === "object") {
      error.__loggedByApp = true;
    }
    if (import.meta.env.DEV) console.error(`[${context}]`, error);
    if (appErrorReporter) {
      const problem = resolveAppProblem(error);
      void Promise.resolve(appErrorReporter({
        context: String(context).slice(0, 120),
        problemCode: problem.code,
        status: problem.status || null,
      })).catch(() => {});
    }
  } catch {
    // ignore logging failures
  }
}

export function logSanitizedAuthProblem(context, problem) {
  if (!problem?.isSanitizedAuthProblem) return;
  logAppError(context, {
    code: problem.code,
    purpose: problem.purpose,
    route: problem.route,
    provider: problem.provider,
    retryable: problem.retryable,
    correlationId: problem.correlationId,
    appVersion: problem.appVersion,
  });
}

export const PROBLEM_CODES = Object.freeze({
  CANCELLED: "request_cancelled",
  OFFLINE: "connection_offline",
  NETWORK: "connection_failed",
  TIMEOUT: "request_timeout",
  RATE_LIMITED: "rate_limited",
  SESSION: "session_required",
  ACCESS: "access_denied",
  ACTIVE_ORAL: "active_oral_conflict",
  PAYMENT_DECLINED: "payment_declined",
  PAYMENT_ACCESS_ISSUE: "payment_access_issue",
  PAYMENT_UNCONFIRMED: "payment_unconfirmed",
  CONTENT_UNAVAILABLE: "content_unavailable",
  CLIENT_VERSION: "client_version_mismatch",
  SERVICE_CONFIGURATION: "service_configuration_error",
  VALIDATION: "validation_failed",
  SERVER: "server_unavailable",
  UNKNOWN: "unknown_problem",
});

export function resolveAppProblem(error, options = {}) {
  const rawMessage = normalizeMessage(error);
  const message = rawMessage.toLowerCase();
  const status = getStatus(error);
  const fallback = options.fallback ?? "Something went wrong. Please try again.";
  const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;

  const problem = (code, title, userMessage, action, retryable = false, presentation = {}) => ({
    code,
    title,
    message: userMessage,
    action,
    retryable,
    status,
    severity: presentation.severity ?? "error",
    placement: presentation.placement ?? "action",
    announcement: presentation.announcement ?? "assertive",
    preserveInput: presentation.preserveInput ?? true,
  });

  if (isExpectedAbortError(error)) {
    return problem(PROBLEM_CODES.CANCELLED, "Request cancelled", "Nothing was changed.", "none");
  }

  if (isOffline) {
    return problem(
      PROBLEM_CODES.OFFLINE,
      "You are offline",
      "Connection problem. Reconnect, then try again.",
      "reconnect",
      true,
    );
  }

  if (error?.isRequestTimeout || includesAny(message, ["timed out", "took too long", "timeout"])) {
    return problem(
      PROBLEM_CODES.TIMEOUT,
      "This is taking longer than expected",
      "Connection problem. Try again.",
      "retry",
      true,
    );
  }

  if (status === 429 || message.includes("rate limit") || message.includes("too many requests")) {
    return problem(
      PROBLEM_CODES.RATE_LIMITED,
      "Please wait a moment",
      "Too many attempts. Wait a moment, then try again.",
      "wait",
      true,
    );
  }

  if (includesAny(message, NETWORK_MARKERS)) {
    return problem(
      PROBLEM_CODES.NETWORK,
      "We could not connect",
      "Connection problem. Check your internet and try again.",
      "retry",
      true,
    );
  }

  if (
    error?.code === "42P17"
    || message.includes("infinite recursion detected in policy")
    || message.includes("policy recursion")
  ) {
    return problem(
      PROBLEM_CODES.SERVICE_CONFIGURATION,
      "This could not be completed",
      "This could not be completed. Try again later.",
      "retry-later",
      false,
      { placement: "form" },
    );
  }

  if (rawMessage === "Finish your active oral practice before starting another set") {
    return problem(
      PROBLEM_CODES.ACTIVE_ORAL,
      "Oral practice already in progress",
      KNOWN_USER_MESSAGES.get(rawMessage),
      "resume",
    );
  }

  if (rawMessage === "Payment was declined" || message.includes("payment was declined")) {
    return problem(
      PROBLEM_CODES.PAYMENT_DECLINED,
      "Payment declined",
      "This payment was declined. No access was unlocked.",
      "new-payment",
    );
  }

  if (
    error?.code === "PAYMENT_FULFILLMENT_FAILED"
    || message.includes("payment was received, but module access still needs attention")
  ) {
    return problem(
      PROBLEM_CODES.PAYMENT_ACCESS_ISSUE,
      "Payment received — access needs attention",
      "Your payment was received, but the module has not unlocked yet. Check again, or send the payment reference to support.",
      "check-access",
      true,
    );
  }

  if (includesAny(message, PAYMENT_MARKERS)) {
    return problem(
      PROBLEM_CODES.PAYMENT_UNCONFIRMED,
      "Payment not confirmed",
      KNOWN_USER_MESSAGES.get(rawMessage) ?? "Payment not confirmed yet. Check its status before trying again.",
      "check-payment",
      true,
    );
  }

  if (includesAny(message, AUTH_MARKERS)) {
    return problem(
      PROBLEM_CODES.SESSION,
      "Sign in required",
      "Please sign in to continue.",
      "sign-in",
    );
  }

  if (includesAny(message, ACCESS_MARKERS)) {
    return problem(
      PROBLEM_CODES.ACCESS,
      "Access unavailable",
      KNOWN_USER_MESSAGES.get(rawMessage) ?? "You do not have access to this content yet.",
      "view-access",
    );
  }

  if (
    includesAny(message, SCHEMA_MARKERS)
    || ["42703", "42P01", "PGRST204"].includes(String(error?.code ?? "").toUpperCase())
    || /\b(column|relation)\b.+\bdoes not exist\b/.test(message)
  ) {
    return problem(
      PROBLEM_CODES.CLIENT_VERSION,
      "This page needs to be refreshed",
      "Refresh the page to load the latest version.",
      "refresh",
      true,
    );
  }

  if (includesAny(message, NO_ROW_MARKERS) || includesAny(message, QUESTION_CONTENT_MARKERS)) {
    return problem(
      PROBLEM_CODES.CONTENT_UNAVAILABLE,
      "Content unavailable",
      KNOWN_USER_MESSAGES.get(rawMessage) ?? "This content is not available yet.",
      "go-back",
    );
  }

  if (KNOWN_USER_MESSAGES.has(rawMessage) || status === 400 || error?.code === "P0001") {
    return problem(
      PROBLEM_CODES.VALIDATION,
      "Action could not be completed",
      KNOWN_USER_MESSAGES.get(rawMessage) ?? fallback,
      "correct-or-return",
    );
  }

  if (status >= 500) {
    return problem(
      PROBLEM_CODES.SERVER,
      "Service temporarily unavailable",
      "Service temporarily unavailable. Try again.",
      "retry",
      true,
    );
  }

  return problem(PROBLEM_CODES.UNKNOWN, "Something went wrong", fallback, "retry", true);
}

export function friendlyErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  return resolveAppProblem(error, { fallback }).message;
}
