import { corsHeaders, jsonResponse, requireEnv } from "../_shared/http.ts";
import { getPaymentCallbackUrl } from "../_shared/payment-callback.js";
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

    async function recoverCheckout() {
      const { data: existingOrder, error } = await adminClient
        .from("payment_orders")
        .select("provider_reference, provider_status, provider_payload")
        .eq("user_id", user.id)
        .eq("exam_pack_id", pack.id)
        .eq("subject_id", subject.id)
        .eq("status", "pending")
        .in("provider_status", ["initializing", "initialized"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      const checkout = existingOrder?.provider_payload?.data;
      if (
        existingOrder?.provider_status === "initialized" &&
        checkout?.authorization_url &&
        checkout?.access_code
      ) {
        return {
          authorization_url: checkout.authorization_url,
          access_code: checkout.access_code,
          reference: checkout.reference ?? existingOrder.provider_reference,
          subject_name: subject.name,
          subject_slug: subject.slug,
          resumed: true,
        };
      }

      return existingOrder ? { preparing: true } : null;
    }

    const existingCheckout = await recoverCheckout();
    if (existingCheckout && !("preparing" in existingCheckout)) {
      return jsonResponse(existingCheckout);
    }
    if (existingCheckout && "preparing" in existingCheckout) {
      return jsonResponse({ error: "Payment setup is already in progress. Please try again in a moment." }, 409);
    }

    const callbackUrl = getPaymentCallbackUrl(Deno.env.get("APP_URL"));
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
        provider_status: "initializing",
        provider_checked_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (orderError?.code === "23505") {
      const concurrentCheckout = await recoverCheckout();
      if (concurrentCheckout && !("preparing" in concurrentCheckout)) {
        return jsonResponse(concurrentCheckout);
      }
      return jsonResponse({ error: "Payment setup is already in progress. Please try again in a moment." }, 409);
    }

    if (orderError || !order) {
      throw orderError ?? new Error("Unable to prepare this module payment");
    }

    const initBody = {
      email: user.email,
      amount: offering.price_kobo,
      currency: offering.currency,
      reference,
      callback_url: callbackUrl,
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

    const paystackApiUrl = Deno.env.get("PAYSTACK_API_URL") ?? "https://api.paystack.co";
    const paystackResponse = await fetch(`${paystackApiUrl}/transaction/initialize`, {
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
        .update({
          status: "failed",
          provider_status: "failed",
          provider_message: payload?.message ?? "Payment initialization failed",
          provider_payload: payload,
          provider_checked_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      return jsonResponse(
        { error: payload.message ?? "Unable to initialize Paystack payment" },
        400,
      );
    }

    const { error: checkoutSaveError } = await adminClient
      .from("payment_orders")
      .update({
        provider_status: "initialized",
        provider_message: payload?.message ?? null,
        provider_payload: payload,
        provider_checked_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    if (checkoutSaveError) throw checkoutSaveError;

    return jsonResponse({
      authorization_url: payload.data.authorization_url,
      access_code: payload.data.access_code,
      reference: payload.data.reference,
      subject_name: subject.name,
      subject_slug: subject.slug,
      resumed: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment initialization failed";
    const status = message.startsWith("Payment callback configuration error:") ? 500 : 400;
    return jsonResponse({ error: message }, status);
  }
});
