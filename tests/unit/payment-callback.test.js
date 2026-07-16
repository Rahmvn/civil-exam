import assert from "node:assert/strict";
import test from "node:test";
import { getPaymentCallbackUrl } from "../../supabase/functions/_shared/payment-callback.js";

test("payment callback uses the configured HTTPS application URL", () => {
  assert.equal(
    getPaymentCallbackUrl("https://app.example.test"),
    "https://app.example.test/payment/verify",
  );
});

test("payment callback preserves a configured application base path", () => {
  assert.equal(
    getPaymentCallbackUrl("https://example.test/candidate/"),
    "https://example.test/candidate/payment/verify",
  );
});

test("payment callback permits explicit loopback HTTP development URLs", () => {
  assert.equal(
    getPaymentCallbackUrl("http://127.0.0.1:4173"),
    "http://127.0.0.1:4173/payment/verify",
  );
});

test("payment callback rejects missing or malformed APP_URL values", () => {
  assert.throws(() => getPaymentCallbackUrl(), /APP_URL is required/);
  assert.throws(() => getPaymentCallbackUrl("not-a-url"), /absolute HTTP or HTTPS URL/);
  assert.throws(() => getPaymentCallbackUrl("ftp://example.test"), /must use HTTP or HTTPS/);
});

test("payment callback rejects non-loopback plaintext and URL decorations", () => {
  assert.throws(() => getPaymentCallbackUrl("http://example.test"), /limited to localhost/);
  assert.throws(() => getPaymentCallbackUrl("https://user:secret@example.test"), /credentials/);
  assert.throws(() => getPaymentCallbackUrl("https://example.test?next=attacker"), /query string or fragment/);
});
