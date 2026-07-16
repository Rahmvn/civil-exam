const PROCESSING_STATUSES = new Set(["ongoing", "pending", "processing", "queued"]);

export function getPaymentStatusMeta(payment) {
  const providerStatus = String(payment.provider_status ?? "").toLowerCase();
  const isFulfilled = payment.fulfillment_status === "fulfilled" || payment.status === "active";

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
