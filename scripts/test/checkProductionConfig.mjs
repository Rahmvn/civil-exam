import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

async function read(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

const packageJson = JSON.parse(await read("package.json"));
const nodeEngine = packageJson.engines?.node?.trim() ?? "";
const minimumNodeMajor = Number(
  nodeEngine.match(/^(?:>=\s*|\^|~)?(\d+)(?:\.|$)/)?.[1],
);
assert.ok(
  Number.isInteger(minimumNodeMajor) && minimumNodeMajor >= 22,
  "package.json must require Node 22 or later",
);

const vercelConfig = JSON.parse(await read("vercel.json"));
assert.equal(
  vercelConfig.$schema,
  "https://openapi.vercel.sh/vercel.json",
  "vercel.json should use Vercel's schema",
);

const globalHeaders = vercelConfig.headers?.find((entry) => entry.source === "/(.*)")?.headers ?? [];
const headerMap = new Map(globalHeaders.map(({ key, value }) => [key.toLowerCase(), value]));
for (const headerName of [
  "content-security-policy",
  "referrer-policy",
  "permissions-policy",
  "x-content-type-options",
  "x-frame-options",
  "strict-transport-security",
  "cross-origin-opener-policy",
]) {
  assert.ok(headerMap.has(headerName), `vercel.json is missing ${headerName}`);
}

const csp = headerMap.get("content-security-policy");
for (const directive of [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "https://*.supabase.co",
  "wss://*.supabase.co",
  "script-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
]) {
  assert.ok(csp.includes(directive), `Content-Security-Policy is missing: ${directive}`);
}

const envExample = await read(".env.example");
for (const variableName of [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "VITE_APP_VERSION",
  "VITE_WHATSAPP_SUPPORT_ENABLED",
  "VITE_WHATSAPP_SUPPORT_NUMBER",
  "VITE_TURNSTILE_ENABLED",
  "VITE_TURNSTILE_SITE_KEY",
  "APP_URL",
  "PAYSTACK_SECRET_KEY",
]) {
  assert.match(envExample, new RegExp(`^${variableName}=`, "m"), `.env.example is missing ${variableName}`);
}

const publicVariables = [...envExample.matchAll(/^([A-Z0-9_]+)=/gm)]
  .map((match) => match[1])
  .filter((name) => name.startsWith("VITE_"));
for (const name of publicVariables) {
  assert.doesNotMatch(
    name,
    /(SECRET|SERVICE_ROLE|PASSWORD|PRIVATE)/,
    `${name} would expose a secret in the browser bundle`,
  );
}

const supabaseConfig = await read("supabase/config.toml");
function getTomlSection(sectionName) {
  const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return supabaseConfig.match(
    new RegExp(`\\[${escapedName}\\]\\s*\\r?\\n([\\s\\S]*?)(?=\\r?\\n\\[|$)`),
  )?.[1] ?? "";
}

for (const functionName of [
  "initialize-paystack-payment",
  "verify-paystack-payment",
  "paystack-webhook",
  "admin-reconcile-support-payment",
]) {
  assert.match(
    getTomlSection(`functions.${functionName}`),
    /verify_jwt\s*=\s*false/,
    `${functionName} must declare its current JWT handling explicitly`,
  );
}
assert.match(
  getTomlSection("auth.email"),
  /enable_confirmations\s*=\s*true/,
  "email confirmations must remain enabled",
);

console.log("Production configuration contract passed.");
