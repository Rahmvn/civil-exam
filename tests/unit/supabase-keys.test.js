import assert from "node:assert/strict";
import test from "node:test";
import { resolveSupabaseKey } from "../../supabase/functions/_shared/supabase-keys.js";

const keyConfig = {
  dictionaryEnvName: "SUPABASE_PUBLISHABLE_KEYS",
  legacyEnvName: "SUPABASE_ANON_KEY",
  label: "Supabase publishable key",
};

function getEnv(values) {
  return (name) => values[name] ?? "";
}

test("Supabase key resolver prefers default key dictionaries", () => {
  const key = resolveSupabaseKey(keyConfig, getEnv({
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: "sb_publishable_new" }),
    SUPABASE_ANON_KEY: "legacy-anon",
  }));

  assert.equal(key, "sb_publishable_new");
});

test("Supabase key resolver falls back to legacy keys", () => {
  const key = resolveSupabaseKey(keyConfig, getEnv({
    SUPABASE_ANON_KEY: "legacy-anon",
  }));

  assert.equal(key, "legacy-anon");
});

test("Supabase key resolver fails safely when no compatible key exists", () => {
  assert.throws(
    () => resolveSupabaseKey(keyConfig, getEnv({})),
    /Supabase publishable key is not configured/,
  );
});

test("Supabase key resolver rejects malformed key dictionaries without leaking values", () => {
  assert.throws(
    () => resolveSupabaseKey(keyConfig, getEnv({
      SUPABASE_PUBLISHABLE_KEYS: "{bad-json",
      SUPABASE_ANON_KEY: "legacy-anon",
    })),
    { message: "SUPABASE_PUBLISHABLE_KEYS must be valid JSON" },
  );

  assert.throws(
    () => resolveSupabaseKey(keyConfig, getEnv({
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ other: "sb_publishable_new" }),
    })),
    { message: "SUPABASE_PUBLISHABLE_KEYS.default is not configured" },
  );
});
