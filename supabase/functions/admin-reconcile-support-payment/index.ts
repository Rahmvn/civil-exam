import { corsHeaders, jsonResponse, requireEnv } from "../_shared/http.ts";
import {
  activateModulePurchase,
  getAdminClient,
  getAuthedUser,
  getModulePaymentOrder,
  getPaystackTransactionStatus,
  markModulePaymentFulfillmentFailed,
  recordModulePaymentStatus,
  validateModulePayment,
} from "../_shared/paystack.ts";
import { getPaymentUserId, validatePaystackEnvironment } from "../_shared/payment-validation.js";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const adminUser = await getAuthedUser(request);
    const adminClient = getAdminClient();
    const { data: adminProfile, error: profileError } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", adminUser.id)
      .maybeSingle();

    if (profileError || adminProfile?.role !== "admin") {
      return jsonResponse({ error: "Admin access is required" }, 403);
    }

    const { support_request_id: supportRequestId } = await request.json();
    if (!supportRequestId || typeof supportRequestId !== "string") {
      return jsonResponse({ error: "Support request is required" }, 400);
    }

    const { data: supportRequest, error: requestError } = await adminClient
      .from("support_requests")
      .select("id, user_id, category, payment_reference, subject_id")
      .eq("id", supportRequestId)
      .maybeSingle();

    if (requestError || !supportRequest) return jsonResponse({ error: "Support request not found" }, 404);
    if (supportRequest.category !== "payment" || !supportRequest.payment_reference) {
      return jsonResponse({ error: "This request does not contain a payment to recheck" }, 400);
    }

    const order = await getModulePaymentOrder(supportRequest.payment_reference);
    if (!order || order.user_id !== supportRequest.user_id) {
      return jsonResponse({ error: "The payment reference is not linked to this candidate" }, 409);
    }
    if (supportRequest.subject_id && supportRequest.subject_id !== order.subject_id) {
      return jsonResponse({ error: "The payment belongs to a different module" }, 409);
    }
    if (order.review_status !== "clear") {
      return jsonResponse({ error: "This payment is under provider review and cannot be changed here" }, 409);
    }

    const { error: auditError } = await adminClient.from("admin_audit_logs").insert({
      actor_id: adminUser.id,
      action: "RECONCILE_SUPPORT_PAYMENT_ATTEMPT",
      entity_type: "support_request",
      entity_id: supportRequest.id,
      metadata: { payment_order_id: order.id, subject_id: order.subject_id },
    });
    if (auditError) {
      return jsonResponse({ error: "The action could not be safely recorded, so no access was changed" }, 500);
    }

    const paystackSecret = requireEnv("PAYSTACK_SECRET_KEY");
    const paystackApiUrl = Deno.env.get("PAYSTACK_API_URL") ?? "https://api.paystack.co";
    const providerResponse = await fetch(
      `${paystackApiUrl}/transaction/verify/${encodeURIComponent(order.provider_reference)}`,
      { headers: { Authorization: `Bearer ${paystackSecret}` } },
    );
    const payload = await providerResponse.json();
    if (providerResponse.ok && payload?.status) validatePaystackEnvironment(payload, paystackSecret);

    const providerStatus = getPaystackTransactionStatus(payload);
    if (!providerResponse.ok || !payload?.status || providerStatus !== "success") {
      if (providerStatus) await recordModulePaymentStatus(order.provider_reference, payload);
      return jsonResponse({ error: "Paystack has not confirmed this payment as successful" }, 409);
    }

    await recordModulePaymentStatus(order.provider_reference, payload);

    try {
      if (getPaymentUserId(payload.data) !== supportRequest.user_id) {
        throw new Error("Payment metadata does not match the candidate");
      }
      validateModulePayment(order, payload.data);
      const entitlement = await activateModulePurchase(order.provider_reference, payload.data);

      return jsonResponse({
        status: "active",
        verified: true,
        expires_at: entitlement.expires_at,
        subject_name: entitlement.subject_name,
      });
    } catch (fulfillmentError) {
      if (order.fulfillment_status !== "fulfilled") {
        await markModulePaymentFulfillmentFailed(order.provider_reference, fulfillmentError);
      }
      return jsonResponse({
        code: "PAYMENT_RECONCILIATION_FAILED",
        error: "The payment details did not pass every safety check. No access was granted.",
      }, 409);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The payment could not be rechecked";
    return jsonResponse({ error: message }, 400);
  }
});
