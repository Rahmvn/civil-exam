import { jsonResponse, readTextBody, requireEnv } from "../_shared/http.ts";
import { getAdminClient } from "../_shared/paystack.ts";
import { verifySvixWebhook } from "../_shared/email/webhook-signature.ts";

const EVENT_TYPES: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.failed": "failed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.suppressed": "suppressed",
};

function firstRecipient(value: unknown) {
  return Array.isArray(value) ? String(value[0] ?? "").trim().toLowerCase() : "";
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  let rawBody = "";
  try {
    rawBody = await readTextBody(request, 128_000);
    const secret = requireEnv("RESEND_WEBHOOK_SECRET");
    if (!(await verifySvixWebhook(rawBody, request.headers, secret))) {
      console.warn("Invalid Resend webhook rejected");
      return jsonResponse({ error: "Invalid signature" }, 401);
    }
  } catch (error) {
    console.warn("Malformed Resend webhook rejected", { message: error instanceof Error ? error.message : "Invalid request" });
    return jsonResponse({ error: "Invalid webhook" }, 400);
  }

  let event: Record<string, any>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "Invalid webhook payload" }, 400);
  }

  const svixId = request.headers.get("svix-id") || request.headers.get("webhook-id") || "";
  const normalizedType = EVENT_TYPES[String(event.type ?? "")];
  const messageId = String(event.data?.email_id ?? event.data?.id ?? "").trim();
  const occurredAt = new Date(String(event.created_at ?? ""));
  if (!normalizedType || !svixId || !messageId || Number.isNaN(occurredAt.getTime())) {
    return jsonResponse({ error: "Unsupported or malformed webhook event" }, 400);
  }

  const metadata = {
    bounce_type: String(event.data?.bounce?.type ?? "").slice(0, 80) || null,
    reason: String(event.data?.reason ?? event.data?.bounce?.message ?? "").slice(0, 300) || null,
  };
  const adminClient = getAdminClient();
  const { data, error } = await adminClient.rpc("record_email_provider_event", {
    requested_provider: "resend",
    requested_provider_event_id: svixId,
    requested_provider_message_id: messageId,
    requested_event_type: normalizedType,
    requested_occurred_at: occurredAt.toISOString(),
    requested_recipient_email: firstRecipient(event.data?.to),
    requested_metadata: metadata,
  });
  if (error) {
    console.error("Resend webhook persistence failed", { eventId: svixId, message: error.message });
    return jsonResponse({ error: "Webhook could not be persisted" }, 500);
  }

  console.log("Resend webhook processed", {
    eventId: svixId,
    eventType: normalizedType,
    emailEventId: data?.email_event_id ?? null,
    duplicate: Boolean(data?.duplicate),
  });
  if (data?.suppression_created) console.warn("Email suppression created", { eventId: svixId, eventType: normalizedType });
  return jsonResponse({ received: true, duplicate: Boolean(data?.duplicate) });
});
