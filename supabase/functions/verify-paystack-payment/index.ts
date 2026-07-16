import { corsHeaders, jsonResponse, requireEnv } from "../_shared/http.ts";
import {
  activateEntitlement,
  activateModulePurchase,
  getPaystackTransactionMessage,
  getPaystackTransactionStatus,
  getAuthedUser,
  getModulePaymentOrder,
  markModulePaymentFulfillmentFailed,
  recordModulePaymentStatus,
  validateLegacyPayment,
  validateModulePayment,
} from "../_shared/paystack.ts";
import { getPaymentUserId } from "../_shared/payment-validation.js";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const user = await getAuthedUser(request);

    const { reference } = await request.json();

    if (!reference) {
      return jsonResponse({ error: "Payment reference is required" }, 400);
    }

    console.log("Verifying Paystack payment", { reference });

    const paystackApiUrl = Deno.env.get("PAYSTACK_API_URL") ?? "https://api.paystack.co";
    const paystackResponse = await fetch(
      `${paystackApiUrl}/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${requireEnv("PAYSTACK_SECRET_KEY")}`,
        },
      },
    );
    const payload = await paystackResponse.json();

    console.log("Paystack verify response", {
      ok: paystackResponse.ok,
      status: paystackResponse.status,
      dataStatus: payload?.data?.status ?? null,
    });

    const order = await getModulePaymentOrder(reference);

    const providerStatus = getPaystackTransactionStatus(payload);

    if (!paystackResponse.ok || !payload.status || providerStatus !== "success") {
      if (order) {
        if (order.user_id !== user.id) {
          return jsonResponse(
            { error: "This payment reference does not belong to your account" },
            403,
          );
        }

        if (providerStatus) await recordModulePaymentStatus(reference, payload);
      }

      const providerMessage = getPaystackTransactionMessage(payload);
      const errorMessage = ["declined", "failed"].includes(providerStatus)
        ? "Payment was declined"
        : ["abandoned", "cancelled", "canceled", "timeout"].includes(providerStatus)
          ? "Payment was not completed"
          : providerMessage || "Payment has not been completed";

      return jsonResponse({ error: errorMessage }, 400);
    }

    if (order) {
      if (order.user_id !== user.id) {
        return jsonResponse(
          { error: "This payment reference does not belong to your account" },
          403,
        );
      }

      await recordModulePaymentStatus(reference, payload);

      try {
        const paidUserId = getPaymentUserId(payload.data);
        if (paidUserId !== user.id) {
          throw new Error("Payment metadata does not match the payment order");
        }
        validateModulePayment(order, payload.data);
        const entitlement = await activateModulePurchase(reference, payload.data);

        return jsonResponse({
          status: "active",
          expires_at: entitlement.expires_at,
          subject_name: entitlement.subject_name,
          subject_slug: entitlement.subject_slug,
        });
      } catch (fulfillmentError) {
        await markModulePaymentFulfillmentFailed(reference, fulfillmentError);
        return jsonResponse({
          code: "PAYMENT_FULFILLMENT_FAILED",
          error: "Payment was received, but module access still needs attention. Please check again.",
        }, 409);
      }
    }

    const paidUserId = getPaymentUserId(payload.data);
    if (paidUserId !== user.id) {
      return jsonResponse(
        { error: "This payment reference does not belong to your account" },
        403,
      );
    }

    // Preserve verification for transactions initialized immediately before
    // the module-specific payment release.
    await validateLegacyPayment(payload.data);
    const entitlement = await activateEntitlement(reference, payload.data);

    return jsonResponse({
      status: "active",
      expires_at: entitlement.expires_at,
      legacy_full_access: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment verification failed";
    return jsonResponse({ error: message }, 400);
  }
});
