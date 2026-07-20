import assert from "node:assert/strict";
import test from "node:test";
import {
  createPaystackEventKey,
  createPaystackSignature,
  getPaystackEnvironment,
  getPaystackEventReference,
  getPaymentUserId,
  getPublishedContentTable,
  isPaystackPostPaymentEvent,
  isValidPaystackSignature,
  validatePaystackEnvironment,
  validateLegacyPaymentData,
  validateModulePaymentData,
} from "../../supabase/functions/_shared/payment-validation.js";

const order = {
  id: "order-1",
  user_id: "user-1",
  subject_id: "subject-1",
  amount_kobo: 250000,
  currency: "NGN",
};

const payment = {
  amount: 250000,
  currency: "ngn",
  metadata: {
    payment_order_id: "order-1",
    user_id: "user-1",
    subject_id: "subject-1",
    exam_pack_id: "pack-1",
  },
};

test("module payment validation accepts only an exact owned order", () => {
  assert.doesNotThrow(() => validateModulePaymentData(order, payment));

  const invalidCases = [
    [null, payment, /required/],
    [order, null, /required/],
    [order, { ...payment, amount: 249999 }, /amount/],
    [order, { ...payment, currency: "USD" }, /currency/],
    [order, { ...payment, currency: "" }, /currency/],
    [{ ...order, currency: null }, payment, /currency/],
    [order, { ...payment, currency: null }, /currency/],
    [order, { ...payment, metadata: null }, /does not match/],
    [order, { ...payment, metadata: { ...payment.metadata, payment_order_id: "other" } }, /does not match/],
    [order, { ...payment, metadata: { ...payment.metadata, user_id: "other" } }, /does not match/],
    [order, { ...payment, metadata: { ...payment.metadata, subject_id: "other" } }, /does not match/],
  ];

  invalidCases.forEach(([nextOrder, nextPayment, expected]) => {
    assert.throws(() => validateModulePaymentData(nextOrder, nextPayment), expected);
  });
});

test("legacy payment validation binds the active pack, price, and currency", () => {
  const pack = { id: "pack-1", price_kobo: 500000, currency: "NGN" };
  const legacyPayment = { ...payment, amount: 500000 };
  assert.doesNotThrow(() => validateLegacyPaymentData(pack, legacyPayment));

  assert.throws(() => validateLegacyPaymentData(null, legacyPayment), /required/);
  assert.throws(() => validateLegacyPaymentData(pack, null), /required/);
  assert.throws(() => validateLegacyPaymentData(pack, { ...legacyPayment, metadata: null }), /does not match/);
  assert.throws(() => validateLegacyPaymentData(pack, { ...legacyPayment, amount: 1 }), /does not match/);
  assert.throws(() => validateLegacyPaymentData(pack, { ...legacyPayment, currency: "USD" }), /does not match/);
  assert.throws(() => validateLegacyPaymentData({ ...pack, currency: null }, legacyPayment), /does not match/);
  assert.throws(() => validateLegacyPaymentData(pack, {
    ...legacyPayment,
    metadata: { ...legacyPayment.metadata, exam_pack_id: "other" },
  }), /does not match/);
});

test("payment helpers normalize user ownership and content tables", () => {
  assert.equal(getPaymentUserId(payment), "user-1");
  assert.equal(getPaymentUserId({ metadata: { user_id: "  " } }), null);
  assert.equal(getPaymentUserId({ metadata: { user_id: 42 } }), null);
  assert.equal(getPaymentUserId(null), null);
  assert.equal(getPaymentUserId({}), null);
  assert.equal(getPublishedContentTable("oral"), "oral_questions");
  assert.equal(getPublishedContentTable("objective"), "questions");
  assert.equal(getPublishedContentTable("unknown"), "questions");
  assert.equal(getPublishedContentTable(), "questions");
});

test("Paystack transactions must match the configured key environment", () => {
  assert.equal(getPaystackEnvironment("sk_test_local-key"), "test");
  assert.equal(getPaystackEnvironment("sk_live_local-key"), "live");
  assert.equal(validatePaystackEnvironment({ data: { domain: "live" } }, "sk_live_local-key"), "live");
  assert.equal(validatePaystackEnvironment({ domain: "test" }, "sk_test_local-key"), "test");
  assert.throws(() => getPaystackEnvironment("local-key"), /could not be determined/);
  assert.throws(
    () => validatePaystackEnvironment({ data: { domain: "test" } }, "sk_live_local-key"),
    /does not match/,
  );
  assert.throws(() => validatePaystackEnvironment({}, "sk_test_local-key"), /does not match/);
});

test("Paystack post-payment helpers recognize references and stable event fingerprints", async () => {
  assert.equal(getPaystackEventReference({ data: { reference: " PS-CHARGE " } }), "PS-CHARGE");
  assert.equal(getPaystackEventReference({ data: { transaction_reference: "PS-REFUND" } }), "PS-REFUND");
  assert.equal(getPaystackEventReference({ data: { transaction: { reference: "PS-DISPUTE" } } }), "PS-DISPUTE");
  assert.equal(getPaystackEventReference({ data: {} }), null);
  assert.equal(isPaystackPostPaymentEvent("refund.processed"), true);
  assert.equal(isPaystackPostPaymentEvent("charge.dispute.create"), true);
  assert.equal(isPaystackPostPaymentEvent("charge.success"), false);

  const body = JSON.stringify({ event: "refund.processed", data: { transaction_reference: "PS-1" } });
  const key = await createPaystackEventKey(body);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(await createPaystackEventKey(body), key);
  assert.notEqual(await createPaystackEventKey(`${body} `), key);
  await assert.rejects(() => createPaystackEventKey(""), /required/);
  await assert.rejects(() => createPaystackEventKey(body, {}), /required/);
});

test("Paystack signatures use SHA-512 HMAC and reject malformed or modified values", async () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "PS-1" } });
  const secret = "local-test-secret";
  const signature = await createPaystackSignature(body, secret);

  assert.equal(signature.length, 128);
  assert.equal(await isValidPaystackSignature(body, signature, secret), true);
  assert.equal(await isValidPaystackSignature(body, signature.toUpperCase(), secret), true);
  assert.equal(await isValidPaystackSignature(`${body} `, signature, secret), false);
  assert.equal(await isValidPaystackSignature(body, signature.slice(2), secret), false);
  assert.equal(await isValidPaystackSignature(body, "not-hex", secret), false);
  assert.equal(await isValidPaystackSignature(body, "a", secret), false);
  assert.equal(await isValidPaystackSignature(body, 123, secret), false);
  assert.equal(await isValidPaystackSignature(body, "", secret), false);
  assert.equal(await isValidPaystackSignature(body, null, secret), false);
  await assert.rejects(() => createPaystackSignature(body, "", globalThis.crypto), /required/);
  await assert.rejects(() => createPaystackSignature(null, secret, globalThis.crypto), /required/);
  await assert.rejects(() => createPaystackSignature(body, secret, {}), /required/);
  await assert.rejects(() => createPaystackSignature(body, secret, null), /required/);
});
