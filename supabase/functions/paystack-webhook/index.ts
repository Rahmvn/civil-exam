import { corsHeaders, jsonResponse, requireEnv } from "../_shared/http.ts";
import {
  activateEntitlement,
  activateModulePurchase,
  applyPaystackPostPaymentEvent,
  getModulePaymentOrder,
  isFinalUnsuccessfulPaystackPayment,
  markModulePaymentFulfillmentFailed,
  recordModulePaymentStatus,
  validateLegacyPayment,
  validateModulePayment,
} from "../_shared/paystack.ts";
import {
  createPaystackEventKey,
  getPaystackEventReference,
  isPaystackPostPaymentEvent,
  isValidPaystackSignature,
  validatePaystackEnvironment,
} from "../_shared/payment-validation.js";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await request.text();
    const signature = request.headers.get("x-paystack-signature");

    console.log("Received Paystack webhook", { signature: Boolean(signature) });

    const paystackSecret = requireEnv("PAYSTACK_SECRET_KEY");
    if (!(await isValidPaystackSignature(body, signature, paystackSecret))) {
      console.warn("Invalid Paystack webhook signature");
      return jsonResponse({ error: "Invalid signature" }, 401);
    }

    const event = JSON.parse(body);
    const reference = getPaystackEventReference(event);
    if (reference) validatePaystackEnvironment(event, paystackSecret);

    if (isPaystackPostPaymentEvent(event.event)) {
      const result = await applyPaystackPostPaymentEvent(await createPaystackEventKey(body), event);
      console.log("Processed Paystack post-payment event", {
        event: event.event,
        matched: Boolean(result?.payment_order_id),
        applied: Boolean(result?.event_applied),
      });
      return jsonResponse({ received: true });
    }

    if (event.event === "charge.success" && event.data?.status === "success") {
      const order = await getModulePaymentOrder(event.data.reference);

      if (order) {
        await recordModulePaymentStatus(event.data.reference, event);
        try {
          validateModulePayment(order, event.data);
          await activateModulePurchase(event.data.reference, event.data);
        } catch (fulfillmentError) {
          await markModulePaymentFulfillmentFailed(event.data.reference, fulfillmentError);
          throw fulfillmentError;
        }
      } else {
        // Preserve in-flight transactions initialized before module payments.
        await validateLegacyPayment(event.data);
        await activateEntitlement(event.data.reference, event.data);
      }
    }

    if (event.data?.reference && isFinalUnsuccessfulPaystackPayment(event)) {
      await recordModulePaymentStatus(event.data.reference, event);
    }

    return jsonResponse({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook handling failed";
    return jsonResponse({ error: message }, 400);
  }
});
