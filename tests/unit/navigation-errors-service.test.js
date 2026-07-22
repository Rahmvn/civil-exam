import assert from "node:assert/strict";
import test from "node:test";
import { friendlyErrorMessage, isExpectedAbortError, PROBLEM_CODES, resolveAppProblem } from "../../src/lib/errors.js";
import { buildLocationPath, getSafeReturnTo, withReturnTo } from "../../src/lib/navigation.js";
import { formatServiceLevelLabel } from "../../src/lib/serviceLevel.js";

test("return navigation preserves safe local paths and rejects redirects", () => {
  assert.equal(buildLocationPath({ pathname: "/modules/psr", search: "?batch=2", hash: "#sets" }), "/modules/psr?batch=2#sets");
  assert.equal(buildLocationPath(null), "/dashboard");
  assert.equal(getSafeReturnTo("/review?attempt=1#answer"), "/review?attempt=1#answer");
  assert.equal(getSafeReturnTo("//evil.example/path"), "/dashboard");
  assert.equal(getSafeReturnTo("https://evil.example/path"), "/dashboard");
  assert.equal(getSafeReturnTo("%2F%2Fevil.example/path"), "/dashboard");
  assert.equal(getSafeReturnTo("%252F%252Fevil.example/path"), "/dashboard");
  assert.equal(getSafeReturnTo("/\\evil.example/path"), "/dashboard");
  assert.equal(getSafeReturnTo("/%5Cevil.example/path"), "/dashboard");
  assert.equal(getSafeReturnTo("javascript:alert(1)"), "/dashboard");
  assert.equal(getSafeReturnTo("data:text/html,unsafe"), "/dashboard");
  assert.equal(getSafeReturnTo("/dashboard?returnTo=https%3A%2F%2Fevil.example"), "/dashboard");
  assert.equal(getSafeReturnTo("/dashboard?tab=progress&filter=active"), "/dashboard?tab=progress&filter=active");
  assert.equal(getSafeReturnTo("/auth?returnTo=/admin"), "/dashboard");
  assert.equal(getSafeReturnTo("/profile-setup"), "/dashboard");
  assert.equal(withReturnTo("/auth?mode=sign-in", "/modules/psr?batch=2"), "/auth?mode=sign-in&returnTo=%2Fmodules%2Fpsr%3Fbatch%3D2");
});

test("friendly errors redact infrastructure details into actionable messages", () => {
  assert.equal(
    friendlyErrorMessage(new Error("TypeError: Failed to fetch")),
    "Check your internet connection, then try again.",
  );
  assert.equal(
    friendlyErrorMessage(new Error("permission denied by row-level security")),
    "You do not have access to this content yet.",
  );
  assert.equal(
    friendlyErrorMessage(new Error("JWT expired")),
    "Please sign in to continue.",
  );
  assert.equal(
    friendlyErrorMessage(new Error("column practice_type does not exist")),
    "Refresh the page to load the latest version. If it continues, return to the dashboard.",
  );
  assert.equal(
    friendlyErrorMessage(new Error("Payment reference is required")),
    "We could not confirm your payment yet. Please try again.",
  );
  assert.equal(friendlyErrorMessage(new Error("unexpected internal detail"), "Safe fallback"), "Safe fallback");
});

test("problem classification gives recovery behavior independently from display copy", () => {
  const timeout = resolveAppProblem(Object.assign(new Error("request timed out"), { status: 504 }));
  assert.equal(timeout.code, PROBLEM_CODES.TIMEOUT);
  assert.equal(timeout.retryable, true);
  assert.equal(timeout.action, "retry");

  const activeOral = resolveAppProblem(new Error("Finish your active oral practice before starting another set"));
  assert.equal(activeOral.code, PROBLEM_CODES.ACTIVE_ORAL);
  assert.equal(activeOral.action, "resume");

  const declined = resolveAppProblem(new Error("Payment was declined"));
  assert.equal(declined.code, PROBLEM_CODES.PAYMENT_DECLINED);
  assert.equal(declined.retryable, false);

  const accessIssue = resolveAppProblem(Object.assign(
    new Error("Payment was received, but module access still needs attention. Please check again."),
    { code: "PAYMENT_FULFILLMENT_FAILED", status: 409 },
  ));
  assert.equal(accessIssue.code, PROBLEM_CODES.PAYMENT_ACCESS_ISSUE);
  assert.equal(accessIssue.title, "Payment received — access needs attention");
  assert.equal(accessIssue.action, "check-access");
  assert.equal(accessIssue.status, 409);
});

test("abort detection accepts browser cancellation variants only", () => {
  assert.equal(isExpectedAbortError(new DOMException("The operation was aborted", "AbortError")), true);
  assert.equal(isExpectedAbortError(new Error("Request was cancelled")), true);
  assert.equal(isExpectedAbortError(new Error("Network request failed")), false);
});

test("service levels normalize common admin and candidate inputs", () => {
  assert.equal(formatServiceLevelLabel(" gl 007 "), "GL 7");
  assert.equal(formatServiceLevelLabel("12"), "GL 12");
  assert.equal(formatServiceLevelLabel("Permanent   Secretary"), "Permanent Secretary");
  assert.equal(formatServiceLevelLabel(null), "");
});
