import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { readLocalSupabaseEnvironment } from "./localSupabaseEnvironment.mjs";

function fail(message) { throw new Error(message); }
function resolveSupabaseExecutable() {
  if (process.platform !== "win32") return "supabase";
  const result = spawnSync("where.exe", ["supabase"], { encoding: "utf8" });
  return result.stdout?.split(/\r?\n/).find((value) => value.toLowerCase().endsWith(".exe")) || "supabase";
}
function stopProcessTree(handle) {
  if (!handle?.pid) return;
  if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(handle.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
  else handle.kill("SIGTERM");
}
function cleanupLocalEmailCoreFixtures() {
  const containers = spawnSync("docker", ["ps", "--filter", "name=supabase_db_", "--format", "{{.Names}}"], {
    encoding: "utf8", windowsHide: true,
  });
  const database = containers.stdout?.split(/\r?\n/).find(Boolean);
  if (!database) fail("The local Supabase database container is not running.");
  const cleanup = spawnSync("docker", [
    "exec", database, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c",
    "delete from public.transactional_email_events where event_key like 'email-core:%'; delete from public.email_suppressions where email in ('hard_bounce@example.test','complaint@example.test','provider_suppression@example.test'); delete from public.email_provider_events where provider_event_id like 'svix-%';",
  ], { encoding: "utf8", windowsHide: true });
  if (cleanup.status !== 0) fail(`Could not clean local email fixtures: ${cleanup.stderr || cleanup.stdout}`);
}
async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function startMockResend() {
  const calls = [];
  let behavior = "accepted";
  const server = createServer(async (request, response) => {
    const body = await jsonBody(request).catch(() => ({}));
    calls.push({ idempotencyKey: request.headers["idempotency-key"], body });
    response.setHeader("Content-Type", "application/json");
    if (behavior === "timeout") {
      setTimeout(() => response.end(JSON.stringify({ id: "email-timeout-late" })), 1_500);
      return;
    }
    if (behavior === "network") {
      request.socket.destroy();
      return;
    }
    if (behavior === "429") {
      response.statusCode = 429;
      response.setHeader("Retry-After", "2");
      response.end(JSON.stringify({ message: "Rate limited" }));
      return;
    }
    if (behavior === "500") {
      response.statusCode = 503;
      response.end(JSON.stringify({ message: "Provider unavailable" }));
      return;
    }
    if (behavior === "400") {
      response.statusCode = 422;
      response.end(JSON.stringify({ message: "Invalid request" }));
      return;
    }
    if (behavior === "missing-id") {
      response.end(JSON.stringify({}));
      return;
    }
    response.end(JSON.stringify({ id: `email-${calls.length}` }));
  });
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  return { server, calls, setBehavior(value) { behavior = value; }, port: server.address().port };
}

async function waitForFunctions(apiUrl, publicKey, edge, logs) {
  const serveDeadline = Date.now() + 30_000;
  while (Date.now() < serveDeadline && !logs.join("").includes("Serving functions on")) {
    if (edge.exitCode !== null) fail(`Edge runtime stopped early.\n${logs.join("")}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!logs.join("").includes("Serving functions on")) fail(`Edge runtime did not finish loading.\n${logs.join("")}`);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (edge.exitCode !== null) fail(`Edge runtime stopped early.\n${logs.join("")}`);
    try {
      const response = await fetch(`${apiUrl}/functions/v1/process-email-dispatch`, {
        method: "POST", headers: { apikey: publicKey }, signal: AbortSignal.timeout(3_000),
      });
      if (response.status === 401) return;
    } catch { /* runtime is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(`Timed out waiting for Edge runtime.\n${logs.join("")}`);
}

function svixHeaders(secret, id, body, timestamp = Math.floor(Date.now() / 1000)) {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": String(timestamp), "svix-signature": `v1,${signature}` };
}

function engagementUnsubscribeToken(secret, userId) {
  const payload = Buffer.from(JSON.stringify({ v: 1, sub: userId, scope: "engagement" })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

async function main() {
  const { apiUrl, publicKey, secretKey } = readLocalSupabaseEnvironment();
  const service = createClient(apiUrl, secretKey, { auth: { persistSession: false } });
  const mock = await startMockResend();
  const dispatchSecret = "local-email-dispatch-secret-2026";
  const unsubscribeSecret = "local-email-unsubscribe-secret-2026";
  const webhookSecret = `whsec_${Buffer.from("local-resend-webhook-secret-2026").toString("base64")}`;
  const envPath = "test-results/email-core.env";
  await mkdir("test-results", { recursive: true });
  await writeFile(envPath, [
    `SUPABASE_PUBLISHABLE_KEYS=${JSON.stringify({ default: publicKey })}`,
    `SUPABASE_SECRET_KEYS=${JSON.stringify({ default: secretKey })}`,
    "RESEND_API_KEY=your-resend-test-value",
    `RESEND_API_URL=http://host.docker.internal:${mock.port}`,
    `EMAIL_DISPATCH_SECRET=${dispatchSecret}`,
    `EMAIL_UNSUBSCRIBE_SECRET=${unsubscribeSecret}`,
    `RESEND_WEBHOOK_SECRET=${webhookSecret}`,
    "EMAIL_PROVIDER_TIMEOUT_MS=1000",
    "EMAIL_DISPATCH_BATCH_SIZE=1",
  ].join("\n"), "utf8");

  const logs = [];
  const edge = spawn(resolveSupabaseExecutable(), ["functions", "serve", "--env-file", envPath, "--no-verify-jwt"], {
    cwd: process.cwd(), env: process.env, windowsHide: true,
  });
  edge.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  edge.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  let userId = null;
  const runId = randomUUID();
  try {
    await waitForFunctions(apiUrl, publicKey, edge, logs);
    cleanupLocalEmailCoreFixtures();
    const created = await service.auth.admin.createUser({
      email: `email-core-${Date.now()}@example.test`, password: "LocalTestOnly!2026", email_confirm: true,
    });
    if (created.error) fail(created.error.message);
    userId = created.data.user.id;
    const candidate = createClient(apiUrl, publicKey, { auth: { persistSession: false } });
    const candidateLogin = await candidate.auth.signInWithPassword({
      email: created.data.user.email,
      password: "LocalTestOnly!2026",
    });
    if (candidateLogin.error) fail(candidateLogin.error.message);

    const unsubscribeEndpoint = `${apiUrl}/functions/v1/email-unsubscribe`;
    const unsubscribeToken = engagementUnsubscribeToken(unsubscribeSecret, userId);
    const unsignedUnsubscribe = await fetch(unsubscribeEndpoint, { redirect: "manual" });
    if (unsignedUnsubscribe.status !== 302 || !unsignedUnsubscribe.headers.get("location")?.includes("/profile#email-preferences")) {
      fail("Unsubscribe GET did not route to account email preferences.");
    }
    const tamperedUnsubscribe = await fetch(`${unsubscribeEndpoint}?token=${encodeURIComponent(`${unsubscribeToken}x`)}`, { method: "POST" });
    if (tamperedUnsubscribe.status !== 400) fail("Tampered unsubscribe token was accepted.");
    const preferenceBeforeGet = await service.from("email_preferences").select("user_id").eq("user_id", userId).maybeSingle();
    const unsubscribeConfirmation = await fetch(`${unsubscribeEndpoint}?token=${encodeURIComponent(unsubscribeToken)}`, { redirect: "manual" });
    const preferenceAfterGet = await service.from("email_preferences").select("user_id").eq("user_id", userId).maybeSingle();
    if (unsubscribeConfirmation.status !== 302 || preferenceBeforeGet.data || preferenceAfterGet.data) {
      fail("Unsubscribe GET confirmation mutated preference state.");
    }
    const unsubscribePost = await fetch(`${unsubscribeEndpoint}?token=${encodeURIComponent(unsubscribeToken)}`, { method: "POST" });
    if (!unsubscribePost.ok) fail(`Valid unsubscribe POST failed: ${await unsubscribePost.text()}`);
    const firstPreference = await service.from("email_preferences").select("marketing_opted_out, opted_out_at, opt_out_source").eq("user_id", userId).single();
    if (!firstPreference.data?.marketing_opted_out || firstPreference.data.opt_out_source !== "email_unsubscribe") {
      fail("Valid unsubscribe POST did not set only the engagement preference.");
    }
    const unsubscribeReplay = await fetch(`${unsubscribeEndpoint}?token=${encodeURIComponent(unsubscribeToken)}`, { method: "POST" });
    const replayedPreference = await service.from("email_preferences").select("marketing_opted_out, opted_out_at").eq("user_id", userId).single();
    if (!unsubscribeReplay.ok || replayedPreference.data?.opted_out_at !== firstPreference.data.opted_out_at) {
      fail("Unsubscribe replay was not idempotent.");
    }
    const unknownToken = engagementUnsubscribeToken(unsubscribeSecret, randomUUID());
    const unknownUnsubscribe = await fetch(`${unsubscribeEndpoint}?token=${encodeURIComponent(unknownToken)}`, { method: "POST" });
    if (!unknownUnsubscribe.ok) fail("A valid unknown-user unsubscribe token did not fail closed without enumeration.");

    const enqueue = async (key, label = key) => {
      const result = await service.rpc("enqueue_transactional_email_event", {
        requested_event_key: key,
        requested_event_type: "payment_success",
        requested_user_id: userId,
        requested_payment_order_id: null,
        requested_payload: { provider_reference: key, product_label: label, amount_kobo: 250000, currency: "NGN" },
        requested_priority: 1,
      });
      if (result.error) fail(result.error.message);
      return result.data.id;
    };
    const runWorker = async () => {
      const response = await fetch(`${apiUrl}/functions/v1/process-email-dispatch`, {
        method: "POST",
        headers: { apikey: publicKey, Authorization: `Bearer ${dispatchSecret}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) fail(`Worker failed: ${await response.text()}`);
      return response.json();
    };
    const event = async (id) => {
      const result = await service.from("transactional_email_events").select("*").eq("id", id).single();
      if (result.error) fail(result.error.message);
      return result.data;
    };

    const acceptedId = await enqueue(`email-core:${runId}:accepted`, "Accepted module");
    const rejectedWorker = await fetch(`${apiUrl}/functions/v1/process-email-dispatch`, {
      method: "POST",
      headers: { apikey: publicKey, Authorization: "Bearer incorrect-dispatch-secret" },
    });
    const untouchedEvent = await event(acceptedId);
    if (rejectedWorker.status !== 401 || untouchedEvent.dispatch_status !== "pending" || untouchedEvent.attempt_count !== 0) {
      fail("An incorrect dispatcher secret reached the queue claim path.");
    }
    mock.setBehavior("accepted");
    await runWorker();
    const accepted = await event(acceptedId);
    if (accepted.dispatch_status !== "accepted" || !accepted.provider_message_id) fail("A 2xx provider response was not accepted.");

    const retryId = await enqueue(`email-core:${runId}:retry`, "Retry module");
    mock.setBehavior("429");
    await runWorker();
    let retry = await event(retryId);
    if (retry.dispatch_status !== "retrying" || retry.attempt_count !== 1) fail("HTTP 429 did not schedule retry.");
    const firstRetryKey = mock.calls.at(-1).idempotencyKey;
    await service.from("transactional_email_events").update({ next_attempt_at: new Date(Date.now() - 1_000).toISOString() }).eq("id", retryId);
    mock.setBehavior("accepted");
    await runWorker();
    retry = await event(retryId);
    if (retry.dispatch_status !== "accepted" || retry.attempt_count !== 2 || mock.calls.at(-1).idempotencyKey !== firstRetryKey) {
      fail("Retry did not preserve logical/provider idempotency.");
    }

    for (const [behavior, expected] of [["500", "retrying"], ["timeout", "retrying"], ["network", "retrying"], ["missing-id", "retrying"], ["400", "dead"]]) {
      const id = await enqueue(`email-core:${runId}:${behavior}`, `${behavior} module`);
      mock.setBehavior(behavior);
      await runWorker();
      if ((await event(id)).dispatch_status !== expected) fail(`${behavior} provider behavior was classified incorrectly.`);
    }

    const webhook = async ({ id, type, messageId, recipient, createdAt = new Date().toISOString(), valid = true, data = {} }) => {
      const body = JSON.stringify({ type, created_at: createdAt, data: { email_id: messageId, to: [recipient], ...data } });
      const headers = svixHeaders(webhookSecret, id, body);
      if (!valid) headers["svix-signature"] = "v1,invalid";
      return fetch(`${apiUrl}/functions/v1/resend-webhook`, {
        method: "POST", headers: { apikey: publicKey, "Content-Type": "application/json", ...headers }, body,
      });
    };

    const invalid = await webhook({ id: "svix-invalid", type: "email.delivered", messageId: accepted.provider_message_id, recipient: created.data.user.email, valid: false });
    if (invalid.status !== 401) fail("Invalid Resend signature was accepted.");
    const deliveredAt = new Date();
    const delivered = await webhook({ id: "svix-delivered", type: "email.delivered", messageId: accepted.provider_message_id, recipient: created.data.user.email, createdAt: deliveredAt.toISOString() });
    if (!delivered.ok) fail(`Delivered webhook failed: ${await delivered.text()}`);
    const duplicate = await webhook({ id: "svix-delivered", type: "email.delivered", messageId: accepted.provider_message_id, recipient: created.data.user.email, createdAt: deliveredAt.toISOString() });
    if (!(await duplicate.json()).duplicate) fail("Duplicate webhook was not idempotent.");
    await webhook({ id: "svix-old-sent", type: "email.sent", messageId: accepted.provider_message_id, recipient: created.data.user.email, createdAt: new Date(deliveredAt.getTime() - 60_000).toISOString() });
    if ((await event(acceptedId)).delivery_status !== "delivered") fail("Out-of-order sent event regressed delivered state.");

    const delayed = await webhook({ id: "svix-delayed", type: "email.delivery_delayed", messageId: retry.provider_message_id, recipient: created.data.user.email });
    if (!delayed.ok || (await event(retryId)).delivery_status !== "delayed") fail("Delivery delay was not tracked.");
    const failed = await webhook({ id: "svix-failed", type: "email.failed", messageId: retry.provider_message_id, recipient: created.data.user.email });
    if (!failed.ok || (await event(retryId)).delivery_status !== "failed") fail("Provider delivery failure was not tracked.");

    for (const [type, reason] of [["email.bounced", "hard_bounce"], ["email.complained", "complaint"], ["email.suppressed", "provider_suppression"]]) {
      const recipient = `${reason}@example.test`;
      const response = await webhook({ id: `svix-${reason}`, type, messageId: `unknown-${reason}`, recipient });
      if (!response.ok) fail(`${type} webhook failed.`);
      const suppression = await service.from("email_suppressions").select("reason").eq("email", recipient).single();
      if (suppression.data?.reason !== reason) fail(`${type} did not create the expected suppression.`);
    }

    const authEmailUpdate = await service.auth.admin.updateUserById(userId, { email: "hard_bounce@example.test", email_confirm: true });
    if (authEmailUpdate.error) fail(authEmailUpdate.error.message);
    const suppressedId = await enqueue(`email-core:${runId}:suppressed-recipient`, "Suppressed recipient module");
    const providerCallsBeforeSuppression = mock.calls.length;
    mock.setBehavior("accepted");
    await runWorker();
    const suppressedEvent = await event(suppressedId);
    if (
      suppressedEvent.dispatch_status !== "cancelled"
      || suppressedEvent.delivery_status !== "suppressed"
      || suppressedEvent.recipient_email_used !== "hard_bounce@example.test"
      || mock.calls.length !== providerCallsBeforeSuppression
    ) fail("The current Auth recipient suppression did not prevent provider dispatch.");
    const resubscribe = await candidate.rpc("set_my_engagement_email_enabled", { requested_enabled: true });
    const suppressionAfterResubscribe = await service.from("email_suppressions").select("reason").eq("email", "hard_bounce@example.test").single();
    if (resubscribe.error || resubscribe.data?.engagement_enabled !== true || suppressionAfterResubscribe.data?.reason !== "hard_bounce") {
      fail("Candidate re-subscribe did not remain separate from technical suppression.");
    }

    const malformedBody = "not-json";
    const malformed = await fetch(`${apiUrl}/functions/v1/resend-webhook`, {
      method: "POST", headers: {
        apikey: publicKey,
        "Content-Type": "application/json",
        ...svixHeaders(webhookSecret, "svix-malformed", malformedBody),
      }, body: malformedBody,
    });
    if (malformed.status !== 400) fail("Malformed signed webhook was accepted.");
    const replayBody = JSON.stringify({ type: "email.sent", created_at: new Date().toISOString(), data: { email_id: "old", to: ["old@example.test"] } });
    const staleReplay = await fetch(`${apiUrl}/functions/v1/resend-webhook`, {
      method: "POST", headers: {
        apikey: publicKey,
        "Content-Type": "application/json",
        ...svixHeaders(webhookSecret, "svix-stale", replayBody, Math.floor(Date.now() / 1000) - 600),
      }, body: replayBody,
    });
    if (staleReplay.status !== 401) fail("A stale signed webhook replay was accepted.");

    console.log("Email core integration passed: provider classification, retry idempotency, webhook security, delivery ordering, suppression, and signed unsubscribe.");
  } finally {
    cleanupLocalEmailCoreFixtures();
    if (userId) await service.auth.admin.deleteUser(userId).catch(() => null);
    stopProcessTree(edge);
    mock.server.closeAllConnections?.();
    await new Promise((resolve) => mock.server.close(resolve));
    await rm(envPath, { force: true });
  }
}

main().then(() => process.exit(0)).catch((error) => { console.error(error.stack || error); process.exit(1); });
