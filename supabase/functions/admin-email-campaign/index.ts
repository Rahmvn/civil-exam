import {
  corsHeaders,
  getRequestErrorStatus,
  jsonResponse,
  readJsonBody,
  RequestBodyError,
} from "../_shared/http.ts";
import { getAdminClient, getAuthedUser } from "../_shared/paystack.ts";
import { sendEmail } from "../_shared/email/provider.ts";
import { renderApplicationEmail } from "../_shared/email/render.ts";
import {
  createEngagementUnsubscribeToken,
  getUnsubscribeUrl,
} from "../_shared/email/unsubscribe-token.ts";
import { getEmailPreferencesUrl } from "../_shared/email/preferences-url.ts";

const MAX_BODY_BYTES = 2_000;

async function requireAdmin(adminClient: ReturnType<typeof getAdminClient>, userId: string) {
  const { data: profile, error } = await adminClient
    .from("profiles")
    .select("role, full_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if (profile?.role !== "admin") throw new RequestBodyError("Admin access is required", 403);
  return profile;
}

async function recordTest(
  adminClient: ReturnType<typeof getAdminClient>,
  values: {
    campaignId: string;
    adminId: string;
    fingerprint: string;
    testEmail: string;
    succeeded: boolean;
    providerMessageId?: string | null;
    errorMessage?: string | null;
  },
) {
  const { error } = await adminClient.rpc("system_record_e2_campaign_test", {
    requested_campaign_id: values.campaignId,
    requested_admin_id: values.adminId,
    requested_fingerprint: values.fingerprint,
    requested_succeeded: values.succeeded,
    requested_test_email: values.testEmail,
    requested_provider_message_id: values.providerMessageId ?? null,
    requested_error_message: values.errorMessage ?? null,
  });
  if (error) throw error;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
    const user = await getAuthedUser(request);
    const adminClient = getAdminClient();
    const profile = await requireAdmin(adminClient, user.id);
    const body = await readJsonBody(request, MAX_BODY_BYTES) as Record<string, unknown>;
    if (String(body.action ?? "") !== "send_test") {
      throw new RequestBodyError("Production campaign delivery must be queued through Email Core", 400);
    }
    const campaignId = String(body.campaign_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) throw new RequestBodyError("Choose a valid campaign");

    const { data: payload, error: payloadError } = await adminClient.rpc("system_get_e2_campaign_test_payload", {
      requested_campaign_id: campaignId,
      requested_admin_id: user.id,
    });
    if (payloadError) throw payloadError;

    const testEmail = String(payload.test_email);
    const fingerprint = String(payload.fingerprint);
    const unsubscribeUrl = payload.category === "engagement"
      ? getUnsubscribeUrl(await createEngagementUnsubscribeToken(user.id))
      : undefined;
    const message = renderApplicationEmail("admin_campaign", {
      ...payload,
      recipient_name: profile.full_name || "Candidate",
    }, { unsubscribeUrl: payload.category === "engagement" ? getEmailPreferencesUrl() : undefined });

    try {
      const result = await sendEmail({
        to: testEmail,
        subject: message.subject,
        html: message.html,
        text: message.text,
        idempotencyKey: `campaign-test:${campaignId}:${fingerprint}`,
        tags: [{ name: "category", value: String(payload.category) }, { name: "source", value: "campaign_test" }],
        listUnsubscribeUrl: unsubscribeUrl,
      });
      await recordTest(adminClient, {
        campaignId,
        adminId: user.id,
        fingerprint,
        testEmail,
        succeeded: true,
        providerMessageId: result.providerMessageId,
      });
      return jsonResponse({ sent: true, test_status: "passed" });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Test email failed";
      await recordTest(adminClient, {
        campaignId,
        adminId: user.id,
        fingerprint,
        testEmail,
        succeeded: false,
        errorMessage: messageText.slice(0, 500),
      });
      throw new RequestBodyError(messageText, 502);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "The request could not be completed.";
    const status = ["Missing authorization header", "Invalid authorization header", "Invalid user session"].includes(message)
      ? 401
      : getRequestErrorStatus(error, 500);
    console.warn("Admin email campaign request failed", { message });
    return jsonResponse({ error: message, code: status >= 500 ? "EMAIL_PROVIDER_ERROR" : "EMAIL_CAMPAIGN_ERROR" }, status);
  }
});
