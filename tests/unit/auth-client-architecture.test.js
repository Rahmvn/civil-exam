import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientPath = new URL("../../src/lib/supabaseClient.js", import.meta.url);
const callbackPath = new URL("../../src/pages/AuthCallback.jsx", import.meta.url);
const coordinatorPath = new URL("../../src/lib/authInitialization.js", import.meta.url);

test("Release A keeps one implicit client and automatic callback ownership", async () => {
  const [client, callback, coordinator] = await Promise.all([
    readFile(clientPath, "utf8"),
    readFile(callbackPath, "utf8"),
    readFile(coordinatorPath, "utf8"),
  ]);

  assert.equal((client.match(/createClient\(/g) ?? []).length, 1);
  assert.match(client, /flowType: "implicit"/);
  assert.match(client, /detectSessionInUrl: true/);
  assert.match(client, /createAuthInitializationCoordinator\(supabase\.auth/);
  assert.match(coordinator, /auth\.getSession\(\)/);
  assert.doesNotMatch(coordinator, /\.initialize\(/);
  assert.doesNotMatch(callback, /createClient|exchangeCodeForSession/);
  assert.match(callback, /cleanAuthCallbackUrl/);
});
