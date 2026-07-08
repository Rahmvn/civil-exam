import { corsHeaders, jsonResponse, requireEnv } from "../_shared/http.ts";
import { activateEntitlement, getAuthedUser } from "../_shared/paystack.ts";

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

    try {
      console.log("Verifying Paystack payment", { reference });
    } catch (e) { }

    const paystackResponse = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${requireEnv("PAYSTACK_SECRET_KEY")}`,
        },
      },
    );
    const payload = await paystackResponse.json();

    try {
      console.log("Paystack verify response", { ok: paystackResponse.ok, status: paystackResponse.status, dataStatus: payload?.data?.status ?? null });
    } catch (e) { }

    if (!paystackResponse.ok || !payload.status || payload.data.status !== "success") {
      return jsonResponse({ error: "Payment has not been completed" }, 400);
    }

    // The payment's metadata.user_id (set at initialization) must match the
    // caller, so a user cannot activate an entitlement from someone else's
    // transaction reference.
    const paidUserId = payload.data?.metadata?.user_id;

    if (paidUserId !== user.id) {
      return jsonResponse(
        { error: "This payment reference does not belong to your account" },
        403,
      );
    }

    const entitlement = await activateEntitlement(reference, payload.data);

    return jsonResponse({
      status: "active",
      expires_at: entitlement.expires_at,
    });
  } catch (error) {
    return jsonResponse({ error: error.message ?? "Payment verification failed" }, 400);
  }
});
