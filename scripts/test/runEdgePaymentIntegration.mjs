import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import globalSetup from "../../tests/e2e/global-setup.js";
import { TEST_PASSWORD, TEST_USERS } from "../../tests/e2e/test-data.js";
import { createPaystackSignature } from "../../supabase/functions/_shared/payment-validation.js";

function fail(message) {
  throw new Error(message);
}

function parseEnvironment(output) {
  return Object.fromEntries(output.split(/\r?\n/)
    .map((line) => line.match(/^([A-Z0-9_]+)=(?:"(.*)"|(.*))$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2] ?? match[3] ?? ""]));
}

function localEnvironment() {
  const status = spawnSync("supabase", ["status", "-o", "env"], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (status.status !== 0) fail("Local Supabase is not ready. Run `supabase start` first.");
  const values = parseEnvironment(status.stdout);
  const apiUrl = values.API_URL;
  const publicKey = values.PUBLISHABLE_KEY || values.ANON_KEY;
  const secretKey = values.SECRET_KEY || values.SERVICE_ROLE_KEY;
  if (!apiUrl || !publicKey || !secretKey) fail("Local Supabase test credentials are unavailable.");
  if (!['127.0.0.1', 'localhost'].includes(new URL(apiUrl).hostname)) fail("Edge tests require local Supabase.");
  return { apiUrl, publicKey, secretKey };
}

function resolveSupabaseExecutable() {
  if (process.platform !== "win32") return "supabase";
  const located = spawnSync("where.exe", ["supabase"], { encoding: "utf8" });
  const executable = located.stdout?.split(/\r?\n/).find((entry) => entry.toLowerCase().endsWith(".exe"));
  return executable || "supabase";
}

function stopProcessTree(processHandle) {
  if (!processHandle?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(processHandle.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  processHandle.kill("SIGTERM");
}

async function waitForRuntimeLog(processHandle, logs) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) fail(`Edge Function server stopped early.\n${logs.join("")}`);
    if (logs.join("").includes("Serving functions on")) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`Timed out while starting the Edge Function runtime.\n${logs.join("")}`);
}

function refreshLocalGateway() {
  const containers = spawnSync("docker", ["ps", "--filter", "name=supabase_kong_", "--format", "{{.Names}}"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const gateway = containers.stdout?.split(/\r?\n/).find(Boolean);
  if (!gateway) fail("The local Supabase gateway container is not running.");
  const restarted = spawnSync("docker", ["restart", gateway], { encoding: "utf8", windowsHide: true });
  if (restarted.status !== 0) fail(`Could not refresh the local Supabase gateway: ${restarted.stderr}`);
}

async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function startMockPaystack() {
  const initialized = new Map();
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST" && request.url === "/transaction/initialize") {
      const body = await jsonBody(request);
      initialized.set(body.reference, body);
      response.end(JSON.stringify({
        status: true,
        message: "Authorization URL created",
        data: {
          authorization_url: `https://checkout.example.test/${body.reference}`,
          access_code: `access-${body.reference}`,
          reference: body.reference,
        },
      }));
      return;
    }

    const verifyMatch = request.url?.match(/^\/transaction\/verify\/(.+)$/);
    if (request.method === "GET" && verifyMatch) {
      const reference = decodeURIComponent(verifyMatch[1]);
      const initializedPayment = initialized.get(reference);
      if (!initializedPayment) {
        response.statusCode = 404;
        response.end(JSON.stringify({ status: false, message: "Unknown reference" }));
        return;
      }
      response.end(JSON.stringify({
        status: true,
        data: {
          status: "success",
          reference,
          amount: initializedPayment.amount,
          currency: initializedPayment.currency,
          metadata: initializedPayment.metadata,
        },
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ status: false, message: "Mock route not found" }));
  });

  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  return { server, port: server.address().port };
}

async function waitForFunctions(apiUrl, publicKey, processHandle, logs) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) fail(`Edge Function server stopped early.\n${logs.join("")}`);
    try {
      const response = await fetch(`${apiUrl}/functions/v1/paystack-webhook`, {
        method: "POST",
        headers: {
          apikey: publicKey,
          "Content-Type": "application/json",
          "x-paystack-signature": "readiness-probe",
        },
        body: "{}",
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status < 500) return;
    } catch {
      // The local Edge Runtime is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(`Timed out waiting for local Edge Functions.\n${logs.join("")}`);
}

async function invoke(apiUrl, functionName, accessToken, body, headers = {}) {
  return fetch(`${apiUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

async function main() {
  const { apiUrl, publicKey, secretKey } = localEnvironment();
  process.env.E2E_LOCAL_SUPABASE = "true";
  process.env.E2E_SUPABASE_URL = apiUrl;
  process.env.E2E_SUPABASE_PUBLIC_KEY = publicKey;
  process.env.E2E_SUPABASE_SECRET_KEY = secretKey;
  await globalSetup();

  const mock = await startMockPaystack();
  const envPath = "test-results/edge-payment.env";
  await mkdir("test-results", { recursive: true });
  await writeFile(envPath, [
    "PAYSTACK_SECRET_KEY=local-edge-payment-secret",
    `PAYSTACK_API_URL=http://host.docker.internal:${mock.port}`,
    "APP_URL=http://127.0.0.1:4173",
  ].join("\n"), "utf8");

  const logs = [];
  const edge = spawn(resolveSupabaseExecutable(), ["functions", "serve", "--env-file", envPath, "--no-verify-jwt"], {
    cwd: process.cwd(),
    env: process.env,
    windowsHide: true,
  });
  edge.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  edge.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  try {
    await waitForRuntimeLog(edge, logs);
    refreshLocalGateway();
    await waitForFunctions(apiUrl, publicKey, edge, logs);
    const candidate = createClient(apiUrl, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: WebSocket },
    });
    const service = createClient(apiUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: WebSocket },
    });
    const login = await candidate.auth.signInWithPassword({ email: TEST_USERS.free.email, password: TEST_PASSWORD });
    if (login.error || !login.data.session) fail(`Payment test sign-in failed: ${login.error?.message ?? "no session"}`);
    const token = login.data.session.access_token;
    const userId = login.data.user.id;

    const unauthenticated = await invoke(apiUrl, "initialize-paystack-payment", null, { subject_slug: "public-financial-management" });
    if (unauthenticated.ok) fail("Unauthenticated payment initialization was accepted.");

    const comingSoon = await invoke(apiUrl, "initialize-paystack-payment", token, { subject_slug: "e2e-coming-soon" });
    if (comingSoon.ok) fail("A coming-soon module was accepted for payment.");

    const oral = await invoke(apiUrl, "initialize-paystack-payment", token, { subject_slug: "e2e-oral-questions" });
    if (!oral.ok) fail(`Published oral module payment initialization failed: ${await oral.text()}`);

    const initialized = await invoke(apiUrl, "initialize-paystack-payment", token, { subject_slug: "public-financial-management" });
    if (!initialized.ok) fail(`Module payment initialization failed: ${await initialized.text()}`);
    const initializedBody = await initialized.json();
    if (!initializedBody.reference || !initializedBody.authorization_url) fail("Initialization response omitted payment details.");

    const verified = await invoke(apiUrl, "verify-paystack-payment", token, { reference: initializedBody.reference });
    if (!verified.ok) fail(`Module payment verification failed: ${await verified.text()}`);
    const verifiedBody = await verified.json();
    if (verifiedBody.status !== "active" || verifiedBody.subject_slug !== "public-financial-management") {
      fail("Verification did not activate the expected module.");
    }

    const replay = await invoke(apiUrl, "verify-paystack-payment", token, { reference: initializedBody.reference });
    if (!replay.ok) fail(`Verification replay was not idempotent: ${await replay.text()}`);
    const entitlements = await service.from("module_entitlements")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "active");
    if (entitlements.error || entitlements.count !== 1) fail("Verification replay created an invalid entitlement count.");

    const invalidWebhook = await invoke(apiUrl, "paystack-webhook", null, { event: "charge.success" }, {
      "x-paystack-signature": "invalid",
    });
    if (invalidWebhook.status !== 401) fail("Invalid webhook signature was not rejected.");

    const event = JSON.stringify({
      event: "charge.success",
      data: {
        status: "success",
        reference: initializedBody.reference,
        amount: 250000,
        currency: "NGN",
        metadata: {
          payment_order_id: (await service.from("payment_orders").select("id").eq("provider_reference", initializedBody.reference).single()).data.id,
          user_id: userId,
          subject_id: (await service.from("subjects").select("id").eq("slug", "public-financial-management").single()).data.id,
        },
      },
    });
    const signature = await createPaystackSignature(event, "local-edge-payment-secret");
    const webhook = await invoke(apiUrl, "paystack-webhook", null, event, { "x-paystack-signature": signature });
    if (!webhook.ok) fail(`Valid webhook replay failed: ${await webhook.text()}`);

    console.log("Edge payment integration passed: authentication, lifecycle, oral readiness, verification, replay, and webhook signatures.");
  } finally {
    stopProcessTree(edge);
    mock.server.closeAllConnections?.();
    await new Promise((resolve) => mock.server.close(resolve));
    await rm(envPath, { force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error?.stack ?? error);
    process.exit(1);
  });
