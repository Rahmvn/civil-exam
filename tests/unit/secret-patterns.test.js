import assert from "node:assert/strict";
import test from "node:test";
import { scanTrackedContent } from "../../scripts/test/secretPatterns.mjs";

test("tracked-secret rules detect provider credentials and callback leakage", () => {
  const resendName = ["RESEND", "API", "KEY"].join("_");
  const googleName = ["GOOGLE", "CLIENT", "SECRET"].join("_");
  const resend = `${resendName}=${"re_" + "A".repeat(30)}`;
  const google = `${googleName}=${"GOCSPX-" + "B".repeat(24)}`;
  const callback = `callback=${"https://app.test/auth/callback?" + "code=" + "C".repeat(32)}`;

  assert.match(scanTrackedContent("src/config.js", resend).join("\n"), /Resend API key/);
  assert.match(scanTrackedContent(".env", google).join("\n"), /Google OAuth client secret/);
  assert.match(scanTrackedContent("debug.log", callback).join("\n"), /OAuth callback credential/);
});

test("tracked-secret rules permit redacted documentation and ordinary code", () => {
  const supabaseSecretName = ["SUPABASE", "SECRET", "KEY"].join("_");
  assert.deepEqual(scanTrackedContent("docs/spec.md", "?code=<redacted> authorization_code=\"example\""), []);
  assert.deepEqual(scanTrackedContent("src/example.js", "const code = createCode();"), []);
  assert.deepEqual(
    scanTrackedContent("scripts/runner.mjs", `process.env.${supabaseSecretName} = secretKey;`),
    [],
  );
  assert.deepEqual(scanTrackedContent(".env.example", "RESEND_API_KEY=your_resend_api_key"), []);
});
