import {
  corsHeaders,
  getRequestErrorStatus,
  jsonResponse,
  readJsonBody,
  requireEnv,
} from "../_shared/http.ts";
import {
  activateModulePurchase,
  enforceEdgeRateLimit,
  getPaystackTransactionMessage,
  getPaystackTransactionStatus,
  getAuthedUser,
  getAdminClient,
  getModulePaymentOrder,
  markModulePaymentFulfillmentFailed,
  recordModulePaymentStatus,
  validateModulePayment,
} from "../_shared/paystack.ts";
import { validatePaystackEnvironment } from "../_shared/payment-validation.js";
import { getPaymentUserId } from "../_shared/payment-validation.js";
import {
  getPaymentEmailDetails,
  sendPaymentAccessIssueEmail,
  sendPaymentSuccessEmail,
} from "../_shared/transactional-email.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const user = await getAuthedUser(request);
    const adminClient = getAdminClient();
    await enforceEdgeRateLimit(adminClient, user.id, "payment_verify", 30, 300);

    const requestBody = await readJsonBody(request, 2_048) as Record<string, unknown>;
    const reference = requestBody?.reference;

    if (
      typeof reference !== "string"
      || reference.length > 120
      || !/^[A-Za-z0-9._-]+$/.test(reference)
    ) {
      return jsonResponse({ error: "Payment reference is required" }, 400);
    }

    const order = await getModulePaymentOrder(reference);
    if (!order) {
      return jsonResponse({
        code: "UNKNOWN_PAYMENT_REFERENCE",
        error: "This payment reference was not created by PromotionSure",
      }, 404);
    }
    if (order.user_id !== user.id) {
      return jsonResponse(
        { error: "This payment reference does not belong to your account" },
        403,
      );
    }

    console.log("Verifying Paystack payment", { reference });

    const paystackSecret = requireEnv("PAYSTACK_SECRET_KEY");
    const paystackApiUrl = Deno.env.get("PAYSTACK_API_URL") ?? "https://api.paystack.co";
    const paystackResponse = await fetch(
      `${paystackApiUrl}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
        },
      },
    );
    const payload = await paystackResponse.json();
    if (paystackResponse.ok && payload?.status) validatePaystackEnvironment(payload, paystackSecret);

    console.log("Paystack verify response", {
      ok: paystackResponse.ok,
      status: paystackResponse.status,
      dataStatus: payload?.data?.status ?? null,
    });

    const providerStatus = getPaystackTransactionStatus(payload);

    if (!paystackResponse.ok || !payload.status || providerStatus !== "success") {
      if (providerStatus) await recordModulePaymentStatus(reference, payload);

      const providerMessage = getPaystackTransactionMessage(payload);
      const errorMessage = ["declined", "failed"].includes(providerStatus)
        ? "Payment was declined"
        : ["abandoned", "cancelled", "canceled", "timeout"].includes(providerStatus)
          ? "Payment was not completed"
          : providerMessage || "Payment has not been completed";

      return jsonResponse({ error: errorMessage }, 400);
    }

    await recordModulePaymentStatus(reference, payload);

    try {
      const paidUserId = getPaymentUserId(payload.data);
      if (paidUserId !== user.id) {
        throw new Error("Payment metadata does not match the payment order");
      }
      validateModulePayment(order, payload.data);
      const entitlements = await activateModulePurchase(reference, payload.data);
      const primaryEntitlement = entitlements[0];
      const emailDetails = await getPaymentEmailDetails(reference);
      if (emailDetails) {
        await sendPaymentSuccessEmail(emailDetails).catch((emailError) => {
          console.warn("Payment success email could not be sent", {
            reference,
            message: emailError instanceof Error ? emailError.message : "Unknown email error",
          });
        });
      }

      return jsonResponse({
        status: "active",
        expires_at: primaryEntitlement.expires_at,
        purchase_type: order.purchase_type,
        purchase_label: order.purchase_label,
        unlocked_count: entitlements.length,
        subject_name: order.purchase_type === "single_module" ? primaryEntitlement.subject_name : null,
        subject_slug: order.purchase_type === "single_module" ? primaryEntitlement.subject_slug : null,
      });
    } catch (fulfillmentError) {
      await markModulePaymentFulfillmentFailed(reference, fulfillmentError);
      const emailDetails = await getPaymentEmailDetails(reference);
      if (emailDetails) {
        await sendPaymentAccessIssueEmail(emailDetails).catch((emailError) => {
          console.warn("Payment access issue email could not be sent", {
            reference,
            message: emailError instanceof Error ? emailError.message : "Unknown email error",
          });
        });
      }
      return jsonResponse({
        code: "PAYMENT_FULFILLMENT_FAILED",
        error: "Payment was received, but module access still needs attention. Please check again.",
      }, 409);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment verification failed";
    return jsonResponse({ error: message }, getRequestErrorStatus(error));
  }
});
