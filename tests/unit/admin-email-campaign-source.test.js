import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminFunctionPath = new URL("../../supabase/functions/admin-email-campaign/index.ts", import.meta.url);
const dispatcherPath = new URL("../../supabase/functions/process-email-dispatch/index.ts", import.meta.url);
const unsubscribePath = new URL("../../supabase/functions/email-unsubscribe/index.ts", import.meta.url);
const tokenPath = new URL("../../supabase/functions/_shared/email/unsubscribe-token.ts", import.meta.url);

test("admin campaign function is an admin-only bounded test sender, not a production campaign engine", async () => {
  const source = await readFile(adminFunctionPath, "utf8");
  assert.match(source, /requireAdmin/);
  assert.match(source, /system_get_e2_campaign_test_payload/);
  assert.match(source, /system_record_e2_campaign_test/);
  assert.match(source, /campaign-test:\$\{campaignId\}:\$\{fingerprint\}/);
  assert.match(source, /Production campaign delivery must be queued through Email Core/);
  assert.doesNotMatch(source, /email_campaign_recipients"\)\s*\.select/);
  assert.doesNotMatch(source, /action === "send_campaign"/);
});

test("campaign dispatch revalidates eligibility and uses approved unsubscribe headers only for engagement", async () => {
  const source = await readFile(dispatcherPath, "utf8");
  assert.match(source, /system_validate_e2_campaign_event/);
  assert.match(source, /system_defer_paused_e2_campaign_event/);
  assert.match(source, /system_mark_e2_campaign_recipient_skipped/);
  assert.match(source, /summary\.skipped \+= 1/);
  assert.match(source, /summary\.deferred \+= 1/);
  assert.match(source, /job\.category === "engagement"/);
  assert.match(source, /createEngagementUnsubscribeToken/);
  assert.match(source, /listUnsubscribeUrl: unsubscribeUrl/);
  assert.ok(source.indexOf("const message = renderApplicationEmail") < source.indexOf("system_validate_e2_campaign_event"));
  assert.ok(source.indexOf("system_validate_e2_campaign_event") < source.indexOf("const result = await sendEmail"));
});

test("unsubscribe endpoint verifies a dedicated HMAC token before the narrow preference RPC", async () => {
  const [endpoint, token] = await Promise.all([
    readFile(unsubscribePath, "utf8"),
    readFile(tokenPath, "utf8"),
  ]);
  assert.match(endpoint, /verifyEngagementUnsubscribeToken\(token\)/);
  assert.match(endpoint, /system_unsubscribe_engagement_email/);
  assert.match(endpoint, /request\.method === "GET"/);
  assert.match(token, /EMAIL_UNSUBSCRIBE_SECRET/);
  assert.match(token, /crypto\.subtle\.verify/);
  assert.match(token, /scope: "engagement"/);
  assert.match(token, /JSON\.stringify\(\{ v: 1, sub: userId, scope: "engagement" \}\)/);
  assert.doesNotMatch(token, /\bexp\b|expiresAt|Date\.now/);
  assert.doesNotMatch(token, /recipient_email|profile|payment/);
});
