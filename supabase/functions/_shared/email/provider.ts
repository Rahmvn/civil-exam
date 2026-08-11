const DEFAULT_FROM = "PromotionSure <team@auth.promotionsure.com.ng>";
const DEFAULT_REPLY_TO = "promotionsureapp@gmail.com";

export class EmailProviderError extends Error {
  code: string;
  retryable: boolean;
  httpStatus: number | null;
  retryAfterSeconds: number | null;

  constructor(message: string, options: { code: string; retryable: boolean; httpStatus?: number | null; retryAfterSeconds?: number | null }) {
    super(message);
    this.name = "EmailProviderError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.httpStatus = options.httpStatus ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

function providerTimeoutMs() {
  const configured = Number(Deno.env.get("EMAIL_PROVIDER_TIMEOUT_MS") || 8_000);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(configured, 30_000)) : 8_000;
}

function parseRetryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.ceil(seconds), 21_600);
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.min(Math.ceil((date - Date.now()) / 1000), 21_600));
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
  idempotencyKey,
  tags = [],
  listUnsubscribeUrl,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  idempotencyKey: string;
  tags?: Array<{ name: string; value: string }>;
  listUnsubscribeUrl?: string;
}) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    throw new EmailProviderError("RESEND_API_KEY is not configured", { code: "provider_not_configured", retryable: true });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs());
  let response: Response;
  try {
    response = await fetch(Deno.env.get("RESEND_API_URL") || "https://api.resend.com/emails", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        from: Deno.env.get("TRANSACTIONAL_EMAIL_FROM") || DEFAULT_FROM,
        to: [to],
        reply_to: replyTo || Deno.env.get("TRANSACTIONAL_EMAIL_REPLY_TO") || DEFAULT_REPLY_TO,
        subject,
        text,
        html,
        tags,
        ...(listUnsubscribeUrl
          ? {
            headers: {
              "List-Unsubscribe": `<${listUnsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }
          : {}),
      }),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    throw new EmailProviderError(timedOut ? "Email provider request timed out" : "Email provider network request failed", {
      code: timedOut ? "provider_timeout" : "provider_network_error",
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new EmailProviderError(String(payload?.message || payload?.error || "Email provider rejected the request").slice(0, 500), {
      code: `provider_http_${response.status}`,
      retryable,
      httpStatus: response.status,
      retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
    });
  }
  if (!payload?.id) {
    throw new EmailProviderError("Email provider accepted the request without a message ID", {
      code: "provider_missing_message_id",
      retryable: true,
      httpStatus: response.status,
    });
  }
  return { provider: "resend", providerMessageId: String(payload.id), httpStatus: response.status };
}

export async function sendWithResend(
  to: string,
  message: { subject: string; text: string; html: string },
  idempotencyKey: string,
) {
  if (!Deno.env.get("RESEND_API_KEY")) return { skipped: true, reason: "RESEND_API_KEY is not configured" };
  const result = await sendEmail({ to, ...message, idempotencyKey });
  return { skipped: false, providerMessageId: result.providerMessageId };
}
