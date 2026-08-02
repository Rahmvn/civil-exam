import {
  corsHeaders,
  getRequestErrorStatus,
  jsonResponse,
  readJsonBody,
  RequestBodyError,
} from "../_shared/http.ts";
import { getAdminClient, getAuthedUser } from "../_shared/paystack.ts";
import { sendWithResend } from "../_shared/transactional-email.ts";

const MAX_BODY_BYTES = 10_000;
const MAX_BATCH_SIZE = 25;

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeEmail(value: unknown) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    throw new RequestBodyError("Enter a valid test email address");
  }
  return email;
}

function firstName(name: unknown) {
  const clean = String(name ?? "").trim();
  if (!clean) return "there";
  return clean.split(/\s+/)[0] || "there";
}

function personalize(body: string, recipientName: unknown) {
  return body.replaceAll("{{first_name}}", firstName(recipientName));
}

function toHtml(text: string) {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("\n");
}

async function requireAdmin(adminClient: ReturnType<typeof getAdminClient>, userId: string) {
  const { data: profile, error } = await adminClient
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (profile?.role !== "admin") {
    throw new RequestBodyError("Admin access is required", 403);
  }
}

async function writeAudit(
  adminClient: ReturnType<typeof getAdminClient>,
  payload: Record<string, unknown>,
) {
  const { error } = await adminClient.from("admin_audit_logs").insert(payload);
  if (error) {
    console.warn("Email campaign audit write failed", { message: error.message });
  }
}

async function getCampaign(adminClient: ReturnType<typeof getAdminClient>, campaignId: string) {
  const { data, error } = await adminClient
    .from("email_campaigns")
    .select("id, campaign_type, segment, priority, subject, body_text, status, updated_at")
    .eq("id", campaignId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new RequestBodyError("Campaign not found", 404);
  return data;
}

async function sendTest({
  adminClient,
  adminUserId,
  campaignId,
  testEmail,
}: {
  adminClient: ReturnType<typeof getAdminClient>;
  adminUserId: string;
  campaignId: string;
  testEmail: string;
}) {
  const campaign = await getCampaign(adminClient, campaignId);
  if (!["draft", "tested"].includes(campaign.status)) {
    throw new RequestBodyError("Only draft campaigns can send a test email");
  }

  const text = personalize(campaign.body_text, "Candidate");
  let result: Awaited<ReturnType<typeof sendWithResend>>;

  try {
    result = await sendWithResend(
      testEmail,
      {
        subject: campaign.subject,
        text,
        html: toHtml(text),
      },
      `campaign-test:${campaign.id}:${crypto.randomUUID()}`,
    );

    if (result.skipped) {
      throw new Error(result.reason || "Email delivery is not configured");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Test email failed";
    await writeAudit(adminClient, {
      actor_id: adminUserId,
      action: "email_campaign_test_failed",
      entity_type: "email_campaign",
      entity_id: campaign.id,
      metadata: {
        recipient_email: testEmail,
        error_message: message.slice(0, 500),
      },
    });
    throw new RequestBodyError(message, 502);
  }

  const update = {
    status: "tested",
    test_recipient_email: testEmail,
    tested_at: new Date().toISOString(),
  };

  const { error: updateError } = await adminClient
    .from("email_campaigns")
    .update(update)
    .eq("id", campaign.id);

  if (updateError) throw updateError;

  await writeAudit(adminClient, {
    actor_id: adminUserId,
    action: "email_campaign_test_sent",
    entity_type: "email_campaign",
    entity_id: campaign.id,
    metadata: {
      recipient_email: testEmail,
      provider_message_id: result.providerMessageId ?? null,
    },
  });

  return { sent: true, skipped: false, reason: null };
}

async function updateRecipient(
  adminClient: ReturnType<typeof getAdminClient>,
  recipientId: string,
  updates: Record<string, unknown>,
) {
  const { error } = await adminClient
    .from("email_campaign_recipients")
    .update(updates)
    .eq("id", recipientId);
  if (error) throw error;
}

async function sendCampaign({
  adminClient,
  adminUserId,
  campaignId,
}: {
  adminClient: ReturnType<typeof getAdminClient>;
  adminUserId: string;
  campaignId: string;
}) {
  const campaign = await getCampaign(adminClient, campaignId);
  if (campaign.status !== "tested") {
    throw new RequestBodyError("Send a test email before sending this campaign");
  }

  const { data: claimedCampaign, error: startError } = await adminClient
    .from("email_campaigns")
    .update({ status: "sending" })
    .eq("id", campaign.id)
    .eq("status", "tested")
    .select("id")
    .maybeSingle();

  if (startError) throw startError;
  if (!claimedCampaign) {
    throw new RequestBodyError("This campaign is already being sent", 409);
  }

  try {
    const { error: retryError } = await adminClient
      .from("email_campaign_recipients")
      .update({ status: "pending", error_message: null })
      .eq("campaign_id", campaign.id)
      .eq("included", true)
      .eq("status", "failed");
    if (retryError) throw retryError;

    const { error: revalidateError } = await adminClient.rpc(
      "system_revalidate_email_campaign_recipients",
      { requested_campaign_id: campaign.id },
    );
    if (revalidateError) throw revalidateError;

    const { data: recipients, error: recipientsError } = await adminClient
      .from("email_campaign_recipients")
      .select("id, user_id, recipient_email, recipient_name, status")
      .eq("campaign_id", campaign.id)
      .eq("included", true)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(MAX_BATCH_SIZE);

    if (recipientsError) throw recipientsError;

    let sent = 0;
    let failed = 0;

    for (const recipient of recipients ?? []) {
      const attemptedAt = new Date().toISOString();
      const text = personalize(campaign.body_text, recipient.recipient_name);

      try {
        const result = await sendWithResend(
          recipient.recipient_email,
          {
            subject: campaign.subject,
            text,
            html: toHtml(text),
          },
          `campaign:${campaign.id}:${recipient.id}`,
        );

        if (result.skipped) {
          throw new Error(result.reason || "Email delivery is not configured");
        }

        sent += 1;
        await updateRecipient(adminClient, recipient.id, {
          status: "sent",
          provider: "resend",
          provider_message_id: result.providerMessageId,
          error_message: null,
          attempted_at: attemptedAt,
          sent_at: new Date().toISOString(),
        });
      } catch (error) {
        failed += 1;
        await updateRecipient(adminClient, recipient.id, {
          status: "failed",
          provider: "resend",
          error_message: (error instanceof Error ? error.message : "Email send failed").slice(0, 500),
          attempted_at: attemptedAt,
        });
      }
    }

    const [{ count: pendingCount, error: pendingError }, { count: failedCount, error: failedCountError }] =
      await Promise.all([
        adminClient
          .from("email_campaign_recipients")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaign.id)
          .eq("included", true)
          .eq("status", "pending"),
        adminClient
          .from("email_campaign_recipients")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaign.id)
          .eq("included", true)
          .eq("status", "failed"),
      ]);

    if (pendingError) throw pendingError;
    if (failedCountError) throw failedCountError;

    const pending = Number(pendingCount ?? 0);
    const totalFailed = Number(failedCount ?? 0);
    const nextStatus = pending > 0 || totalFailed > 0 ? "tested" : "sent";
    const { error: finishError } = await adminClient
      .from("email_campaigns")
      .update({
        status: nextStatus,
        sent_at: nextStatus === "sent" ? new Date().toISOString() : null,
      })
      .eq("id", campaign.id)
      .eq("status", "sending");

    if (finishError) throw finishError;

    await writeAudit(adminClient, {
      actor_id: adminUserId,
      action: "email_campaign_batch_sent",
      entity_type: "email_campaign",
      entity_id: campaign.id,
      metadata: { sent, failed, pending, total_failed: totalFailed },
    });

    return {
      sent,
      failed,
      skipped: 0,
      pending,
      total_failed: totalFailed,
      complete: nextStatus === "sent",
    };
  } catch (error) {
    await adminClient
      .from("email_campaigns")
      .update({ status: "tested" })
      .eq("id", campaign.id)
      .eq("status", "sending");
    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const user = await getAuthedUser(request);
    const adminClient = getAdminClient();
    await requireAdmin(adminClient, user.id);

    const body = await readJsonBody(request, MAX_BODY_BYTES) as Record<string, unknown>;
    const action = String(body.action ?? "").trim();
    const campaignId = String(body.campaign_id ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(campaignId)) {
      throw new RequestBodyError("Choose a valid campaign");
    }

    if (action === "send_test") {
      const testEmail = normalizeEmail(body.test_email);
      const result = await sendTest({ adminClient, adminUserId: user.id, campaignId, testEmail });
      return jsonResponse(result);
    }

    if (action === "send_campaign") {
      const result = await sendCampaign({ adminClient, adminUserId: user.id, campaignId });
      return jsonResponse(result);
    }

    throw new RequestBodyError("Choose a valid campaign action");
  } catch (error) {
    const message = error instanceof Error ? error.message : "The request could not be completed.";
    const status = ["Missing authorization header", "Invalid authorization header", "Invalid user session"].includes(message)
      ? 401
      : getRequestErrorStatus(error, 500);
    console.warn("Admin email campaign request failed", {
      message,
    });
    const code = status >= 500 ? "EMAIL_PROVIDER_ERROR" : "EMAIL_CAMPAIGN_ERROR";
    return jsonResponse({ error: message, code }, status);
  }
});
