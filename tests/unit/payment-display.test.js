import assert from "node:assert/strict";
import test from "node:test";
import { getPaymentStatusMeta, partitionPaymentRecords } from "../../src/lib/paymentDisplay.js";

test("successful fulfilled payments are presented as successful", () => {
  assert.deepEqual(getPaymentStatusMeta({
    provider_status: "success",
    fulfillment_status: "fulfilled",
    status: "active",
  }), {
    label: "Successful",
    tone: "successful",
    description: "Payment completed.",
    canCheck: false,
    canViewReceipt: true,
  });
});

test("successful unfulfilled payments are presented as access issues", () => {
  const meta = getPaymentStatusMeta({
    provider_status: "success",
    fulfillment_status: "failed",
    paystack_reference: "PS-paid",
  });

  assert.equal(meta.label, "Access issue");
  assert.equal(meta.canCheck, true);
  assert.equal(meta.canViewReceipt, false);
});

test("provider processing is not described as awaiting customer payment", () => {
  const meta = getPaymentStatusMeta({
    provider_status: "processing",
    paystack_reference: "PS-processing",
  });

  assert.equal(meta.label, "Processing");
  assert.equal(meta.description, "Paystack is still processing this payment.");
});

test("post-payment reviews explain refunds and disputes without offering stale receipts", () => {
  const cases = [
    ["refunded", "Refunded"],
    ["partially_refunded", "Partially refunded"],
    ["refund_pending", "Refund pending"],
    ["disputed", "Under dispute"],
  ];

  cases.forEach(([reviewStatus, label]) => {
    const meta = getPaymentStatusMeta({
      review_status: reviewStatus,
      provider_status: "success",
      fulfillment_status: "fulfilled",
      status: "active",
    });
    assert.equal(meta.label, label);
    assert.equal(meta.canViewReceipt, false);
  });

  assert.equal(getPaymentStatusMeta({
    review_status: "dispute_resolved",
    provider_status: "success",
    fulfillment_status: "revoked",
    status: "expired",
  }).label, "Dispute resolved");
});

test("payment records are separated by the database record type", () => {
  const result = partitionPaymentRecords([
    { id: "paid", record_type: "history" },
    { id: "processing", record_type: "attention" },
  ]);

  assert.deepEqual(result.history.map((payment) => payment.id), ["paid"]);
  assert.deepEqual(result.attention.map((payment) => payment.id), ["processing"]);
});
