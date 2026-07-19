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

let publishableApiKey = "";

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
  let oralInitializationCount = 0;
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "POST" && request.url === "/transaction/initialize") {
      const body = await jsonBody(request);
      initialized.set(body.reference, {
        ...body,
        testScenario: body.metadata?.subject_slug === "e2e-oral-questions"
          ? ++oralInitializationCount
          : 0,
      });
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
        if (
          initializedPayment.metadata?.subject_slug === "e2e-oral-questions" &&
          initializedPayment.testScenario === 1
        ) {
          response.end(JSON.stringify({
            status: true,
            data: {
              status: "failed",
              reference,
              amount: initializedPayment.amount,
              currency: initializedPayment.currency,
              gateway_response: "Declined",
              metadata: initializedPayment.metadata,
              authorization: {
                authorization_code: "AUTH_sensitive_test_value",
                last4: "4081",
                card_type: "visa",
              },
              customer: {
                email: initializedPayment.email,
                customer_code: "CUS_sensitive_test_value",
              },
            },
          }));
          return;
        }
        response.end(JSON.stringify({
          status: true,
          data: {
            status: "success",
          reference,
          amount: initializedPayment.testScenario === 2
            ? initializedPayment.amount + 100
            : initializedPayment.amount,
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
  return { server, port: server.address().port, initialized };
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
      apikey: publishableApiKey,
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
  publishableApiKey = publicKey;
  process.env.E2E_LOCAL_SUPABASE = "true";
  process.env.E2E_SUPABASE_URL = apiUrl;
  process.env.E2E_SUPABASE_PUBLIC_KEY = publicKey;
  process.env.E2E_SUPABASE_SECRET_KEY = secretKey;
  await globalSetup();

  const mock = await startMockPaystack();
  const envPath = "test-results/edge-payment.env";
  await mkdir("test-results", { recursive: true });
  await writeFile(envPath, [
    `SUPABASE_PUBLISHABLE_KEYS=${JSON.stringify({ default: publicKey })}`,
    `SUPABASE_SECRET_KEYS=${JSON.stringify({ default: secretKey })}`,
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

    const otherCandidate = createClient(apiUrl, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: WebSocket },
    });
    const otherLogin = await otherCandidate.auth.signInWithPassword({
      email: TEST_USERS.paid.email,
      password: TEST_PASSWORD,
    });
    if (otherLogin.error || !otherLogin.data.session) {
      fail(`Second payment test sign-in failed: ${otherLogin.error?.message ?? "no session"}`);
    }
    const otherToken = otherLogin.data.session.access_token;

    const unauthenticated = await invoke(apiUrl, "initialize-paystack-payment", null, { subject_slug: "public-financial-management" });
    if (unauthenticated.ok) fail("Unauthenticated payment initialization was accepted.");

    const invalidSession = await invoke(
      apiUrl,
      "initialize-paystack-payment",
      "invalid-user-jwt",
      { subject_slug: "public-financial-management" },
    );
    if (invalidSession.ok) fail("An invalid user JWT was accepted for payment initialization.");

    const unauthenticatedVerification = await invoke(apiUrl, "verify-paystack-payment", null, { reference: "PS-unauthenticated" });
    if (unauthenticatedVerification.ok) fail("Unauthenticated payment verification was accepted.");

    const comingSoon = await invoke(apiUrl, "initialize-paystack-payment", token, { subject_slug: "e2e-coming-soon" });
    if (comingSoon.ok) fail("A coming-soon module was accepted for payment.");

    const oral = await invoke(apiUrl, "initialize-paystack-payment", token, { subject_slug: "e2e-oral-questions" });
    if (!oral.ok) fail(`Published oral module payment initialization failed: ${await oral.text()}`);
    const oralBody = await oral.json();
    const declinedOral = await invoke(apiUrl, "verify-paystack-payment", token, { reference: oralBody.reference });
    if (declinedOral.ok) fail("A declined module payment was accepted as verified.");
    const declinedOrder = await service.from("payment_orders")
      .select("status, provider_status, fulfillment_status, provider_payload")
      .eq("provider_reference", oralBody.reference)
      .single();
    if (
      declinedOrder.error ||
      declinedOrder.data.status !== "failed" ||
      declinedOrder.data.provider_status !== "failed" ||
      declinedOrder.data.fulfillment_status !== "not_started"
    ) {
      fail("Declined module payment was not persisted as failed.");
    }
    const declinedPayload = JSON.stringify(declinedOrder.data.provider_payload ?? {}).toLowerCase();
    if (
      declinedPayload.includes("authorization") ||
      declinedPayload.includes("last4") ||
      declinedPayload.includes("customer") ||
      declinedPayload.includes("4081")
    ) {
      fail("Sensitive provider payment fields were persisted.");
    }
    const declinedHistory = await candidate.rpc("get_payment_history", { requested_limit: 20 });
    if (
      declinedHistory.error ||
      declinedHistory.data.some((payment) => payment.provider_reference === oralBody.reference)
    ) {
      fail("Declined checkout attempt leaked into customer payment history.");
    }

    const invalidFulfillment = await invoke(apiUrl, "initialize-paystack-payment", token, { subject_slug: "e2e-oral-questions" });
    if (!invalidFulfillment.ok) fail(`Access-issue payment initialization failed: ${await invalidFulfillment.text()}`);
    const invalidFulfillmentBody = await invalidFulfillment.json();
    const rejectedFulfillment = await invoke(apiUrl, "verify-paystack-payment", token, { reference: invalidFulfillmentBody.reference });
    if (rejectedFulfillment.status !== 409) fail("A paid transaction with invalid fulfillment data was not classified as an access issue.");
    const attentionOrder = await service.from("payment_orders")
      .select("status, provider_status, fulfillment_status, paid_at")
      .eq("provider_reference", invalidFulfillmentBody.reference)
      .single();
    if (
      attentionOrder.error ||
      attentionOrder.data.status !== "pending" ||
      attentionOrder.data.provider_status !== "success" ||
      attentionOrder.data.fulfillment_status !== "failed" ||
      !attentionOrder.data.paid_at
    ) {
      fail("Paid transaction was not retained when access fulfillment failed.");
    }
    const attentionHistory = await candidate.rpc("get_payment_history", { requested_limit: 20 });
    const attentionRecord = attentionHistory.data?.find((payment) => payment.provider_reference === invalidFulfillmentBody.reference);
    if (attentionHistory.error || attentionRecord?.record_type !== "attention") {
      fail("Paid transaction with an access issue was not surfaced for customer attention.");
    }

    const initialized = await invoke(
      apiUrl,
      "initialize-paystack-payment",
      token,
      { subject_slug: "public-financial-management" },
      { Origin: "https://untrusted-origin.example" },
    );
    if (!initialized.ok) fail(`Module payment initialization failed: ${await initialized.text()}`);
    const initializedBody = await initialized.json();
    if (!initializedBody.reference || !initializedBody.authorization_url) fail("Initialization response omitted payment details.");
    if (mock.initialized.get(initializedBody.reference)?.callback_url !== "http://127.0.0.1:4173/payment/verify") {
      fail("Payment callback was not derived from the trusted APP_URL configuration.");
    }

    const otherUsersReference = await invoke(
      apiUrl,
      "verify-paystack-payment",
      otherToken,
      { reference: initializedBody.reference },
    );
    if (otherUsersReference.status !== 403) {
      fail("A candidate could verify another candidate's payment reference.");
    }

    const resumedInitialization = await invoke(apiUrl, "initialize-paystack-payment", token, { subject_slug: "public-financial-management" });
    if (!resumedInitialization.ok) fail(`Recent checkout could not be recovered: ${await resumedInitialization.text()}`);
    const resumedBody = await resumedInitialization.json();
    if (resumedBody.reference !== initializedBody.reference || resumedBody.resumed !== true) {
      fail("Repeated initialization created or returned a different checkout.");
    }

    const verified = await invoke(apiUrl, "verify-paystack-payment", token, { reference: initializedBody.reference });
    if (!verified.ok) fail(`Module payment verification failed: ${await verified.text()}`);
    const verifiedBody = await verified.json();
    if (verifiedBody.status !== "active" || verifiedBody.subject_slug !== "public-financial-management") {
      fail("Verification did not activate the expected module.");
    }
    const fulfilledOrder = await service.from("payment_orders")
      .select("status, provider_status, fulfillment_status, paid_at")
      .eq("provider_reference", initializedBody.reference)
      .single();
    if (
      fulfilledOrder.error ||
      fulfilledOrder.data.status !== "active" ||
      fulfilledOrder.data.provider_status !== "success" ||
      fulfilledOrder.data.fulfillment_status !== "fulfilled" ||
      !fulfilledOrder.data.paid_at
    ) {
      fail("Successful payment truth and access fulfillment were not persisted together.");
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

    const missingSignatureWebhook = await invoke(
      apiUrl,
      "paystack-webhook",
      null,
      { event: "test.webhook", data: {} },
    );
    if (missingSignatureWebhook.status !== 401) fail("Missing webhook signature was not rejected.");

    const harmlessEvent = JSON.stringify({ event: "test.webhook", data: {} });
    const harmlessSignature = await createPaystackSignature(harmlessEvent, "local-edge-payment-secret");
    const harmlessWebhook = await invoke(apiUrl, "paystack-webhook", null, harmlessEvent, {
      "x-paystack-signature": harmlessSignature,
    });
    if (!harmlessWebhook.ok) fail(`Valid harmless webhook was rejected: ${await harmlessWebhook.text()}`);

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
