import { getAdminClient } from "../_shared/paystack.ts";
import { verifyEngagementUnsubscribeToken } from "../_shared/email/unsubscribe-token.ts";

const ACCOUNT_EMAIL_PREFERENCES_URL = "https://promotionsure.com.ng/profile#email-preferences";

Deno.serve(async (request) => {
  if (!["GET", "POST"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
  const url = new URL(request.url);
  let token = url.searchParams.get("token") || "";
  if (request.method === "POST" && !token) {
    const body = await request.json().catch(() => null);
    token = typeof body?.token === "string" ? body.token : "";
  }
  if (request.method === "GET") {
    return Response.redirect(ACCOUNT_EMAIL_PREFERENCES_URL, 302);
  }

  const verified = await verifyEngagementUnsubscribeToken(token);
  if (!verified) return Response.json({ error: "This unsubscribe link is invalid." }, { status: 400 });

  const adminClient = getAdminClient();
  const { data, error } = await adminClient.rpc("system_unsubscribe_engagement_email", {
    requested_user_id: verified.userId,
    requested_source: "email_unsubscribe",
  });
  if (error) {
    console.error("Engagement unsubscribe failed", { message: error.message });
    return Response.json({ error: "We could not update your email preference. Please try again." }, { status: 500 });
  }
  console.log("Engagement unsubscribe processed", { updated: Boolean(data?.updated) });
  return Response.json({ unsubscribed: true });
});
