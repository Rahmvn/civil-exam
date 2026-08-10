import { getAdminClient, getPaymentOrderPresentation } from "./paystack.ts";
export { sendWithResend } from "./email/provider.ts";

async function enqueueTrackedTransactionalEmail({
  details,
  eventType,
  sourceIdentity,
}: {
  details: Record<string, unknown>;
  eventType: string;
  sourceIdentity?: string;
}) {
  const reference = String(details.provider_reference ?? "");
  const eventKey = `${eventType}:${sourceIdentity || reference}`;
  const adminClient = getAdminClient();
  const { data, error } = await adminClient.rpc("enqueue_transactional_email_event", {
    requested_event_key: eventKey,
    requested_event_type: eventType,
    requested_user_id: details.user_id,
    requested_payment_order_id: details.payment_order_id ?? details.id,
    requested_payload: details,
    requested_priority: 10,
  });
  if (error) throw error;
  return { queued: Boolean(data?.created), duplicate: !data?.created, eventId: data?.id ?? null };
}

export function enqueuePaymentSuccessEmail(details: Record<string, unknown>) {
  return enqueueTrackedTransactionalEmail({ details, eventType: "payment_success" });
}

export function enqueuePaymentAccessIssueEmail(details: Record<string, unknown>) {
  return enqueueTrackedTransactionalEmail({ details, eventType: "payment_access_issue" });
}

export function enqueuePaymentReviewEmail(
  details: Record<string, unknown>,
  eventType: string,
  sourceIdentity: string,
) {
  return enqueueTrackedTransactionalEmail({ details, eventType, sourceIdentity });
}

export async function getPaymentEmailDetails(reference: string) {
  const payment = await getPaymentOrderPresentation(reference);
  if (!payment) return null;
  const firstItem = Array.isArray(payment.items) ? payment.items[0] : null;
  return {
    ...payment,
    payment_order_id: payment.id,
    user_id: payment.user_id,
    subject_name: payment.product_label,
    subject_slug: Number(payment.item_count) === 1 ? firstItem?.subject_slug ?? null : null,
    expires_at: payment.access_expires_at ?? null,
  };
}
