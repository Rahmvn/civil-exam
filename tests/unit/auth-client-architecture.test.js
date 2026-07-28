import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientPath = new URL("../../src/lib/supabaseClient.js", import.meta.url);
const callbackPath = new URL("../../src/pages/AuthCallback.jsx", import.meta.url);
const coordinatorPath = new URL("../../src/lib/authInitialization.js", import.meta.url);
const authPagePath = new URL("../../src/pages/Auth.jsx", import.meta.url);
const captchaPath = new URL("../../src/components/auth/AuthCaptcha.jsx", import.meta.url);

test("Release A keeps one implicit client and automatic callback ownership", async () => {
  const [client, callback, coordinator] = await Promise.all([
    readFile(clientPath, "utf8"),
    readFile(callbackPath, "utf8"),
    readFile(coordinatorPath, "utf8"),
  ]);

  assert.equal((client.match(/createClient\(/g) ?? []).length, 1);
  assert.match(client, /flowType: "implicit"/);
  assert.match(client, /detectSessionInUrl: true/);
  assert.match(client, /createAuthInitializationCoordinator\(supabase\.auth/);
  assert.match(coordinator, /auth\.getSession\(\)/);
  assert.doesNotMatch(coordinator, /\.initialize\(/);
  assert.doesNotMatch(callback, /createClient|exchangeCodeForSession/);
  assert.match(callback, /cleanAuthCallbackUrl/);
});

test("Turnstile protects each Supabase password action without blocking OTP verification", async () => {
  const [authPage, captcha] = await Promise.all([
    readFile(authPagePath, "utf8"),
    readFile(captchaPath, "utf8"),
  ]);

  assert.match(authPage, /mode === "sign-in" \|\| isSignUpPasswordStep \|\| isForgotPassword/);
  assert.match(authPage, /credentials\.options = \{ captchaToken \}/);
  assert.match(authPage, /signInWithPassword\(credentials\)/);
  assert.match(authPage, /disabled=\{isBusy \|\| !isCompleteOtp\(otp\)\}/);
  assert.match(authPage, /captchaBlocksResend/);
  assert.match(captcha, /appearance: "interaction-only"/);
  assert.match(captcha, /size: "flexible"/);
  assert.match(captcha, /"error-callback": \(errorCode\)/);
});
