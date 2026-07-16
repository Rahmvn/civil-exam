import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import {
  assertLocalE2eSupabaseUrl,
  resolveSupabaseBrowserConfig,
} from "../../src/lib/supabaseConfig.js";

function readHeader(headers, name) {
  if (typeof headers?.get === "function") return headers.get(name);
  return headers?.[name] ?? headers?.[name.toLowerCase()];
}

test("frontend Supabase config prefers the publishable key", () => {
  const config = resolveSupabaseBrowserConfig({
    VITE_SUPABASE_URL: "https://project.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_preferred",
    VITE_SUPABASE_ANON_KEY: "legacy-anon",
  });

  assert.deepEqual(config, {
    supabaseUrl: "https://project.supabase.co",
    supabaseKey: "sb_publishable_preferred",
  });
});

test("frontend Supabase config temporarily falls back to the legacy anon key", () => {
  const config = resolveSupabaseBrowserConfig({
    VITE_SUPABASE_URL: "https://project.supabase.co",
    VITE_SUPABASE_ANON_KEY: "legacy-anon",
  });

  assert.equal(config.supabaseKey, "legacy-anon");
});

test("frontend Supabase config fails safely without a browser key", () => {
  assert.throws(
    () => resolveSupabaseBrowserConfig({ VITE_SUPABASE_URL: "https://project.supabase.co" }),
    { message: "Supabase browser configuration is missing" },
  );
});

test("frontend Supabase config preserves the local-only E2E auth guard", () => {
  assert.doesNotThrow(() => assertLocalE2eSupabaseUrl("http://127.0.0.1:55421", true));
  assert.doesNotThrow(() => assertLocalE2eSupabaseUrl("http://localhost:55421", true));
  assert.doesNotThrow(() => assertLocalE2eSupabaseUrl("https://project.supabase.co", false));
  assert.throws(
    () => assertLocalE2eSupabaseUrl("https://project.supabase.co", true),
    { message: "E2E tests may only connect to local Supabase" },
  );
});

test("authenticated Supabase function invocations send the user JWT", async () => {
  const requests = [];
  const client = createClient("https://project.supabase.co", "sb_publishable_key", {
    accessToken: async () => "candidate-user-jwt",
    global: {
      fetch: async (url, init = {}) => {
        requests.push({ url, init });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
    realtime: { transport: WebSocket },
  });

  await client.functions.invoke("initialize-paystack-payment", {
    body: { subject_slug: "public-financial-management" },
  });
  await client.functions.invoke("verify-paystack-payment", {
    body: { reference: "PS-test-reference" },
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://project.supabase.co/functions/v1/initialize-paystack-payment");
  assert.equal(requests[1].url, "https://project.supabase.co/functions/v1/verify-paystack-payment");

  for (const request of requests) {
    assert.equal(request.init.method, "POST");
    assert.equal(readHeader(request.init.headers, "Authorization"), "Bearer candidate-user-jwt");
    assert.equal(readHeader(request.init.headers, "apikey"), "sb_publishable_key");
    assert.equal(readHeader(request.init.headers, "Content-Type"), "application/json");
  }
});
