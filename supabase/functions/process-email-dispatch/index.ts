import { jsonResponse } from "../_shared/http.ts";
import { getAdminClient } from "../_shared/paystack.ts";
import { EmailProviderError, sendEmail } from "../_shared/email/provider.ts";
import { renderApplicationEmail } from "../_shared/email/render.ts";
import {
  createEngagementUnsubscribeToken,
  getUnsubscribeUrl,
} from "../_shared/email/unsubscribe-token.ts";
import { getEmailPreferencesUrl } from "../_shared/email/preferences-url.ts";

const BACKOFF_SECONDS = [60, 300, 900, 3_600, 21_600];

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function requireWorker(request: Request) {
  const secret = Deno.env.get("EMAIL_DISPATCH_SECRET");
  const authorization = request.headers.get("authorization") || "";
  if (!secret) throw new Error("Unauthorized email dispatcher request");

  const [providedDigest, expectedDigest] = await Promise.all([
    digest(authorization),
    digest(`Bearer ${secret}`),
  ]);
  let difference = 0;
  for (let index = 0; index < expectedDigest.length; index += 1) {
    difference |= providedDigest[index] ^ expectedDigest[index];
  }
  if (difference !== 0) {
    throw new Error("Unauthorized email dispatcher request");
  }
}

function batchSize() {
  const value = Number(Deno.env.get("EMAIL_DISPATCH_BATCH_SIZE") || 20);
  return Number.isInteger(value) ? Math.max(1, Math.min(value, 50)) : 20;
}

function retryDelay(attemptNumber: number, providerDelay: number | null) {
  const configured = BACKOFF_SECONDS[Math.min(Math.max(attemptNumber - 1, 0), BACKOFF_SECONDS.length - 1)];
  return Math.max(configured, Math.min(providerDelay ?? 0, 21_600));
}

function isEmail(value: unknown) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value ?? "")) && String(value).length <= 254;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    await requireWorker(request);
  } catch {
    console.warn("Invalid email dispatcher request rejected");
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const adminClient = getAdminClient();
  let lifecycleEvaluation = null;
  try {
    const { data, error } = await adminClient.rpc("evaluate_email_lifecycle_automations", {
      requested_batch_size: batchSize(),
    });
    if (error) throw error;
    lifecycleEvaluation = data;
    if (data?.error) {
      console.error("Email lifecycle evaluation failed", { message: data.error });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lifecycle evaluation failed";
    console.error("Email lifecycle evaluation failed", { message });
  }
  const leaseToken = crypto.randomUUID();
  const { data: jobs, error: claimError } = await adminClient.rpc("claim_transactional_email_events", {
    requested_lease_token: leaseToken,
    requested_batch_size: batchSize(),
    requested_lease_seconds: 120,
  });
  if (claimError) {
    console.error("Email dispatch claim failed", { message: claimError.message });
    return jsonResponse({ error: "Email dispatch claim failed" }, 500);
  }

  console.log("Email dispatch batch claimed", { leaseToken, count: jobs?.length ?? 0 });
  const summary = {
    lifecycle: lifecycleEvaluation,
    claimed: jobs?.length ?? 0,
    accepted: 0,
    retrying: 0,
    dead: 0,
    suppressed: 0,
    skipped: 0,
    deferred: 0,
  };

  for (const job of jobs ?? []) {
    const startedAt = new Date().toISOString();
    const attemptNumber = Number(job.attempt_count ?? 0) + 1;
    let recipient = "";

    const complete = async (values: Record<string, unknown>) => {
      const { data, error } = await adminClient.rpc("complete_transactional_email_attempt", {
        requested_event_id: job.id,
        requested_lease_token: leaseToken,
        requested_recipient_email: recipient,
        requested_started_at: startedAt,
        requested_provider_message_id: null,
        requested_provider_http_status: null,
        requested_retryable: false,
        requested_retry_after_seconds: null,
        requested_next_attempt_at: null,
        requested_error_code: null,
        requested_error_message: null,
        ...values,
      });
      if (error) throw error;
      return data;
    };

    try {
      const { data: authData, error: authError } = await adminClient.auth.admin.getUserById(job.user_id);
      if (authError) throw new EmailProviderError("Current recipient could not be resolved", { code: "recipient_lookup_failed", retryable: true });
      recipient = String(authData.user?.email ?? "").trim().toLowerCase();
      if (!isEmail(recipient)) {
        throw new EmailProviderError("The account has no valid current email address", { code: "recipient_invalid", retryable: false });
      }

      const { data: suppression, error: suppressionError } = await adminClient
        .from("email_suppressions")
        .select("reason")
        .eq("email", recipient)
        .eq("active", true)
        .maybeSingle();
      if (suppressionError) throw suppressionError;
      if (suppression) {
        await complete({
          requested_outcome: "suppressed",
          requested_error_code: `suppressed_${suppression.reason}`,
          requested_error_message: "Recipient is locally suppressed",
        });
        summary.suppressed += 1;
        console.warn("Email dispatch suppressed", { eventId: job.id, reason: suppression.reason });
        continue;
      }

      const unsubscribeUrl = job.category === "engagement"
        ? getUnsubscribeUrl(await createEngagementUnsubscribeToken(job.user_id))
        : undefined;
      const message = renderApplicationEmail(job.template_key, job.payload ?? {}, {
        unsubscribeUrl: job.category === "engagement" ? getEmailPreferencesUrl() : undefined,
      });

      if (job.campaign_id) {
        const { data: validation, error: validationError } = await adminClient.rpc("system_validate_e2_campaign_event", {
          requested_event_id: job.id,
        });
        if (validationError) throw validationError;
        if (!validation?.allowed) {
          const reason = String(validation?.reason || "no_longer_eligible");
          if (validation?.disposition === "defer") {
            const { data: release, error: releaseError } = await adminClient.rpc("system_defer_paused_e2_campaign_event", {
              requested_event_id: job.id,
              requested_lease_token: leaseToken,
            });
            if (releaseError) throw releaseError;
            if (release?.disposition === "cancelled") summary.skipped += 1;
            else summary.deferred += 1;
            console.warn("Campaign dispatch deferred", { eventId: job.id, reason, disposition: release?.disposition });
            continue;
          }
          await complete({
            requested_outcome: "cancelled",
            requested_error_code: reason,
            requested_error_message: reason === "campaign_cancelled"
              ? "Campaign cancelled before provider dispatch"
              : "Recipient was no longer eligible at dispatch time",
          });
          const { error: skippedError } = await adminClient.rpc("system_mark_e2_campaign_recipient_skipped", {
            requested_event_id: job.id,
            requested_reason: reason,
          });
          if (skippedError) console.error("Campaign recipient skip annotation failed", { eventId: job.id, message: skippedError.message });
          summary.skipped += 1;
          console.warn("Campaign recipient skipped", { eventId: job.id, reason });
          continue;
        }
      }

      if (job.lifecycle_instance_id) {
        const { data: validation, error: validationError } = await adminClient.rpc("system_validate_e3_lifecycle_event", {
          requested_event_id: job.id,
        });
        if (validationError) throw validationError;
        if (!validation?.allowed) {
          const reason = String(validation?.reason || "no_longer_eligible");
          if (validation?.disposition === "defer") {
            const { error: deferError } = await adminClient.rpc("system_defer_e3_lifecycle_event", {
              requested_event_id: job.id,
              requested_lease_token: leaseToken,
              requested_next_attempt_at: validation?.next_eligible_at || null,
              requested_reason: reason,
            });
            if (deferError) throw deferError;
            summary.deferred += 1;
            console.warn("Lifecycle dispatch deferred", { eventId: job.id, reason });
            continue;
          }
          await complete({
            requested_outcome: "cancelled",
            requested_error_code: reason,
            requested_error_message: "Lifecycle recipient was no longer eligible at dispatch time",
          });
          const { error: skippedError } = await adminClient.rpc("system_mark_e3_lifecycle_event_skipped", {
            requested_event_id: job.id,
            requested_reason: reason,
          });
          if (skippedError) {
            console.error("Lifecycle skip annotation failed", { eventId: job.id, message: skippedError.message });
          }
          summary.skipped += 1;
          console.warn("Lifecycle recipient skipped", { eventId: job.id, reason });
          continue;
        }
      }

      const result = await sendEmail({
        to: recipient,
        subject: message.subject,
        html: message.html,
        text: message.text,
        idempotencyKey: job.event_key,
        tags: [
          { name: "category", value: job.category },
          { name: "template", value: job.template_key },
          ...(job.campaign_id ? [{ name: "source", value: "campaign" }] : []),
          ...(job.lifecycle_instance_id ? [{ name: "source", value: "lifecycle" }] : []),
        ],
        listUnsubscribeUrl: unsubscribeUrl,
      });
      await complete({
        requested_outcome: "accepted",
        requested_provider_message_id: result.providerMessageId,
        requested_provider_http_status: result.httpStatus,
      });
      summary.accepted += 1;
      console.log("Email dispatch accepted", { eventId: job.id, providerMessageId: result.providerMessageId });
    } catch (error) {
      const providerError = error instanceof EmailProviderError
        ? error
        : new EmailProviderError("Email dispatch failed", { code: "dispatch_error", retryable: true });
      const canRetry = providerError.retryable && attemptNumber < Number(job.max_attempts ?? 6);
      const delay = canRetry ? retryDelay(attemptNumber, providerError.retryAfterSeconds) : null;
      await complete({
        requested_outcome: canRetry ? "retry_scheduled" : "permanent_failure",
        requested_provider_http_status: providerError.httpStatus,
        requested_retryable: providerError.retryable,
        requested_retry_after_seconds: providerError.retryAfterSeconds,
        requested_next_attempt_at: delay ? new Date(Date.now() + delay * 1000).toISOString() : null,
        requested_error_code: providerError.code,
        requested_error_message: providerError.message,
      });
      if (canRetry) {
        summary.retrying += 1;
        console.warn("Email retry scheduled", { eventId: job.id, attemptNumber, delay, code: providerError.code });
      } else {
        summary.dead += 1;
        console.error("Email dispatch dead", { eventId: job.id, attemptNumber, code: providerError.code });
      }
    }
  }

  return jsonResponse(summary);
});
