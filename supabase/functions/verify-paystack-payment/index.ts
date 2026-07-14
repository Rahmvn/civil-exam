import { corsHeaders, jsonResponse, requireEnv } from "../_shared/http.ts";
import {
  activateEntitlement,
  activateModulePurchase,
  getAuthedUser,
  getModulePaymentOrder,
  validateLegacyPayment,
  validateModulePayment,
} from "../_shared/paystack.ts";

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

    const paystackResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
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

    if (!paystackResponse.ok || !payload.status || payload.data.status !== "success") {
      return jsonResponse({ error: "Payment has not been completed" }, 400);
    }

    const order = await getModulePaymentOrder(reference);
    const paidUserId = payload.data?.metadata?.user_id;

    if (paidUserId !== user.id) {
      return jsonResponse(
        { error: "This payment reference does not belong to your account" },
        403,
      );
    }

    if (order) {
      if (order.user_id !== user.id) {
        return jsonResponse(
          { error: "This payment reference does not belong to your account" },
          403,
        );
      }

      validateModulePayment(order, payload.data);
      const entitlement = await activateModulePurchase(reference, payload.data);

      return jsonResponse({
        status: "active",
        expires_at: entitlement.expires_at,
        subject_name: entitlement.subject_name,
        subject_slug: entitlement.subject_slug,
      });
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
