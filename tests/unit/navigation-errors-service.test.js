import assert from "node:assert/strict";
import test from "node:test";
import { friendlyErrorMessage, isExpectedAbortError } from "../../src/lib/errors.js";
import { buildLocationPath, getSafeReturnTo, withReturnTo } from "../../src/lib/navigation.js";
import { formatServiceLevelLabel } from "../../src/lib/serviceLevel.js";

test("return navigation preserves safe local paths and rejects redirects", () => {
  assert.equal(buildLocationPath({ pathname: "/modules/psr", search: "?batch=2", hash: "#sets" }), "/modules/psr?batch=2#sets");
  assert.equal(buildLocationPath(null), "/dashboard");
  assert.equal(getSafeReturnTo("/review?attempt=1#answer"), "/review?attempt=1#answer");
  assert.equal(getSafeReturnTo("//evil.example/path"), "/dashboard");
  assert.equal(getSafeReturnTo("https://evil.example/path"), "/dashboard");
  assert.equal(getSafeReturnTo("/auth?returnTo=/admin"), "/dashboard");
  assert.equal(getSafeReturnTo("/profile-setup"), "/dashboard");
  assert.equal(withReturnTo("/auth?mode=sign-in", "/modules/psr?batch=2"), "/auth?mode=sign-in&returnTo=%2Fmodules%2Fpsr%3Fbatch%3D2");
});

test("friendly errors redact infrastructure details into actionable messages", () => {
  assert.equal(
    friendlyErrorMessage(new Error("TypeError: Failed to fetch")),
    "Unable to connect right now. Please check your internet connection and try again.",
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
    "This section is still being prepared.",
  );
  assert.equal(
    friendlyErrorMessage(new Error("Payment reference is required")),
    "We could not confirm your payment yet. Please try again.",
  );
  assert.equal(friendlyErrorMessage(new Error("unexpected internal detail"), "Safe fallback"), "Safe fallback");
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
