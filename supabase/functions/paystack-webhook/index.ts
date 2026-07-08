import { corsHeaders, jsonResponse, requireEnv } from "../_shared/http.ts";
import { activateEntitlement } from "../_shared/paystack.ts";

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function isValidSignature(body: string, signature: string | null) {
  if (!signature) return false;

  const secret = requireEnv("PAYSTACK_SECRET_KEY");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));

  return bytesToHex(signed) === signature;
}

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

    try {
      console.log("Received Paystack webhook", { signature: !!signature });
    } catch (e) { }

    if (!(await isValidSignature(body, signature))) {
      try {
        console.warn("Invalid Paystack webhook signature");
      } catch (e) { }
      return jsonResponse({ error: "Invalid signature" }, 401);
    }

    const event = JSON.parse(body);

    if (event.event === "charge.success" && event.data?.status === "success") {
      await activateEntitlement(event.data.reference, event.data);
    }

    return jsonResponse({ received: true });
  } catch (error) {
    return jsonResponse({ error: error.message ?? "Webhook handling failed" }, 400);
  }
});
