const PROCESSING_STATUSES = new Set(["ongoing", "pending", "processing", "queued"]);

export function getPaymentStatusMeta(payment) {
  const providerStatus = String(payment.provider_status ?? "").toLowerCase();
  const reviewStatus = String(payment.review_status ?? "clear").toLowerCase();
  const isFulfilled = payment.fulfillment_status === "fulfilled" || payment.status === "active";

  if (reviewStatus === "refunded") {
    return {
      label: "Refunded",
      tone: "reversed",
      description: "This payment was fully refunded and its module access ended.",
      canCheck: false,
      canViewReceipt: false,
    };
  }

  if (reviewStatus === "partially_refunded") {
    return {
      label: "Partially refunded",
      tone: "processing",
      description: "Part of this payment was refunded. Module access remains available.",
      canCheck: false,
      canViewReceipt: false,
    };
  }

  if (reviewStatus === "refund_pending") {
    return {
      label: "Refund pending",
      tone: "processing",
      description: "Paystack is processing a refund for this payment.",
      canCheck: false,
      canViewReceipt: false,
    };
  }

  if (reviewStatus === "disputed") {
    return {
      label: "Under dispute",
      tone: "issue",
      description: "Module access is paused while this payment dispute is reviewed.",
      canCheck: false,
      canViewReceipt: false,
    };
  }

  if (reviewStatus === "dispute_resolved" && !isFulfilled) {
    return {
      label: "Dispute resolved",
      tone: "reversed",
      description: "This dispute was resolved and module access ended.",
      canCheck: false,
      canViewReceipt: false,
    };
  }

  if (providerStatus === "success" && !isFulfilled) {
    return {
      label: "Access issue",
      tone: "issue",
      description: "Payment received. Module access still needs attention.",
      canCheck: Boolean(payment.paystack_reference),
      canViewReceipt: false,
    };
  }

  if (PROCESSING_STATUSES.has(providerStatus)) {
    return {
      label: "Processing",
      tone: "processing",
      description: "Paystack is still processing this payment.",
      canCheck: Boolean(payment.paystack_reference),
      canViewReceipt: false,
    };
  }

  if (providerStatus === "reversed") {
    return {
      label: "Reversed",
      tone: "reversed",
      description: "This payment was reversed.",
      canCheck: false,
      canViewReceipt: false,
    };
  }

  return {
    label: "Successful",
    tone: "successful",
    description: "Payment completed.",
    canCheck: false,
    canViewReceipt: isFulfilled,
  };
}

export function partitionPaymentRecords(payments) {
  return payments.reduce((result, payment) => {
    if (payment.record_type === "attention") result.attention.push(payment);
    else result.history.push(payment);
    return result;
  }, { attention: [], history: [] });
}
