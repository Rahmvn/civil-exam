import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizePaymentPayload,
  sanitizePaystackPostPaymentEvent,
} from "../../supabase/functions/_shared/payment-sanitization.js";

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

test("refund and dispute events retain reconciliation fields without customer data", () => {
  assert.deepEqual(sanitizePaystackPostPaymentEvent({
    event: "refund.processed",
    data: {
      status: "processed",
      transaction_reference: "PS-1",
      refund_reference: "RF-1",
      amount: "10000",
      currency: "NGN",
      domain: "live",
      customer: { email: "candidate@example.test" },
      merchant_note: "private note",
    },
  }), {
    event: "refund.processed",
    data: {
      status: "processed",
      transaction_reference: "PS-1",
      refund_reference: "RF-1",
      amount: "10000",
      currency: "NGN",
      domain: "live",
    },
  });

  assert.deepEqual(sanitizePaystackPostPaymentEvent({
    event: "charge.dispute.create",
    data: {
      id: 42,
      status: "pending",
      resolution: null,
      reason: "not recognized",
      domain: "test",
      customer: { email: "candidate@example.test" },
      transaction: {
        id: 9,
        domain: "test",
        status: "success",
        reference: "PS-1",
        amount: 250000,
        currency: "NGN",
        authorization: { last4: "4081" },
      },
    },
  }), {
    event: "charge.dispute.create",
    data: {
      id: 42,
      status: "pending",
      reason: "not recognized",
      domain: "test",
      transaction: {
        id: 9,
        domain: "test",
        status: "success",
        reference: "PS-1",
        amount: 250000,
        currency: "NGN",
      },
    },
  });

  assert.deepEqual(sanitizePaystackPostPaymentEvent({ event: "charge.success", data: {} }), {});
});
