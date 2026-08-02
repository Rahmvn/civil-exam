import { getAdminClient } from "./paystack.ts";

const DEFAULT_FROM = "PromotionSure <support@promotionsure.com.ng>";
const SUPPORT_EMAIL = "promotionsureapp@gmail.com";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatMoney(kobo: unknown, currency: unknown) {
  const amount = Number(kobo ?? 0) / 100;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: String(currency || "NGN"),
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(value: unknown) {
  if (!value) return "Not available";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function paymentSuccessTemplate(details: Record<string, unknown>) {
  const subjectName = escapeHtml(details.subject_name || "your access");
  const reference = escapeHtml(details.provider_reference);
  const amount = escapeHtml(formatMoney(details.amount_kobo, details.currency));
  const expiresAt = escapeHtml(formatDate(details.expires_at));

  return {
    subject: `Payment confirmed for ${subjectName}`,
    text: [
      "Your PromotionSure payment was confirmed.",
      "",
      `Access: ${subjectName}`,
      `Amount: ${amount}`,
      `Reference: ${reference}`,
      `Access valid until: ${expiresAt}`,
      "",
      "You can now open your modules from the dashboard or Access and payment page.",
      `For help, contact ${SUPPORT_EMAIL} and include the payment reference.`,
    ].join("\n"),
    html: `
      <p>Your PromotionSure payment was confirmed.</p>
      <p><strong>Access:</strong> ${subjectName}<br>
      <strong>Amount:</strong> ${amount}<br>
      <strong>Reference:</strong> ${reference}<br>
      <strong>Access valid until:</strong> ${expiresAt}</p>
      <p>You can now open your modules from the dashboard or Access and payment page.</p>
      <p>For help, contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> and include the payment reference.</p>
    `,
  };
}

function paymentAccessIssueTemplate(details: Record<string, unknown>) {
  const subjectName = escapeHtml(details.subject_name || "your access");
  const reference = escapeHtml(details.provider_reference);
  const amount = escapeHtml(formatMoney(details.amount_kobo, details.currency));

  return {
    subject: `Payment received - access review needed`,
    text: [
      "PromotionSure received your payment, but module access still needs attention.",
      "",
      `Access: ${subjectName}`,
      `Amount: ${amount}`,
      `Reference: ${reference}`,
      "",
      "Please do not pay again for the same access while this is being reviewed.",
      `For help, contact ${SUPPORT_EMAIL} and include the payment reference.`,
    ].join("\n"),
    html: `
      <p>PromotionSure received your payment, but module access still needs attention.</p>
      <p><strong>Access:</strong> ${subjectName}<br>
      <strong>Amount:</strong> ${amount}<br>
      <strong>Reference:</strong> ${reference}</p>
      <p>Please do not pay again for the same access while this is being reviewed.</p>
      <p>For help, contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> and include the payment reference.</p>
    `,
  };
}

function paymentReviewTemplate(
  details: Record<string, unknown>,
  eventType: string,
) {
  const subjectName = escapeHtml(details.subject_name || "your module");
  const reference = escapeHtml(details.provider_reference);
  const amount = escapeHtml(formatMoney(details.amount_kobo, details.currency));
  const copyByType: Record<string, { subject: string; lead: string; next: string }> = {
    refund_pending: {
      subject: "Refund is being processed",
      lead: "A refund for your PromotionSure payment is being processed.",
      next: "Bank and payment-provider timelines may affect when funds reach you.",
    },
    refund_processed: {
      subject: "Refund processed",
      lead: "A refund for your PromotionSure payment has been processed.",
      next: "Your module access may end if the payment was fully refunded.",
    },
    refund_failed: {
      subject: "Refund could not be completed",
      lead: "The payment provider reported that a refund could not be completed.",
      next: "Payment operations may need to review this before any further action.",
    },
    payment_disputed: {
      subject: "Payment dispute under review",
      lead: "Your payment is under dispute review.",
      next: "Module access may be paused while the payment provider reviews the dispute.",
    },
    payment_dispute_resolved: {
      subject: "Payment dispute resolved",
      lead: "The payment provider has resolved a dispute on your payment.",
      next: "Your access status will follow the final payment outcome shown in your account.",
    },
  };
  const copy = copyByType[eventType] ?? copyByType.payment_disputed;

  return {
    subject: copy.subject,
    text: [
      copy.lead,
      "",
      `Module: ${subjectName}`,
      `Amount: ${amount}`,
      `Reference: ${reference}`,
      "",
      copy.next,
      `For help, contact ${SUPPORT_EMAIL} and include the payment reference.`,
    ].join("\n"),
    html: `
      <p>${escapeHtml(copy.lead)}</p>
      <p><strong>Module:</strong> ${subjectName}<br>
      <strong>Amount:</strong> ${amount}<br>
      <strong>Reference:</strong> ${reference}</p>
      <p>${escapeHtml(copy.next)}</p>
      <p>For help, contact <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a> and include the payment reference.</p>
    `,
  };
}

async function createOrClaimEmailEvent(
  eventKey: string,
  eventType: string,
  details: Record<string, unknown>,
) {
  const adminClient = getAdminClient();
  const recipientEmail = String(details.recipient_email ?? "").trim();
  if (!recipientEmail) return null;

  const payload = {
    event_key: eventKey,
    event_type: eventType,
    recipient_email: recipientEmail,
    user_id: details.user_id ?? null,
    payment_order_id: details.payment_order_id ?? details.id ?? null,
    status: "pending",
    metadata: {
      subject_name: details.subject_name ?? null,
      subject_slug: details.subject_slug ?? null,
      provider_reference: details.provider_reference ?? null,
      amount_kobo: details.amount_kobo ?? null,
      currency: details.currency ?? null,
      expires_at: details.expires_at ?? null,
    },
  };

  const { data, error } = await adminClient
    .from("transactional_email_events")
    .insert(payload)
    .select("id")
    .maybeSingle();

  if (!error) return data;
  if (error.code === "23505") return null;
  throw error;
}

async function markEmailEvent(
  eventId: string,
  updates: Record<string, unknown>,
) {
  const adminClient = getAdminClient();
  const { error } = await adminClient
    .from("transactional_email_events")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", eventId);

  if (error) throw error;
}

async function sendWithResend(
  to: string,
  message: { subject: string; text: string; html: string },
  idempotencyKey: string,
) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { skipped: true, reason: "RESEND_API_KEY is not configured" };

  const from = Deno.env.get("TRANSACTIONAL_EMAIL_FROM") || DEFAULT_FROM;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || "Transactional email failed");
  }

  return { skipped: false, providerMessageId: payload?.id ?? null };
}

export async function sendPaymentSuccessEmail(details: Record<string, unknown>) {
  return sendTrackedTransactionalEmail({
    details,
    eventType: "payment_success",
    message: paymentSuccessTemplate(details),
  });
}

async function sendTrackedTransactionalEmail({
  details,
  eventType,
  message,
}: {
  details: Record<string, unknown>;
  eventType: string;
  message: { subject: string; text: string; html: string };
}) {
  const eventKey = `${eventType}:${details.provider_reference}`;
  const event = await createOrClaimEmailEvent(
    eventKey,
    eventType,
    details,
  );
  if (!event?.id) return { sent: false, duplicate: true };

  try {
    const result = await sendWithResend(String(details.recipient_email), message, eventKey);
    if (result.skipped) {
      await markEmailEvent(event.id, {
        status: "skipped",
        error_message: result.reason,
        attempted_at: new Date().toISOString(),
      });
      return { sent: false, skipped: true };
    }

    await markEmailEvent(event.id, {
      status: "sent",
      provider_message_id: result.providerMessageId,
      attempted_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
    });
    return { sent: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transactional email failed";
    await markEmailEvent(event.id, {
      status: "failed",
      error_message: message.slice(0, 500),
      attempted_at: new Date().toISOString(),
    });
    console.warn("Transactional email failed", {
      eventType,
      reference: details.provider_reference,
      message,
    });
    return { sent: false, failed: true };
  }
}

export async function sendPaymentAccessIssueEmail(details: Record<string, unknown>) {
  return sendTrackedTransactionalEmail({
    details,
    eventType: "payment_access_issue",
    message: paymentAccessIssueTemplate(details),
  });
}

export async function sendPaymentReviewEmail(
  details: Record<string, unknown>,
  eventType: string,
) {
  return sendTrackedTransactionalEmail({
    details,
    eventType,
    message: paymentReviewTemplate(details, eventType),
  });
}

export async function getPaymentEmailDetails(reference: string) {
  const adminClient = getAdminClient();
  const { data: order, error } = await adminClient
    .from("payment_orders")
    .select("id, user_id, subject_id, purchase_type, purchase_label, provider_reference, amount_kobo, currency")
    .eq("provider_reference", reference)
    .maybeSingle();

  if (error) throw error;
  if (!order) return null;

  const subjectRequest = order.subject_id
    ? adminClient.from("subjects").select("name, slug").eq("id", order.subject_id).maybeSingle()
    : Promise.resolve({ data: null, error: null });

  const [{ data: profile, error: profileError }, { data: subject, error: subjectError }, { data: entitlement, error: entitlementError }] =
    await Promise.all([
      adminClient.from("profiles").select("email").eq("id", order.user_id).maybeSingle(),
      subjectRequest,
      adminClient
        .from("module_entitlements")
        .select("expires_at")
        .eq("payment_order_id", order.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  if (profileError) throw profileError;
  if (subjectError) throw subjectError;
  if (entitlementError) throw entitlementError;

  return {
    payment_order_id: order.id,
    user_id: order.user_id,
    recipient_email: profile?.email,
    provider_reference: order.provider_reference,
    amount_kobo: order.amount_kobo,
    currency: order.currency,
    subject_name: order.purchase_type === "bundle_offer" ? order.purchase_label : subject?.name,
    subject_slug: order.purchase_type === "single_module" ? subject?.slug : null,
    expires_at: entitlement?.expires_at ?? null,
  };
}
