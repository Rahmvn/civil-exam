import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTH_PROBLEM_CODES,
  AUTH_PURPOSES,
  cleanAuthCallbackUrl,
  classifySignUpOutcome,
  classifyAuthError,
  createPendingAuthState,
  createSanitizedAuthProblem,
  getResendSeconds,
  getSafeCallbackCategory,
  getSafeCallbackErrorCode,
  isCompleteOtp,
  maskEmail,
  markRecoveryAuthorized,
  normalizeOtp,
  parsePendingAuthState,
  readRecoveryAuthorization,
  reduceCallbackState,
  reduceRecoveryState,
} from "../../src/lib/authFlow.js";
import { createAuthInitializationCoordinator } from "../../src/lib/authInitialization.js";

test("OTP utilities keep one six-digit semantic value", () => {
  assert.equal(normalizeOtp(" 12a-34 567 "), "123456");
  assert.equal(isCompleteOtp("123456"), true);
  assert.equal(isCompleteOtp("12345"), false);
});

test("pending Auth state is purpose-bound, expiring, and password-free", () => {
  const pending = createPendingAuthState({
    purpose: AUTH_PURPOSES.SIGNUP,
    email: " Candidate@Example.com ",
    returnTo: "/modules/psr?set=2",
    now: 1_000,
  });
  const serialized = JSON.stringify(pending);

  assert.equal(pending.email, "candidate@example.com");
  assert.equal(pending.returnTo, "/modules/psr?set=2");
  assert.equal(serialized.includes("password"), false);
  assert.equal(parsePendingAuthState(serialized, { purpose: AUTH_PURPOSES.RECOVERY, now: 2_000 }), null);
  assert.equal(parsePendingAuthState(serialized, { purpose: AUTH_PURPOSES.SIGNUP, now: 2_000 })?.email, "candidate@example.com");
  assert.equal(parsePendingAuthState(serialized, { purpose: AUTH_PURPOSES.SIGNUP, now: pending.expiresAt }), null);
  assert.equal(getResendSeconds(pending.cooldownUntil, 1_000), 60);
});

test("signup results preserve both transitional outcomes", () => {
  const user = { id: "candidate-id", email: "candidate@example.com" };
  assert.equal(classifySignUpOutcome({ user, session: { user } }), "immediate_session");
  assert.equal(classifySignUpOutcome({ user, session: null }), "verification_pending");
  assert.equal(classifySignUpOutcome({ user: null, session: null }), "invalid_response");
});

test("email masking keeps delivery guidance useful", () => {
  assert.equal(maskEmail("candidate@example.com"), "ca******@example.com");
  assert.equal(maskEmail("x@example.com"), "x**@example.com");
});

test("recovery browser marker is purpose-bound UX state and expires", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const user = { id: "candidate-id", email: "candidate@example.com" };
  assert.equal(markRecoveryAuthorized(storage, user, 1_000), true);
  assert.equal(readRecoveryAuthorization(storage, user, 2_000)?.userId, user.id);
  assert.equal(readRecoveryAuthorization(storage, { ...user, email: "other@example.com" }, 2_000), null);
  assert.equal(readRecoveryAuthorization(storage, user, 1_000 + 30 * 60 * 1000), null);
});

test("Auth errors are classified before generic application errors", () => {
  assert.equal(classifyAuthError({ code: "otp_expired" }), AUTH_PROBLEM_CODES.EXPIRED_OTP);
  assert.equal(classifyAuthError({ code: "flow_state_not_found" }), AUTH_PROBLEM_CODES.AUTH_REQUEST_NO_LONGER_VALID);
  assert.equal(classifyAuthError({ details: { code: "access_denied" } }), AUTH_PROBLEM_CODES.OAUTH_CANCELLED);
  assert.equal(classifyAuthError({ code: "over_email_send_rate_limit", status: 429 }), AUTH_PROBLEM_CODES.RATE_LIMITED);
  const problem = createSanitizedAuthProblem({ code: "otp_expired", message: "raw token detail" }, { purpose: "signup", route: "/auth" });
  assert.equal(problem.code, AUTH_PROBLEM_CODES.EXPIRED_OTP);
  assert.equal(JSON.stringify(problem).includes("raw token detail"), false);
});

test("callback categories and cleanup never preserve callback values", () => {
  assert.equal(getSafeCallbackCategory("https://app.test/auth/callback#access_token=secret&refresh_token=other"), "implicit");
  assert.equal(getSafeCallbackCategory("https://app.test/auth/callback?code=secret"), "pkce");
  assert.equal(getSafeCallbackErrorCode("https://app.test/auth/callback#error=access_denied&error_description=private"), "access_denied");
  assert.equal(getSafeCallbackErrorCode("https://app.test/auth/callback?error=unrecognized&error_description=private"), null);
  const calls = [];
  const history = { state: { safe: true }, replaceState: (...args) => calls.push(args) };
  assert.equal(cleanAuthCallbackUrl(history, "https://app.test/auth/callback?error_description=private#access_token=secret"), "/auth/callback");
  assert.deepEqual(calls, [[history.state, "", "/auth/callback"]]);
});

test("callback and recovery reducers reject invalid transitions", () => {
  assert.equal(reduceCallbackState("idle", "START"), "initializing");
  assert.equal(reduceCallbackState("initializing", "SESSION"), "recovering_profile");
  assert.equal(reduceCallbackState("recovering_profile", "PROFILE_READY"), "complete");
  assert.equal(reduceRecoveryState("request", "REQUESTED"), "verify");
  assert.equal(reduceRecoveryState("verify", "VERIFIED"), "new_password");
});

test("initialization coordinator is observed once and sanitizes failures", async () => {
  let sessionCalls = 0;
  const auth = {
    getSession() {
      sessionCalls += 1;
      return Promise.resolve({ data: { session: null }, error: { code: "flow_state_expired", message: "raw callback code" } });
    },
  };

  const coordinator = createAuthInitializationCoordinator(auth, {
    locationHref: "https://app.test/auth/callback?code=private-value",
  });
  const [first, second] = await Promise.all([coordinator, coordinator]);

  assert.equal(sessionCalls, 1);
  assert.equal(first, second);
  assert.equal(first.status, "initialization_failed");
  assert.equal(first.problem.code, AUTH_PROBLEM_CODES.AUTH_REQUEST_NO_LONGER_VALID);
  assert.equal(JSON.stringify(first).includes("raw callback code"), false);
});
