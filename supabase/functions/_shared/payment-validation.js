function normalizedCurrency(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function getPaystackEnvironment(secret) {
  if (typeof secret !== "string") throw new Error("A valid Paystack secret key is required");
  if (secret.startsWith("sk_live_")) return "live";
  if (secret.startsWith("sk_test_")) return "test";
  throw new Error("The Paystack secret key environment could not be determined");
}

export function validatePaystackEnvironment(payload, secret) {
  const expectedEnvironment = getPaystackEnvironment(secret);
  const transaction = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const receivedEnvironment = String(transaction?.domain ?? "").trim().toLowerCase();

  if (receivedEnvironment !== expectedEnvironment) {
    throw new Error("The Paystack transaction environment does not match the configured account");
  }

  return expectedEnvironment;
}

export function getPublishedContentTable(practiceType) {
  return practiceType === "oral" ? "oral_questions" : "questions";
}

export function validateModulePaymentData(order, paymentData) {
  if (!order || !paymentData) {
    throw new Error("The module order and verified payment are required");
  }

  if (Number(paymentData.amount) !== Number(order.amount_kobo)) {
    throw new Error("The verified payment amount does not match this module order");
  }

  const paidCurrency = normalizedCurrency(paymentData.currency);
  const orderCurrency = normalizedCurrency(order.currency);

  if (!paidCurrency || paidCurrency !== orderCurrency) {
    throw new Error("The verified payment currency does not match this module order");
  }

  const metadata = paymentData.metadata;
  if (
    !metadata
    || metadata.payment_order_id !== order.id
    || metadata.user_id !== order.user_id
    || metadata.subject_id !== order.subject_id
  ) {
    throw new Error("The verified payment does not match this module order");
  }
}

export function validateLegacyPaymentData(pack, paymentData) {
  if (!pack || !paymentData) {
    throw new Error("The active access offer and verified payment are required");
  }

  const metadata = paymentData.metadata;
  if (
    !metadata
    || metadata.exam_pack_id !== pack.id
    || Number(paymentData.amount) !== Number(pack.price_kobo)
    || normalizedCurrency(paymentData.currency) !== normalizedCurrency(pack.currency)
  ) {
    throw new Error("This legacy payment does not match the active access offer");
  }
}

export function getPaymentUserId(paymentData) {
  const userId = paymentData?.metadata?.user_id;
  return typeof userId === "string" && userId.trim() ? userId : null;
}

function hexToBytes(value) {
  if (typeof value !== "string" || value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) {
    return null;
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

export async function createPaystackSignature(body, secret, cryptoApi = globalThis.crypto) {
  if (typeof body !== "string" || !secret || !cryptoApi?.subtle) {
    throw new Error("A webhook body, secret, and Web Crypto implementation are required");
  }

  const encoder = new TextEncoder();
  const key = await cryptoApi.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signed = await cryptoApi.subtle.sign("HMAC", key, encoder.encode(body));
  return [...new Uint8Array(signed)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function isValidPaystackSignature(body, signature, secret, cryptoApi = globalThis.crypto) {
  const received = hexToBytes(signature);
  if (!received) return false;

  const expectedHex = await createPaystackSignature(body, secret, cryptoApi);
  return constantTimeEqual(received, hexToBytes(expectedHex));
}
