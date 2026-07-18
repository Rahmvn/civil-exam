import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const confirmationPath = new URL("../../supabase/templates/confirmation.html", import.meta.url);
const recoveryPath = new URL("../../supabase/templates/recovery.html", import.meta.url);
const configPath = new URL("../../supabase/config.toml", import.meta.url);

test("local Auth config requires six-digit email confirmation", async () => {
  const config = await readFile(configPath, "utf8");
  assert.match(config, /enable_confirmations = true/);
  assert.match(config, /otp_length = 6/);
  assert.match(config, /auth\.email\.template\.confirmation/);
  assert.match(config, /auth\.email\.template\.recovery/);
  assert.doesNotMatch(config, /flowType|pkce/i);
});

test("signup and recovery templates are distinct OTP-only transactional emails", async () => {
  const [confirmation, recovery] = await Promise.all([
    readFile(confirmationPath, "utf8"),
    readFile(recoveryPath, "utf8"),
  ]);

  for (const template of [confirmation, recovery]) {
    assert.match(template, /{{ \.Token }}/);
    assert.doesNotMatch(template, /ConfirmationURL|tracking|<script/i);
    assert.equal(template.includes("\uFFFD"), false);
  }
  assert.notEqual(confirmation, recovery);
  assert.match(confirmation, /Verify your email/);
  assert.match(recovery, /Reset your password/);
});
