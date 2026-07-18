import { getSafeReturnTo } from "./navigation.js";

export const AUTH_PENDING_VERSION = 1;
export const AUTH_PENDING_TTL_MS = 60 * 60 * 1000;
export const AUTH_RESEND_COOLDOWN_MS = 60 * 1000;
export const RECOVERY_UX_MARKER_TTL_MS = 30 * 60 * 1000;

export const AUTH_PURPOSES = Object.freeze({
  SIGNUP: "signup",
  RECOVERY: "recovery",
});

export const AUTH_STORAGE_KEYS = Object.freeze({
  signup: "promotionsure.auth.pending.signup",
  recovery: "promotionsure.auth.pending.recovery",
  recoveryAuthorized: "promotionsure.auth.recovery.authorized",
});

export const AUTH_PROBLEM_CODES = Object.freeze({
  INVALID_OTP: "invalid_otp",
  INVALID_CREDENTIALS: "invalid_credentials",
  WEAK_PASSWORD: "weak_password",
  EXPIRED_OTP: "expired_otp",
  OTP_NO_LONGER_VALID: "otp_no_longer_valid",
  RATE_LIMITED: "rate_limited",
  RECOVERY_SESSION_MISSING: "recovery_session_missing",
  RECOVERY_SESSION_EXPIRED: "recovery_session_expired",
  OAUTH_CANCELLED: "oauth_cancelled",
  AUTH_REQUEST_NO_LONGER_VALID: "auth_request_no_longer_valid",
  CALLBACK_SESSION_MISSING: "callback_session_missing",
  PROFILE_RECOVERY_FAILED: "profile_recovery_failed",
  AUTHORITY_LOAD_FAILED: "authority_load_failed",
  OFFLINE: "offline",
  NETWORK_FAILURE: "network_failure",
  SERVICE_UNAVAILABLE: "service_unavailable",
  SIGNUP_FAILED: "signup_failed",
  UNKNOWN: "auth_unknown",
});

const AUTH_MESSAGES = Object.freeze({
  [AUTH_PROBLEM_CODES.INVALID_OTP]: "That code is not correct. Check the latest email and try again.",
  [AUTH_PROBLEM_CODES.INVALID_CREDENTIALS]: "Email or password is incorrect.",
  [AUTH_PROBLEM_CODES.WEAK_PASSWORD]: "Use a stronger password with at least eight characters.",
  [AUTH_PROBLEM_CODES.EXPIRED_OTP]: "That code has expired. Request a new code and try again.",
  [AUTH_PROBLEM_CODES.OTP_NO_LONGER_VALID]: "That code is no longer valid. Request a new code and try again.",
  [AUTH_PROBLEM_CODES.RATE_LIMITED]: "Please wait a moment before trying again.",
  [AUTH_PROBLEM_CODES.RECOVERY_SESSION_MISSING]: "Your password reset session is no longer available. Start again.",
  [AUTH_PROBLEM_CODES.RECOVERY_SESSION_EXPIRED]: "Your password reset session has expired. Start again.",
  [AUTH_PROBLEM_CODES.OAUTH_CANCELLED]: "Google sign-in was cancelled. You can try again or continue with email.",
  [AUTH_PROBLEM_CODES.AUTH_REQUEST_NO_LONGER_VALID]: "This sign-in request is no longer valid. Please start again.",
  [AUTH_PROBLEM_CODES.CALLBACK_SESSION_MISSING]: "We could not complete this sign-in request. Please start again.",
  [AUTH_PROBLEM_CODES.PROFILE_RECOVERY_FAILED]: "Your account was verified, but we could not load your profile. Please try again.",
  [AUTH_PROBLEM_CODES.AUTHORITY_LOAD_FAILED]: "We could not load your account access. Please try again.",
  [AUTH_PROBLEM_CODES.OFFLINE]: "Reconnect to the internet, then try again.",
  [AUTH_PROBLEM_CODES.NETWORK_FAILURE]: "We could not connect. Check your internet connection and try again.",
  [AUTH_PROBLEM_CODES.SERVICE_UNAVAILABLE]: "Authentication is temporarily unavailable. Please try again.",
  [AUTH_PROBLEM_CODES.SIGNUP_FAILED]: "We could not create your account. Check the details and try again.",
  [AUTH_PROBLEM_CODES.UNKNOWN]: "We could not complete that request. Please try again.",
});

export function normalizeOtp(value) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 6);
}

export function isCompleteOtp(value) {
  return /^\d{6}$/.test(String(value ?? ""));
}

export function classifySignUpOutcome(data) {
  if (data?.session?.user) return "immediate_session";
  if (data?.user) return "verification_pending";
  return "invalid_response";
}

export function normalizeAuthEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function maskEmail(value) {
  const email = normalizeAuthEmail(value);
  const at = email.lastIndexOf("@");
  if (at <= 0) return "your email address";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`;
}

export function createPendingAuthState({
  purpose,
  email,
  returnTo = "/dashboard",
  now = Date.now(),
  cooldownMs = AUTH_RESEND_COOLDOWN_MS,
  ttlMs = AUTH_PENDING_TTL_MS,
}) {
  if (!Object.values(AUTH_PURPOSES).includes(purpose)) throw new Error("Invalid Auth purpose");
  const normalizedEmail = normalizeAuthEmail(email);
  if (!normalizedEmail || !normalizedEmail.includes("@")) throw new Error("Invalid pending email");

  return {
    version: AUTH_PENDING_VERSION,
    purpose,
    email: normalizedEmail,
    returnTo: getSafeReturnTo(returnTo),
    requestedAt: now,
    cooldownUntil: now + cooldownMs,
    expiresAt: now + ttlMs,
  };
}

export function parsePendingAuthState(raw, { purpose, now = Date.now() } = {}) {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!value || value.version !== AUTH_PENDING_VERSION) return null;
  if (!Object.values(AUTH_PURPOSES).includes(value.purpose)) return null;
  if (purpose && value.purpose !== purpose) return null;
  if (normalizeAuthEmail(value.email) !== value.email) return null;
  if (!Number.isFinite(value.requestedAt) || !Number.isFinite(value.cooldownUntil) || !Number.isFinite(value.expiresAt)) return null;
  if (value.expiresAt <= now || value.requestedAt > now + 60_000) return null;

  return {
    version: AUTH_PENDING_VERSION,
    purpose: value.purpose,
    email: value.email,
    returnTo: getSafeReturnTo(value.returnTo),
    requestedAt: value.requestedAt,
    cooldownUntil: value.cooldownUntil,
    expiresAt: value.expiresAt,
  };
}

export function serializePendingAuthState(value) {
  return JSON.stringify(value);
}

export function getResendSeconds(cooldownUntil, now = Date.now()) {
  return Math.max(0, Math.ceil((Number(cooldownUntil) - now) / 1000));
}

export function readPendingAuthState(storage, purpose, now = Date.now()) {
  const key = AUTH_STORAGE_KEYS[purpose];
  if (!storage || !key) return null;
  const pending = parsePendingAuthState(storage.getItem(key), { purpose, now });
  if (!pending) storage.removeItem(key);
  return pending;
}

export function writePendingAuthState(storage, pending) {
  const key = AUTH_STORAGE_KEYS[pending?.purpose];
  if (!storage || !key) throw new Error("Invalid pending Auth state");
  storage.setItem(key, serializePendingAuthState(pending));
}

export function clearPendingAuthState(storage, purpose) {
  const key = AUTH_STORAGE_KEYS[purpose];
  if (storage && key) storage.removeItem(key);
}

export function markRecoveryAuthorized(storage, user, now = Date.now()) {
  const email = normalizeAuthEmail(user?.email);
  if (!storage || !user?.id || !email) return false;
  storage.setItem(AUTH_STORAGE_KEYS.recoveryAuthorized, JSON.stringify({
    version: AUTH_PENDING_VERSION,
    userId: user.id,
    email,
    verifiedAt: now,
  }));
  return true;
}

export function readRecoveryAuthorization(storage, user, now = Date.now()) {
  if (!storage || !user?.id) return null;
  try {
    const value = JSON.parse(storage.getItem(AUTH_STORAGE_KEYS.recoveryAuthorized));
    if (value?.version !== AUTH_PENDING_VERSION || value.userId !== user.id) return null;
    if (normalizeAuthEmail(value.email) !== normalizeAuthEmail(user.email)) return null;
    if (!Number.isFinite(value.verifiedAt) || value.verifiedAt + RECOVERY_UX_MARKER_TTL_MS <= now) return null;
    return value;
  } catch {
    return null;
  }
}

export function clearRecoveryAuthorization(storage) {
  storage?.removeItem(AUTH_STORAGE_KEYS.recoveryAuthorized);
}

export function classifyAuthError(error) {
  const code = String(error?.code ?? error?.details?.code ?? "").toLowerCase();
  const name = String(error?.name ?? "").toLowerCase();
  const status = Number(error?.status ?? 0);

  if (typeof navigator !== "undefined" && navigator.onLine === false) return AUTH_PROBLEM_CODES.OFFLINE;
  if (status === 429 || code === "over_email_send_rate_limit" || code === "over_request_rate_limit") return AUTH_PROBLEM_CODES.RATE_LIMITED;
  if (code === "otp_expired") return AUTH_PROBLEM_CODES.EXPIRED_OTP;
  if (code === "token_not_found" || code === "otp_disabled") return AUTH_PROBLEM_CODES.OTP_NO_LONGER_VALID;
  if (code === "flow_state_expired" || code === "flow_state_not_found" || code === "bad_code_verifier") return AUTH_PROBLEM_CODES.AUTH_REQUEST_NO_LONGER_VALID;
  if (code === "session_expired") return AUTH_PROBLEM_CODES.RECOVERY_SESSION_EXPIRED;
  if (code === "session_not_found" || code === "no_authorization") return AUTH_PROBLEM_CODES.RECOVERY_SESSION_MISSING;
  if (code === "access_denied" || code === "oauth_access_denied" || name.includes("cancel")) return AUTH_PROBLEM_CODES.OAUTH_CANCELLED;
  if (code === "invalid_credentials") return AUTH_PROBLEM_CODES.INVALID_CREDENTIALS;
  if (code === "weak_password") return AUTH_PROBLEM_CODES.WEAK_PASSWORD;
  if (code === "validation_failed") return AUTH_PROBLEM_CODES.INVALID_OTP;
  if (status >= 500 || code === "unexpected_failure") return AUTH_PROBLEM_CODES.SERVICE_UNAVAILABLE;
  if (name.includes("fetch") || name.includes("network") || code === "request_timeout") return AUTH_PROBLEM_CODES.NETWORK_FAILURE;
  return AUTH_PROBLEM_CODES.UNKNOWN;
}

export function createSanitizedAuthProblem(errorOrCode, {
  purpose = "auth",
  route = "unknown",
  provider = "supabase",
  correlationId,
  appVersion = "unknown",
} = {}) {
  const code = typeof errorOrCode === "string" && AUTH_MESSAGES[errorOrCode]
    ? errorOrCode
    : classifyAuthError(errorOrCode);
  const safeCorrelationId = correlationId || globalThis.crypto?.randomUUID?.() || `auth-${Date.now().toString(36)}`;
  return Object.freeze({
    isSanitizedAuthProblem: true,
    code,
    message: AUTH_MESSAGES[code] ?? AUTH_MESSAGES[AUTH_PROBLEM_CODES.UNKNOWN],
    purpose,
    route,
    provider,
    retryable: ![
      AUTH_PROBLEM_CODES.OAUTH_CANCELLED,
      AUTH_PROBLEM_CODES.RECOVERY_SESSION_MISSING,
    ].includes(code),
    correlationId: safeCorrelationId,
    appVersion,
  });
}

export function getSafeCallbackCategory(urlValue) {
  try {
    const url = new URL(urlValue, "http://app.local");
    if (url.searchParams.has("code")) return "pkce";
    if (url.searchParams.has("error") || url.hash.includes("error=")) return "provider_error";
    if (url.hash.includes("access_token=")) return "implicit";
    if (url.searchParams.get("mode") === "recovery") return "recovery";
    return "none";
  } catch {
    return "none";
  }
}

export function getSafeCallbackErrorCode(urlValue) {
  try {
    const url = new URL(urlValue, "http://app.local");
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const code = url.searchParams.get("error_code")
      || url.searchParams.get("error")
      || hash.get("error_code")
      || hash.get("error");
    return [
      "access_denied",
      "oauth_access_denied",
      "flow_state_expired",
      "flow_state_not_found",
      "bad_code_verifier",
    ].includes(code) ? code : null;
  } catch {
    return null;
  }
}

export function getCleanAuthCallbackPath(urlValue) {
  try {
    const url = new URL(urlValue, "http://app.local");
    return url.pathname === "/auth/callback" ? "/auth/callback" : "/auth/callback";
  } catch {
    return "/auth/callback";
  }
}

export function cleanAuthCallbackUrl(historyObject, urlValue) {
  const path = getCleanAuthCallbackPath(urlValue);
  historyObject?.replaceState?.(historyObject.state, "", path);
  return path;
}

export function reduceCallbackState(state, event) {
  if (state === "idle" && event === "START") return "initializing";
  if (state === "initializing" && event === "SESSION") return "recovering_profile";
  if (state === "initializing" && event === "FAIL") return "failed";
  if (state === "recovering_profile" && event === "PROFILE_READY") return "complete";
  if (state === "recovering_profile" && event === "FAIL") return "failed";
  return state;
}

export function reduceRecoveryState(state, event) {
  if (state === "request" && event === "REQUESTED") return "verify";
  if (state === "verify" && event === "VERIFIED") return "new_password";
  if (event === "EXPIRED" || event === "CANCEL") return "request";
  if (state === "new_password" && event === "UPDATED") return "complete";
  return state;
}
