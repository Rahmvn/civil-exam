import {
  corsHeaders,
  getRequestErrorStatus,
  jsonResponse,
  readTextBody,
  requireEnv,
} from "../_shared/http.ts";
import {
  activateModulePurchase,
  applyPaystackPostPaymentEvent,
  getModulePaymentOrder,
  isFinalUnsuccessfulPaystackPayment,
  markModulePaymentFulfillmentFailed,
  recordModulePaymentStatus,
  validateModulePayment,
} from "../_shared/paystack.ts";
import {
  createPaystackEventKey,
  getPaystackEventReference,
  isPaystackPostPaymentEvent,
  isValidPaystackSignature,
  validatePaystackEnvironment,
} from "../_shared/payment-validation.js";
import {
  getPaymentEmailDetails,
  sendPaymentReviewEmail,
  sendPaymentSuccessEmail,
} from "../_shared/transactional-email.ts";

function getPaymentReviewEmailType(eventType: string, resolution = "") {
  if (["refund.pending", "refund.processing", "refund.needs-attention"].includes(eventType)) {
    return "refund_pending";
  }
  if (eventType === "refund.processed") return "refund_processed";
  if (eventType === "refund.failed") return "refund_failed";
  if (["charge.dispute.create", "charge.dispute.remind"].includes(eventType)) return "payment_disputed";
  if (eventType === "charge.dispute.resolve") return "payment_dispute_resolved";
  if (resolution) return "payment_dispute_resolved";
  return null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await readTextBody(request, 262_144);
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
      if (result?.event_applied && reference) {
        const reviewEmailType = getPaymentReviewEmailType(
          event.event,
          String(event?.data?.resolution ?? ""),
        );
        if (reviewEmailType) {
          const emailDetails = await getPaymentEmailDetails(reference);
          if (emailDetails) {
            await sendPaymentReviewEmail(emailDetails, reviewEmailType).catch((emailError) => {
              console.warn("Payment review email could not be sent", {
                event: event.event,
                reference,
                message: emailError instanceof Error ? emailError.message : "Unknown email error",
              });
            });
          }
        }
      }
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
          const emailDetails = await getPaymentEmailDetails(event.data.reference);
          if (emailDetails) {
            await sendPaymentSuccessEmail(emailDetails).catch((emailError) => {
              console.warn("Payment success email could not be sent", {
                reference: event.data.reference,
                message: emailError instanceof Error ? emailError.message : "Unknown email error",
              });
            });
          }
        } catch (fulfillmentError) {
          await markModulePaymentFulfillmentFailed(event.data.reference, fulfillmentError);
          throw fulfillmentError;
        }
      } else {
        // A signed provider event is not sufficient to grant access. Every
        // launch payment must also match an order created by this application.
        console.warn("Ignoring successful Paystack webhook without a local payment order", {
          reference: event.data.reference,
        });
      }
    }

    if (event.data?.reference && isFinalUnsuccessfulPaystackPayment(event)) {
      await recordModulePaymentStatus(event.data.reference, event);
    }

    return jsonResponse({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook handling failed";
    return jsonResponse({ error: message }, getRequestErrorStatus(error));
  }
});
