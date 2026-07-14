import { corsHeaders, jsonResponse, requireEnv } from "../_shared/http.ts";
import {
  getActiveModuleAccess,
  getActivePack,
  getAdminClient,
  getAuthedUser,
  getModuleOffering,
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
    const adminClient = getAdminClient();
    const pack = await getActivePack(adminClient);
    const { subject_slug: subjectSlug } = await request.json();

    if (!subjectSlug || typeof subjectSlug !== "string") {
      return jsonResponse({ error: "Choose a module to unlock" }, 400);
    }

    const { offering, subject } = await getModuleOffering(adminClient, pack.id, subjectSlug);
    const existingAccess = await getActiveModuleAccess(
      adminClient,
      user.id,
      pack.id,
      subject.id,
    );

    if (existingAccess) {
      return jsonResponse({
        already_paid: true,
        expires_at: existingAccess.expires_at,
        subject_name: subject.name,
        subject_slug: subject.slug,
      });
    }

    const appUrl = Deno.env.get("APP_URL") ?? request.headers.get("origin") ?? "";
    const reference = `PS-${crypto.randomUUID()}`;
    const { data: order, error: orderError } = await adminClient
      .from("payment_orders")
      .insert({
        user_id: user.id,
        exam_pack_id: pack.id,
        subject_id: subject.id,
        module_offering_id: offering.id,
        provider_reference: reference,
        amount_kobo: offering.price_kobo,
        currency: offering.currency,
        status: "pending",
      })
      .select("id")
      .single();

    if (orderError || !order) {
      throw orderError ?? new Error("Unable to prepare this module payment");
    }

    const initBody = {
      email: user.email,
      amount: offering.price_kobo,
      currency: offering.currency,
      reference,
      callback_url: `${appUrl}/payment/verify`,
      metadata: {
        payment_order_id: order.id,
        user_id: user.id,
        exam_pack_id: pack.id,
        subject_id: subject.id,
        subject_slug: subject.slug,
      },
    };

    console.log("Initializing Paystack module payment", {
      userId: user.id,
      subjectId: subject.id,
      amount: offering.price_kobo,
    });

    const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireEnv("PAYSTACK_SECRET_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(initBody),
    });

    const payload = await paystackResponse.json();

    console.log("Paystack initialize response", {
      ok: paystackResponse.ok,
      status: paystackResponse.status,
      message: payload?.message ?? null,
    });

    if (!paystackResponse.ok || !payload.status) {
      await adminClient
        .from("payment_orders")
        .update({ status: "failed", provider_payload: payload })
        .eq("id", order.id);
      return jsonResponse(
        { error: payload.message ?? "Unable to initialize Paystack payment" },
        400,
      );
    }

    return jsonResponse({
      authorization_url: payload.data.authorization_url,
      access_code: payload.data.access_code,
      reference: payload.data.reference,
      subject_name: subject.name,
      subject_slug: subject.slug,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment initialization failed";
    return jsonResponse({ error: message }, 400);
  }
});
