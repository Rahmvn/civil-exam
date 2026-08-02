import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = new URL("../../supabase/functions/admin-email-campaign/index.ts", import.meta.url);

test("campaign delivery revalidates recipients and claims one sender at a time", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /system_revalidate_email_campaign_recipients/);
  assert.match(source, /\.eq\("status", "tested"\)\s*\.select\("id"\)\s*\.maybeSingle\(\)/);
  assert.match(source, /This campaign is already being sent/);
});

test("campaign test sends are isolated from live recipient idempotency keys", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /campaign-test:\$\{campaign\.id\}:\$\{crypto\.randomUUID\(\)\}/);
  assert.match(source, /campaign:\$\{campaign\.id\}:\$\{recipient\.id\}/);
});

test("campaign provider failures return a diagnosable admin-only error code", async () => {
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /EMAIL_PROVIDER_ERROR/);
  assert.match(source, /email_campaign_test_failed/);
});
