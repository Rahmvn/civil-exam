const PROCESSING_STATUSES = new Set(["ongoing", "pending", "processing", "queued"]);
const FAILED_STATUSES = new Set(["failed", "declined"]);
const INCOMPLETE_STATUSES = new Set(["abandoned", "cancelled", "canceled", "timeout"]);

export function getPaymentItems(payment) {
  return Array.isArray(payment?.items) ? payment.items.filter(Boolean) : [];
}

export function getPaymentProductLabel(payment) {
  const canonical = String(payment?.product_label ?? "").trim();
  if (canonical) return canonical;
  if (payment?.subject_name) return String(payment.subject_name).trim();
  if (payment?.purchase_label) return String(payment.purchase_label).trim();
  if (payment?.is_legacy_full_access) return "Legacy full access";
  return "Module access";
}

export function formatPaymentDuration(months) {
  const value = Number(months);
  if (!Number.isInteger(value) || value <= 0) return "";
  return `${value} month${value === 1 ? "" : "s"}`;
}

export function getPaymentAccessResult(payment) {
  if (!payment?.access_expires_at && !payment?.expires_at) return null;
  return {
    label: payment.access_result_kind === "latest" ? "Latest access date" : "Access until",
    value: payment.access_expires_at || payment.expires_at,
  };
}

export function getPaymentVerificationCopy(payment, fallback = {}) {
  const productLabel = getPaymentProductLabel(payment || fallback);
  const intent = payment?.purchase_intent;
  const itemCount = Number(payment?.item_count ?? fallback?.unlocked_count ?? 0);

  if (intent === "extension") {
    return {
      heading: "Access extended",
      message: `${productLabel} access was extended.`,
    };
  }

  if (itemCount > 1 || payment?.purchase_scope === "pick3" || payment?.purchase_scope === "complete") {
    return {
      heading: "Access unlocked",
      message: `${productLabel} is now active.`,
    };
  }

  return {
    heading: "Access unlocked",
    message: productLabel === "Module access"
      ? "Your access is now active."
      : `${productLabel} is now unlocked.`,
  };
}

export function getPaymentStatusMeta(payment) {
  const providerStatus = String(payment.provider_status ?? "").toLowerCase();
  const reviewStatus = String(payment.review_status ?? "clear").toLowerCase();
  const isFulfilled = payment.fulfillment_status === "fulfilled" || payment.status === "active";
  const canViewReceipt = typeof payment.receipt_eligible === "boolean"
    ? payment.receipt_eligible
    : isFulfilled;

  if (reviewStatus === "refunded") {
    return {
      label: "Refunded",
      tone: "reversed",
      description: "This payment was fully refunded and its access ended.",
      canCheck: false,
      canViewReceipt: false,
    };
  }

  if (reviewStatus === "partially_refunded") {
    return {
      label: "Partially refunded",
      tone: "processing",
      description: "Part of this payment was refunded. Access remains available.",
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
      description: "Access is paused while this payment dispute is reviewed.",
      canCheck: false,
      canViewReceipt: false,
    };
  }

  if (reviewStatus === "access_review") {
    return {
      label: "Under review",
      description: "This payment is under review. Access will be updated after the review is completed.",
      tone: "issue",
      canCheck: false,
      canViewReceipt: false,
    };
  }

  if (reviewStatus === "dispute_resolved" && !isFulfilled) {
    return {
      label: "Dispute resolved",
      tone: "reversed",
      description: "This dispute was resolved and access ended.",
      canCheck: false,
      canViewReceipt: false,
    };
  }

  if (providerStatus === "success" && !isFulfilled) {
    return {
      label: "Access issue",
      tone: "issue",
      description: "Payment received. Access still needs attention.",
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

  if (FAILED_STATUSES.has(providerStatus) || payment.status === "failed") {
    return {
      label: "Failed",
      tone: "reversed",
      description: "This payment was not completed.",
      canCheck: false,
      canViewReceipt: false,
    };
  }

  if (INCOMPLETE_STATUSES.has(providerStatus)) {
    return {
      label: "Not completed",
      tone: "reversed",
      description: "This checkout was not completed.",
      canCheck: false,
      canViewReceipt: false,
    };
  }

  return {
    label: "Successful",
    tone: "successful",
    description: "Payment completed.",
    canCheck: false,
    canViewReceipt,
  };
}

export function partitionPaymentRecords(payments) {
  return payments.reduce((result, payment) => {
    if (payment.record_type === "attention") result.attention.push(payment);
    else result.history.push(payment);
    return result;
  }, { attention: [], history: [] });
}
