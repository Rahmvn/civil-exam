import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
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
  if (!["127.0.0.1", "localhost"].includes(new URL(apiUrl).hostname)) {
    fail("Compatibility tests require local Supabase.");
  }
  return { apiUrl, publicKey, secretKey };
}

function resolveSupabaseExecutable() {
  if (process.platform !== "win32") return "supabase";
  const located = spawnSync("where.exe", ["supabase"], { encoding: "utf8" });
  return located.stdout?.split(/\r?\n/).find((entry) => entry.toLowerCase().endsWith(".exe")) || "supabase";
}

function stopProcessTree(handle) {
  if (!handle?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(handle.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    handle.kill("SIGTERM");
  }
}

async function waitForRuntime(handle, logs) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (handle.exitCode !== null) {
      const diagnostic = logs.join("")
        .replace(/sb_(?:publishable|secret)_[A-Za-z0-9_-]+/g, "[redacted-supabase-key]")
        .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-jwt]");
      fail(`Compatibility function server stopped early.\n${diagnostic}`);
    }
    if (logs.join("").includes("Serving functions on")) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail("Timed out starting compatibility functions.");
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
      const payment = initialized.get(reference);
      if (!payment) {
        response.statusCode = 404;
        response.end(JSON.stringify({ status: false, message: "Unknown reference" }));
        return;
      }
      response.end(JSON.stringify({
        status: true,
        data: {
          status: "success",
          reference,
          amount: payment.amount,
          currency: payment.currency,
          metadata: payment.metadata,
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

async function invoke(apiUrl, publicKey, functionName, token, body, headers = {}) {
  return fetch(`${apiUrl}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      apikey: publicKey,
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
  const workdir = path.resolve("supabase/compatibility/pre-migration");
  const envPath = path.resolve("test-results/pre-migration-payment.env");
  const testPaystackSecret = "local-compatibility-paystack-secret";
  await mkdir(path.dirname(envPath), { recursive: true });
  await writeFile(envPath, [
    `SUPABASE_PUBLISHABLE_KEYS=${JSON.stringify({ default: publicKey })}`,
    `SUPABASE_SECRET_KEYS=${JSON.stringify({ default: secretKey })}`,
    `PAYSTACK_SECRET_KEY=${testPaystackSecret}`,
    `PAYSTACK_API_URL=http://host.docker.internal:${mock.port}`,
    "APP_URL=http://127.0.0.1:4173",
  ].join("\n"), "utf8");

  const logs = [];
  const edge = spawn(resolveSupabaseExecutable(), [
    "functions",
    "serve",
    "--workdir",
    workdir,
    "--env-file",
    envPath,
    "--no-verify-jwt",
  ], { cwd: process.cwd(), env: process.env, windowsHide: true });
  edge.stdout.on("data", (chunk) => logs.push(chunk.toString()));
  edge.stderr.on("data", (chunk) => logs.push(chunk.toString()));

  try {
    await waitForRuntime(edge, logs);
    const createCandidate = () => createClient(apiUrl, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: WebSocket },
    });
    const owner = createCandidate();
    const other = createCandidate();
    const ownerLogin = await owner.auth.signInWithPassword({
      email: TEST_USERS.free.email,
      password: TEST_PASSWORD,
    });
    const otherLogin = await other.auth.signInWithPassword({
      email: TEST_USERS.paid.email,
      password: TEST_PASSWORD,
    });
    if (ownerLogin.error || !ownerLogin.data.session || otherLogin.error || !otherLogin.data.session) {
      fail("Compatibility test sign-in failed.");
    }

    const withoutJwt = await invoke(apiUrl, publicKey, "initialize-paystack-payment", null, {
      subject_slug: "public-financial-management",
    });
    if (withoutJwt.ok) fail("Publishable key without a user JWT was accepted.");

    const invalidJwt = await invoke(apiUrl, publicKey, "initialize-paystack-payment", "invalid-jwt", {
      subject_slug: "public-financial-management",
    });
    if (invalidJwt.ok) fail("Invalid user JWT was accepted.");

    const initialized = await invoke(
      apiUrl,
      publicKey,
      "initialize-paystack-payment",
      ownerLogin.data.session.access_token,
      { subject_slug: "public-financial-management" },
    );
    if (!initialized.ok) fail(`Authenticated initialization failed: ${await initialized.text()}`);
    const payment = await initialized.json();

    const foreignVerification = await invoke(
      apiUrl,
      publicKey,
      "verify-paystack-payment",
      otherLogin.data.session.access_token,
      { reference: payment.reference },
    );
    if (foreignVerification.status !== 403) fail("Cross-user payment verification was not rejected.");

    const missingSignature = await invoke(apiUrl, publicKey, "paystack-webhook", null, "{}");
    if (missingSignature.status !== 401) fail("Missing webhook signature was not rejected.");

    const invalidSignature = await invoke(apiUrl, publicKey, "paystack-webhook", null, "{}", {
      "x-paystack-signature": "invalid",
    });
    if (invalidSignature.status !== 401) fail("Invalid webhook signature was not rejected.");

    const harmlessBody = JSON.stringify({ event: "test.webhook", data: {} });
    const validSignature = await createPaystackSignature(harmlessBody, testPaystackSecret);
    const validWebhook = await invoke(apiUrl, publicKey, "paystack-webhook", null, harmlessBody, {
      "x-paystack-signature": validSignature,
    });
    if (!validWebhook.ok) fail(`Valid harmless webhook was rejected: ${await validWebhook.text()}`);

    const runtimeOutput = logs.join("");
    for (const secret of [publicKey, secretKey, testPaystackSecret]) {
      if (runtimeOutput.includes(secret)) fail("A compatibility credential appeared in runtime logs.");
    }

    console.log("Pre-migration payment security passed: internal auth, ownership, signatures, and log safety.");
  } finally {
    stopProcessTree(edge);
    mock.server.closeAllConnections?.();
    await new Promise((resolve) => mock.server.close(resolve));
    await rm(envPath, { force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
