const KNOWN_USER_MESSAGES = new Map([
  ["No active exam pack found", "This section is still being prepared."],
  ["No active exam pack is configured", "This section is still being prepared."],
  ["Choose a module before starting practice", "Choose a module to continue."],
  ["Complete your profile setup before starting practice", "Complete your details to start practice."],
  ["Complete your profile setup before submitting practice", "Complete your details to start practice."],
  ["Your service level is locked. Contact support if it needs correction", "Your service level is locked. Contact support if it needs correction."],
  ["Profile setup cannot be reopened", "Your profile has already been completed."],
  ["Free trial limit reached", "Your free practice limit has been reached."],
  ["Payment reference is required", "We could not confirm your payment yet. Please try again."],
  ["Payment has not been completed", "We could not confirm your payment yet. Please try again."],
  ["This payment reference does not belong to your account", "We could not confirm your payment yet. Please try again."],
]);

const NO_ROW_MARKERS = [
  "pgrst116",
  "cannot coerce the result to a single json object",
  "the result contains 0 rows",
];

const SCHEMA_MARKERS = [
  "column ",
  "does not exist",
  "relation ",
  "schema",
  "foreign key",
  "undefined column",
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
  "reference",
];

const QUESTION_CONTENT_MARKERS = [
  "practice questions",
  "batch",
  "question",
  "subject",
];

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

function includesAny(message, markers) {
  return markers.some((marker) => message.includes(marker));
}

export function logAppError(context, error) {
  if (!import.meta.env.DEV) return;

  try {
    if (error && typeof error === "object") {
      error.__loggedByApp = true;
    }
    console.error(`[${context}]`, error);
  } catch {
    // ignore logging failures
  }
}

export function friendlyErrorMessage(error, fallback = "Something went wrong. Please try again.") {
  const rawMessage = normalizeMessage(error);
  const message = rawMessage.toLowerCase();

  if (!message) {
    return fallback;
  }

  const knownMessage = KNOWN_USER_MESSAGES.get(rawMessage);
  if (knownMessage) {
    return knownMessage;
  }

  if (includesAny(message, NO_ROW_MARKERS)) {
    return "This content is not available yet.";
  }

  if (includesAny(message, SCHEMA_MARKERS)) {
    return "This section is still being prepared.";
  }

  if (includesAny(message, NETWORK_MARKERS)) {
    return "Unable to connect right now. Please check your internet connection and try again.";
  }

  if (includesAny(message, ACCESS_MARKERS)) {
    return "You do not have access to this content yet.";
  }

  if (includesAny(message, PAYMENT_MARKERS)) {
    return "We could not confirm your payment yet. Please try again.";
  }

  if (includesAny(message, AUTH_MARKERS)) {
    return "Please sign in to continue.";
  }

  if (includesAny(message, QUESTION_CONTENT_MARKERS)) {
    return "Practice questions for this level are still being prepared.";
  }

  return fallback;
}
