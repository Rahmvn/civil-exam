const TOP_LEVEL_FIELDS = ["event", "status", "message"];
const TRANSACTION_FIELDS = [
  "id",
  "domain",
  "status",
  "reference",
  "amount",
  "message",
  "gateway_response",
  "gateway_response_code",
  "paid_at",
  "paidAt",
  "created_at",
  "channel",
  "currency",
  "fees",
  "metadata",
  "authorization_url",
  "access_code",
];

function pick(source, fields) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  return Object.fromEntries(fields
    .filter((field) => source[field] !== undefined && source[field] !== null)
    .map((field) => [field, source[field]]));
}

export function sanitizePaymentPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};

  const sanitized = pick(payload, TOP_LEVEL_FIELDS);
  const transaction = payload.data && typeof payload.data === "object"
    ? payload.data
    : payload;
  const safeTransaction = pick(transaction, TRANSACTION_FIELDS);

  if (payload.data && typeof payload.data === "object") {
    sanitized.data = safeTransaction;
    return sanitized;
  }

  return safeTransaction;
}

export function sanitizePaystackPostPaymentEvent(payload) {
  const event = typeof payload?.event === "string" ? payload.event.trim().toLowerCase() : "";
  const data = payload?.data;
  if (!event || !data || typeof data !== "object" || Array.isArray(data)) return {};

  if (event.startsWith("refund.")) {
    return {
      event,
      data: pick(data, [
        "id",
        "status",
        "transaction_reference",
        "refund_reference",
        "amount",
        "currency",
        "domain",
        "processor",
      ]),
    };
  }

  if (event.startsWith("charge.dispute.")) {
    return {
      event,
      data: {
        ...pick(data, ["id", "status", "resolution", "domain", "reason", "dispute_code"]),
        transaction: pick(data.transaction, ["id", "domain", "status", "reference", "amount", "currency"]),
      },
    };
  }

  return {};
}
