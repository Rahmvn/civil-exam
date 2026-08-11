import { getAdminClient } from "../_shared/paystack.ts";
import { verifyEngagementUnsubscribeToken } from "../_shared/email/unsubscribe-token.ts";

function page(title: string, message: string, formHtml = "", status = 200) {
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | PromotionSure</title></head>
<body style="margin:0;background:#f7f7f4;color:#10233d;font-family:Arial,sans-serif;">
<main style="max-width:520px;margin:12vh auto;padding:28px;background:#fff;border:1px solid #dce3e0;">
<strong style="color:#0d6546;">PromotionSure</strong><h1 style="font-size:24px;">${title}</h1><p style="line-height:1.6;">${message}</p>${formHtml}
</main></body></html>`, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

Deno.serve(async (request) => {
  if (!["GET", "POST"].includes(request.method)) return new Response("Method not allowed", { status: 405 });
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const verified = await verifyEngagementUnsubscribeToken(token);
  if (!verified) return page("Link unavailable", "This unsubscribe link is invalid.", "", 400);

  if (request.method === "GET") {
    const action = `${url.origin}${url.pathname}?token=${encodeURIComponent(token)}`;
    return page(
      "Unsubscribe from engagement emails?",
      "You will still receive essential account, access, payment, and support messages.",
      `<form method="post" action="${action}"><button type="submit" style="border:0;border-radius:6px;background:#0d6546;color:#fff;padding:12px 16px;font-weight:700;cursor:pointer;">Unsubscribe</button></form>`,
    );
  }

  const adminClient = getAdminClient();
  const { data, error } = await adminClient.rpc("system_unsubscribe_engagement_email", {
    requested_user_id: verified.userId,
    requested_source: "email_unsubscribe",
  });
  if (error) {
    console.error("Engagement unsubscribe failed", { message: error.message });
    return page("Try again", "We could not update your email preference. Please try again.", "", 500);
  }
  console.log("Engagement unsubscribe processed", { updated: Boolean(data?.updated) });
  return page("You are unsubscribed", "You will no longer receive PromotionSure engagement emails. You can re-enable them from your account.");
});
