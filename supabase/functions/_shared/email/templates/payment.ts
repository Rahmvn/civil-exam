import { escapeHtml, SUPPORT_EMAIL } from "../layout.ts";

export type EmailMessage = {
  subject: string;
  preheader: string;
  text: string;
  bodyHtml: string;
};

function formatMoney(kobo: unknown, currency: unknown) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: String(currency || "NGN"),
    maximumFractionDigits: 0,
  }).format(Number(kobo ?? 0) / 100);
}

function formatDate(value: unknown) {
  if (!value) return "Not available";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatDuration(months: unknown) {
  const value = Number(months);
  return Number.isInteger(value) && value > 0 ? `${value} month${value === 1 ? "" : "s"}` : "";
}

function itemNames(details: Record<string, unknown>) {
  return Array.isArray(details.items)
    ? details.items.map((item) => String(item?.subject_name ?? "").trim()).filter(Boolean)
    : [];
}

export function paymentSuccessTemplate(details: Record<string, unknown>): EmailMessage {
  const product = String(details.product_label || details.subject_name || "your access");
  const reference = String(details.provider_reference || "");
  const amount = formatMoney(details.amount_kobo, details.currency);
  const duration = formatDuration(details.duration_months);
  const modules = itemNames(details);
  const expiryValue = details.access_expires_at || details.expires_at;
  const expiryLabel = details.access_result_kind === "latest" ? "Latest resulting access date" : "Access valid until";
  const rows = [
    ["Access", product],
    duration ? ["Duration", duration] : null,
    modules.length > 1 ? ["Modules", modules.join(", ")] : null,
    ["Amount", amount],
    ["Reference", reference],
    expiryValue ? [expiryLabel, formatDate(expiryValue)] : null,
  ].filter(Boolean) as string[][];

  return {
    subject: `Payment confirmed for ${product}`,
    preheader: "Your PromotionSure payment was confirmed.",
    text: [
      "Your PromotionSure payment was confirmed.", "",
      ...rows.map(([label, value]) => `${label}: ${value}`), "",
      "You can now open your modules from the dashboard or Access and payment page.",
      `For help, contact ${SUPPORT_EMAIL} and include the payment reference.`,
    ].join("\n"),
    bodyHtml: `<p>Your PromotionSure payment was confirmed.</p><p>${rows.map(([label, value]) => `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}`).join("<br>")}</p><p>You can now open your modules from the dashboard or Access and payment page.</p>`,
  };
}

export function paymentAccessIssueTemplate(details: Record<string, unknown>): EmailMessage {
  const product = String(details.product_label || details.subject_name || "your access");
  const reference = String(details.provider_reference || "");
  const amount = formatMoney(details.amount_kobo, details.currency);
  return {
    subject: "Payment received - access review needed",
    preheader: "Your payment was received and access needs attention.",
    text: [
      "PromotionSure received your payment, but module access still needs attention.", "",
      `Access: ${product}`, `Amount: ${amount}`, `Reference: ${reference}`, "",
      "Please do not pay again for the same access while this is being reviewed.",
      `For help, contact ${SUPPORT_EMAIL} and include the payment reference.`,
    ].join("\n"),
    bodyHtml: `<p>PromotionSure received your payment, but module access still needs attention.</p><p><strong>Access:</strong> ${escapeHtml(product)}<br><strong>Amount:</strong> ${escapeHtml(amount)}<br><strong>Reference:</strong> ${escapeHtml(reference)}</p><p>Please do not pay again for the same access while this is being reviewed.</p>`,
  };
}

export function paymentReviewTemplate(details: Record<string, unknown>, eventType: string): EmailMessage {
  const product = String(details.product_label || details.subject_name || "your access");
  const reference = String(details.provider_reference || "");
  const amount = formatMoney(details.amount_kobo, details.currency);
  const copyByType: Record<string, { subject: string; lead: string; next: string }> = {
    refund_pending: { subject: "Refund is being processed", lead: "A refund for your PromotionSure payment is being processed.", next: "Bank and payment-provider timelines may affect when funds reach you." },
    refund_processed: { subject: "Refund processed", lead: "A refund for your PromotionSure payment has been processed.", next: "Your module access may end if the payment was fully refunded." },
    refund_failed: { subject: "Refund could not be completed", lead: "The payment provider reported that a refund could not be completed.", next: "Payment operations may need to review this before any further action." },
    payment_disputed: { subject: "Payment dispute under review", lead: "Your payment is under dispute review.", next: "Module access may be paused while the payment provider reviews the dispute." },
    payment_dispute_resolved: { subject: "Payment dispute resolved", lead: "The payment provider has resolved a dispute on your payment.", next: "Your access status will follow the final payment outcome shown in your account." },
  };
  const copy = copyByType[eventType] ?? copyByType.payment_disputed;
  return {
    subject: copy.subject,
    preheader: copy.lead,
    text: [copy.lead, "", `Access: ${product}`, `Amount: ${amount}`, `Reference: ${reference}`, "", copy.next, `For help, contact ${SUPPORT_EMAIL} and include the payment reference.`].join("\n"),
    bodyHtml: `<p>${escapeHtml(copy.lead)}</p><p><strong>Access:</strong> ${escapeHtml(product)}<br><strong>Amount:</strong> ${escapeHtml(amount)}<br><strong>Reference:</strong> ${escapeHtml(reference)}</p><p>${escapeHtml(copy.next)}</p>`,
  };
}
