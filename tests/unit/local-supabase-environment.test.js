import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLocalSupabaseUrl,
  localBrowserEnvironment,
  parseSupabaseEnvironment,
  readLocalSupabaseEnvironment,
} from "../../scripts/test/localSupabaseEnvironment.mjs";

test("Supabase CLI environment output is parsed without evaluating values", () => {
  assert.deepEqual(
    parseSupabaseEnvironment('API_URL="http://127.0.0.1:55421"\nPUBLISHABLE_KEY="local-key"\n'),
    { API_URL: "http://127.0.0.1:55421", PUBLISHABLE_KEY: "local-key" },
  );
});

test("local Supabase guard permits loopback hosts", () => {
  assert.doesNotThrow(() => assertLocalSupabaseUrl("http://127.0.0.1:55421"));
  assert.doesNotThrow(() => assertLocalSupabaseUrl("http://localhost:55421"));
  assert.doesNotThrow(() => assertLocalSupabaseUrl("http://[::1]:55421"));
});

test("local Supabase guard rejects remote and malformed URLs", () => {
  assert.throws(
    () => assertLocalSupabaseUrl("https://project.supabase.co", "Payment tests"),
    /Payment tests refused to run because Supabase is not local/,
  );
  assert.throws(() => assertLocalSupabaseUrl("not-a-url"), /Supabase URL is invalid/);
});

test("local Supabase environment rejects a remote CLI target", () => {
  const run = () => ({
    status: 0,
    stdout: [
      'API_URL="https://project.supabase.co"',
      'PUBLISHABLE_KEY="public-key"',
      'SECRET_KEY="secret-key"',
    ].join("\n"),
  });

  assert.throws(() => readLocalSupabaseEnvironment({ run }), /Supabase is not local/);
});

test("local browser environment overrides every supported frontend key", () => {
  assert.deepEqual(
    localBrowserEnvironment({ apiUrl: "http://127.0.0.1:55421", publicKey: "local-public" }),
    {
      VITE_SUPABASE_URL: "http://127.0.0.1:55421",
      VITE_SUPABASE_PUBLISHABLE_KEY: "local-public",
      VITE_SUPABASE_ANON_KEY: "local-public",
    },
  );
});
