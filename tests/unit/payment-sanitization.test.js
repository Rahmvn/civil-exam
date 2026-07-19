import test from "node:test";
import assert from "node:assert/strict";
import { sanitizePaymentPayload } from "../../supabase/functions/_shared/payment-sanitization.js";

test("payment payload sanitization retains reconciliation fields and removes instrument data", () => {
  const payload = {
    status: true,
    message: "Verification successful",
    data: {
      id: 42,
      status: "success",
      reference: "PS-test",
      amount: 500000,
      currency: "NGN",
      channel: "card",
      metadata: { user_id: "user-1", subject_id: "subject-1" },
      authorization: {
        last4: "4081",
        exp_month: "01",
        exp_year: "30",
        bin: "408408",
        authorization_code: "AUTH_secret",
      },
      customer: { email: "candidate@example.test", customer_code: "CUS_secret" },
      card: { number: "4084084084084081", cvv: "408" },
    },
  };

  assert.deepEqual(sanitizePaymentPayload(payload), {
    status: true,
    message: "Verification successful",
    data: {
      id: 42,
      status: "success",
      reference: "PS-test",
      amount: 500000,
      channel: "card",
      currency: "NGN",
      metadata: { user_id: "user-1", subject_id: "subject-1" },
    },
  });
});

test("payment initialization data remains recoverable without unrelated fields", () => {
  const payload = {
    status: true,
    message: "Authorization URL created",
    data: {
      authorization_url: "https://checkout.example.test/abc",
      access_code: "access-code",
      reference: "PS-test",
      unexpected: "discarded",
    },
  };

  assert.deepEqual(sanitizePaymentPayload(payload), {
    status: true,
    message: "Authorization URL created",
    data: {
      reference: "PS-test",
      authorization_url: "https://checkout.example.test/abc",
      access_code: "access-code",
    },
  });
});
