import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = new URL("../../supabase/functions/_shared/transactional-email.ts", import.meta.url);

test("Resend sends use the database event key as a provider idempotency key", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /"Idempotency-Key": idempotencyKey/);
  assert.match(source, /const eventKey = `\$\{eventType\}:\$\{details\.provider_reference\}`;/);
  assert.match(
    source,
    /sendWithResend\(String\(details\.recipient_email\), message, eventKey\)/,
  );
});

test("transactional email remains optional when Resend is not configured", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /Deno\.env\.get\("RESEND_API_KEY"\)/);
  assert.match(source, /skipped: true, reason: "RESEND_API_KEY is not configured"/);
});

test("transactional email uses the verified PromotionSure sender and support reply address", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /PromotionSure <team@auth\.promotionsure\.com\.ng>/);
  assert.match(source, /reply_to: Deno\.env\.get\("TRANSACTIONAL_EMAIL_REPLY_TO"\) \|\| SUPPORT_EMAIL/);
});
