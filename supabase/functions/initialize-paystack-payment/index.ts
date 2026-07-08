import { corsHeaders, jsonResponse, requireEnv } from "../_shared/http.ts";
import { getActivePack, getAdminClient, getAuthedUser } from "../_shared/paystack.ts";

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
    const pack = await getActivePack(adminClient);

    const { data: existingEntitlement } = await adminClient
      .from("entitlements")
      .select("id, expires_at")
      .eq("user_id", user.id)
      .eq("exam_pack_id", pack.id)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (existingEntitlement) {
      return jsonResponse({
        already_paid: true,
        expires_at: existingEntitlement.expires_at,
      });
    }

    const appUrl = Deno.env.get("APP_URL") ?? request.headers.get("origin") ?? "";
    const initBody = {
      email: user.email,
      amount: pack.price_kobo,
      currency: pack.currency,
      callback_url: `${appUrl}/payment/verify`,
      metadata: {
        user_id: user.id,
        exam_pack_id: pack.id,
        pack_slug: pack.slug,
      },
    };

    try {
      console.log("Initializing Paystack payment", { email: user.email, amount: pack.price_kobo });
    } catch (e) { }

    const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("PAYSTACK_SECRET_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(initBody),
    });

    const payload = await paystackResponse.json();

    try {
      console.log("Paystack initialize response", { ok: paystackResponse.ok, status: paystackResponse.status, message: payload?.message ?? null });
    } catch (e) { }

    if (!paystackResponse.ok || !payload.status) {
      return jsonResponse(
        { error: payload.message ?? "Unable to initialize Paystack payment" },
        400,
      );
    }

    return jsonResponse({
      authorization_url: payload.data.authorization_url,
      access_code: payload.data.access_code,
      reference: payload.data.reference,
    });
  } catch (error) {
    return jsonResponse({ error: error.message ?? "Payment initialization failed" }, 400);
  }
});
