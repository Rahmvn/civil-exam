import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configPaths = [
  "supabase/config.toml",
  "supabase/compatibility/pre-migration/supabase/config.toml",
];

for (const configPath of configPaths) {
  test(`${configPath} disables gateway JWT verification for payment functions`, async () => {
    const config = await readFile(configPath, "utf8");

    for (const functionName of [
      "initialize-paystack-payment",
      "verify-paystack-payment",
      "paystack-webhook",
    ]) {
      const section = config.match(new RegExp(
        `\\[functions\\.${functionName}\\]([\\s\\S]*?)(?=\\n\\[|$)`,
      ));
      assert.ok(section, `Missing configuration for ${functionName}`);
      assert.match(section[1], /verify_jwt\s*=\s*false/);
    }
  });
}
