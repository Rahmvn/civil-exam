import assert from "node:assert/strict";
import test from "node:test";
import {
  formatPaymentDuration,
  getPaymentAccessResult,
  getPaymentProductLabel,
  getPaymentStatusMeta,
  getPaymentVerificationCopy,
  partitionPaymentRecords,
} from "../../src/lib/paymentDisplay.js";

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
    ["access_review", "Under review"],
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

test("canonical payment facts drive labels, durations, and mixed bundle expiry copy", () => {
  const payment = {
    product_label: "3-Module Bundle",
    duration_months: 3,
    item_count: 3,
    access_expires_at: "2027-01-01T00:00:00Z",
    access_result_kind: "latest",
  };

  assert.equal(getPaymentProductLabel(payment), "3-Module Bundle");
  assert.equal(formatPaymentDuration(payment.duration_months), "3 months");
  assert.deepEqual(getPaymentAccessResult(payment), {
    label: "Latest access date",
    value: "2027-01-01T00:00:00Z",
  });
  assert.deepEqual(getPaymentVerificationCopy(payment), {
    heading: "Access unlocked",
    message: "3-Module Bundle is now active.",
  });
});

test("extension verification copy does not describe an extension as a new unlock", () => {
  assert.deepEqual(getPaymentVerificationCopy({
    product_label: "Pension",
    purchase_intent: "extension",
    item_count: 1,
  }), {
    heading: "Access extended",
    message: "Pension access was extended.",
  });
});

test("failed and abandoned provider outcomes are never receipt eligible", () => {
  assert.equal(getPaymentStatusMeta({ provider_status: "failed" }).label, "Failed");
  assert.equal(getPaymentStatusMeta({ provider_status: "abandoned" }).label, "Not completed");
  assert.equal(getPaymentStatusMeta({ provider_status: "failed" }).canViewReceipt, false);
});

test("current and legacy purchase presentation matrix preserves authoritative facts", () => {
  const cases = [
    ["single 1 month", { product_label: "Pension", duration_months: 1, item_count: 1 }, "Pension", "1 month"],
    ["single 3 months", { product_label: "Pension", duration_months: 3, item_count: 1 }, "Pension", "3 months"],
    ["single 6 months", { product_label: "Pension", duration_months: 6, item_count: 1 }, "Pension", "6 months"],
    ["early extension", { product_label: "Pension", duration_months: 3, item_count: 1, purchase_intent: "extension" }, "Pension", "3 months"],
    ["Pick 3 all new", { product_label: "3-Module Bundle", duration_months: 1, item_count: 3, purchase_intent: "purchase" }, "3-Module Bundle", "1 month"],
    ["Pick 3 mixed", { product_label: "3-Module Bundle", duration_months: 3, item_count: 3, purchase_intent: "mixed" }, "3-Module Bundle", "3 months"],
    ["Pick 3 all extended", { product_label: "3-Module Bundle", duration_months: 6, item_count: 3, purchase_intent: "extension" }, "3-Module Bundle", "6 months"],
    ["Complete all new", { product_label: "Complete Module Bundle", duration_months: 1, item_count: 8, purchase_intent: "purchase" }, "Complete Module Bundle", "1 month"],
    ["Complete mixed", { product_label: "Complete Module Bundle", duration_months: 6, item_count: 8, purchase_intent: "mixed" }, "Complete Module Bundle", "6 months"],
    ["legacy", { purchase_label: "Legacy full access", is_legacy_full_access: true }, "Legacy full access", ""],
  ];

  cases.forEach(([name, payment, expectedProduct, expectedDuration]) => {
    assert.equal(getPaymentProductLabel(payment), expectedProduct, `${name} product`);
    assert.equal(formatPaymentDuration(payment.duration_months), expectedDuration, `${name} duration`);
  });
});
