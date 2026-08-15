import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderApplicationEmail } from "../../supabase/functions/_shared/email/render.ts";

const queuePath = new URL("../../supabase/functions/_shared/transactional-email.ts", import.meta.url);
const providerPath = new URL("../../supabase/functions/_shared/email/provider.ts", import.meta.url);

test("transactional producers enqueue one deterministic logical event", async () => {
  const source = await readFile(queuePath, "utf8");
  assert.match(source, /enqueue_transactional_email_event/);
  assert.match(source, /const eventKey = `\$\{eventType\}:\$\{sourceIdentity \|\| reference\}`/);
  assert.doesNotMatch(source, /sendEmail|fetch\(/);
});

test("Resend uses the event identity for provider idempotency and has a timeout", async () => {
  const source = await readFile(providerPath, "utf8");
  assert.match(source, /"Idempotency-Key": idempotencyKey/);
  assert.match(source, /AbortController/);
  assert.match(source, /EMAIL_PROVIDER_TIMEOUT_MS/);
  assert.match(source, /response\.status === 429 \|\| response\.status >= 500/);
  assert.match(source, /"List-Unsubscribe": `<\$\{listUnsubscribeUrl\}>`/);
  assert.match(source, /"List-Unsubscribe-Post": "List-Unsubscribe=One-Click"/);
  assert.doesNotMatch(source, /customHeaders|requested_headers/);
});

test("structured admin messages escape content and allow only approved merge fields", () => {
  const message = renderApplicationEmail("admin_campaign", {
    subject: "Hello {{first_name}}",
    preheader: "A safe update",
    body_text: "Hi {{first_name}},\n\n<script>alert('x')</script> & continue.",
    cta_label: "Open PromotionSure",
    cta_url: "https://promotionsure.com.ng/dashboard",
    recipient_name: "Ada Candidate",
  }, { unsubscribeUrl: "https://example.test/unsubscribe?token=signed" });
  assert.equal(message.subject, "Hello Ada");
  assert.match(message.html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt; &amp; continue/);
  assert.match(message.text, /Unsubscribe from engagement emails/);
  const progress = renderApplicationEmail("admin_campaign", {
    subject: "Progress in {{module_name}}",
    body_text: "{{achievement_summary}}",
    recipient_name: "Ada Candidate",
    module_name: "Public Financial Management",
    achievement_summary: "You reached a new personal best.",
  });
  assert.equal(progress.subject, "Progress in Public Financial Management");
  assert.match(progress.text, /new personal best/);
  assert.throws(() => renderApplicationEmail("admin_campaign", {
    subject: "Hello {{email}}",
    body_text: "Body",
  }), /Unsupported email merge field/);
  assert.throws(() => renderApplicationEmail("admin_campaign", {
    subject: "Hello",
    body_text: "Body",
    cta_label: "Unsafe",
    cta_url: "javascript:alert(1)",
  }), /must use HTTPS/);
});

test("campaign compatibility remains optional when Resend is not configured", async () => {
  const source = await readFile(providerPath, "utf8");
  assert.match(source, /skipped: true, reason: "RESEND_API_KEY is not configured"/);
  assert.match(source, /PromotionSure <team@auth\.promotionsure\.com\.ng>/);
  assert.match(source, /TRANSACTIONAL_EMAIL_REPLY_TO/);
});

test("application emails use the accessible PromotionSure brand lockup", () => {
  const message = renderApplicationEmail("payment_success", {
    provider_reference: "PS-BRAND",
    product_label: "Public Service Rules",
    amount_kobo: 150000,
    currency: "NGN",
  });
  assert.match(message.html, /src="https:\/\/promotionsure\.com\.ng\/logo\/promotionsure-lockup\.png"/);
  assert.match(message.html, /width="220" alt="PromotionSure"/);
  assert.match(message.html, /max-width:100%;height:auto/);
});

test("payment templates render canonical duration, amount, labels, dates, text, and escaped HTML", () => {
  const message = renderApplicationEmail("payment_success", {
    provider_reference: "PS-<unsafe>",
    product_label: "3-Module <Bundle>",
    duration_months: 3,
    amount_kobo: 650000,
    currency: "NGN",
    access_expires_at: "2028-01-01T00:00:00.000Z",
    access_result_kind: "latest",
    items: [
      { subject_name: "Pension" },
      { subject_name: "Oral: PSR, PFM & Pension" },
      { subject_name: "Health" },
    ],
  });
  assert.match(message.subject, /3-Module <Bundle>/);
  assert.match(message.text, /Duration: 3 months/);
  assert.match(message.text, /₦6,500/);
  assert.match(message.text, /Latest resulting access date: 1 Jan 2028/);
  assert.match(message.text, /Oral: PSR, PFM & Pension/);
  assert.match(message.html, /3-Module &lt;Bundle&gt;/);
  assert.match(message.html, /PS-&lt;unsafe&gt;/);
  assert.doesNotMatch(message.html, /PS-<unsafe>/);
});

test("review templates preserve conservative refund and dispute wording", () => {
  const details = { product_label: "Complete Module Bundle", amount_kobo: 450000, currency: "NGN", provider_reference: "PS-1" };
  assert.match(renderApplicationEmail("refund_processed", details).text, /access may end/);
  assert.match(renderApplicationEmail("payment_disputed", details).text, /access may be paused/);
  assert.match(renderApplicationEmail("payment_dispute_resolved", details).text, /final payment outcome/);
});
