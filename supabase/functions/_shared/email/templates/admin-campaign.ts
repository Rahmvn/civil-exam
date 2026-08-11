import { escapeHtml } from "../layout.ts";

const MERGE_FIELD_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

function stringField(payload: Record<string, unknown>, key: string, limit: number) {
  return String(payload[key] ?? "").trim().slice(0, limit);
}

function firstName(value: unknown) {
  return String(value ?? "").trim().split(/\s+/)[0] || "there";
}

function personalize(value: string, payload: Record<string, unknown>) {
  return value.replace(MERGE_FIELD_PATTERN, (_match, field: string) => {
    if (field !== "first_name") throw new Error(`Unsupported email merge field: ${field}`);
    return firstName(payload.recipient_name);
  });
}

function safeHttpsUrl(value: string) {
  if (!value) return "";
  const parsed = new URL(value);
  const localHttp = parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) throw new Error("Email CTA must use HTTPS");
  return parsed.toString();
}

function paragraphs(value: string) {
  return value
    .split(/\n{2,}/)
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 16px;">${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
}

export function adminCampaignTemplate(
  payload: Record<string, unknown>,
  options: { unsubscribeUrl?: string } = {},
) {
  const subject = personalize(stringField(payload, "subject", 160), payload);
  const preheader = personalize(stringField(payload, "preheader", 200), payload);
  const bodyText = personalize(stringField(payload, "body_text", 5_000), payload);
  const ctaLabel = personalize(stringField(payload, "cta_label", 80), payload);
  const ctaUrl = safeHttpsUrl(stringField(payload, "cta_url", 2_048));
  if (!subject || !bodyText) throw new Error("Admin campaign subject and body are required");
  if (Boolean(ctaLabel) !== Boolean(ctaUrl)) throw new Error("Email CTA label and URL must be provided together");

  const ctaHtml = ctaUrl
    ? `<p style="margin:24px 0 8px;"><a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#0d6546;color:#ffffff;text-decoration:none;padding:11px 16px;border-radius:6px;font-weight:700;">${escapeHtml(ctaLabel)}</a></p>`
    : "";
  const unsubscribeUrl = options.unsubscribeUrl ? safeHttpsUrl(options.unsubscribeUrl) : "";
  const footerHtml = unsubscribeUrl
    ? `You can <a href="${escapeHtml(unsubscribeUrl)}" style="color:#53645f;">unsubscribe from engagement emails</a> at any time.`
    : undefined;
  const text = `${bodyText}${ctaUrl ? `\n\n${ctaLabel}: ${ctaUrl}` : ""}${unsubscribeUrl ? `\n\nUnsubscribe from engagement emails: ${unsubscribeUrl}` : ""}`;

  return { subject, preheader, text, bodyHtml: `${paragraphs(bodyText)}${ctaHtml}`, footerHtml };
}
