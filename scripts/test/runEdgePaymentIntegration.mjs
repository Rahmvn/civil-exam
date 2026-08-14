import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import globalSetup from "../../tests/e2e/global-setup.js";
import { TEST_PASSWORD, TEST_USERS } from "../../tests/e2e/test-data.js";
import { createPaystackSignature } from "../../supabase/functions/_shared/payment-validation.js";
import { readLocalSupabaseEnvironment } from "./localSupabaseEnvironment.mjs";

function fail(message) {
  throw new Error(message);
}

let publishableApiKey = "";

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

function resetLocalEdgeRateLimits(userIds) {
  if (!userIds.every((userId) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId))) {
    fail("Refusing to reset edge rate limits for invalid local test user ids.");
  }

  const containers = spawnSync("docker", ["ps", "--filter", "name=supabase_db_", "--format", "{{.Names}}"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const database = containers.stdout?.split(/\r?\n/).find(Boolean);
  if (!database) fail("The local Supabase database container is not running.");

  const quotedUserIds = userIds.map((userId) => `'${userId}'`).join(",");
  const reset = spawnSync("docker", [
    "exec",
    database,
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-c",
    `delete from private.edge_rate_limits where user_id in (${quotedUserIds});`,
  ], {
    encoding: "utf8",
    windowsHide: true,
  });

  if (reset.status !== 0) {
    fail(`Could not reset local edge payment rate limits: ${reset.stderr || reset.stdout}`);
  }
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
              domain: "test",
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
            domain: "test",
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
  const { apiUrl, publicKey, secretKey } = readLocalSupabaseEnvironment();
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
    "PAYSTACK_SECRET_KEY=sk_test_local-edge-payment-secret",
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

  let cleanupService = null;
  const bundleTestUserIds = [];
  const bundleTestOfferIds = [];

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
    cleanupService = service;
    async function sendPaystackEvent(payload) {
      const body = JSON.stringify(payload);
      const signature = await createPaystackSignature(body, "sk_test_local-edge-payment-secret");
      return invoke(apiUrl, "paystack-webhook", null, body, { "x-paystack-signature": signature });
    }
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
    const otherUserId = otherLogin.data.user.id;
    resetLocalEdgeRateLimits([userId, otherUserId]);

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

    const oversizedInitialization = await invoke(
      apiUrl,
      "initialize-paystack-payment",
      token,
      { subject_slug: "x".repeat(4_096) },
    );
    if (oversizedInitialization.status !== 413) {
      fail("An oversized candidate payment request was not rejected with HTTP 413.");
    }

    const activePack = await service.from("exam_packs")
      .select("id, price_kobo, currency")
      .eq("is_active", true)
      .single();
    if (activePack.error || !activePack.data) fail("The active payment pack fixture is missing.");
    const untrackedReference = `PS-UNTRACKED-${crypto.randomUUID()}`;
    mock.initialized.set(untrackedReference, {
      amount: activePack.data.price_kobo,
      currency: activePack.data.currency,
      metadata: { user_id: userId, exam_pack_id: activePack.data.id },
    });
    const untrackedVerification = await invoke(
      apiUrl,
      "verify-paystack-payment",
      token,
      { reference: untrackedReference },
    );
    if (untrackedVerification.status !== 404) {
      fail("A successful provider transaction without a local order was accepted by verification.");
    }
    const untrackedVerificationBody = await untrackedVerification.json();
    if (untrackedVerificationBody.code !== "UNKNOWN_PAYMENT_REFERENCE") {
      fail("An untracked provider transaction did not return the expected safe error code.");
    }
    const untrackedWebhook = await sendPaystackEvent({
      event: "charge.success",
      data: {
        status: "success",
        domain: "test",
        reference: untrackedReference,
        amount: activePack.data.price_kobo,
        currency: activePack.data.currency,
        metadata: { user_id: userId, exam_pack_id: activePack.data.id },
      },
    });
    if (!untrackedWebhook.ok) fail(`An untracked signed webhook was not safely acknowledged: ${await untrackedWebhook.text()}`);
    const untrackedLegacyAccess = await service.from("entitlements")
      .select("id")
      .eq("paystack_reference", untrackedReference)
      .maybeSingle();
    if (untrackedLegacyAccess.error || untrackedLegacyAccess.data) {
      fail("An untracked successful provider event created legacy full access.");
    }

    const comingSoon = await invoke(apiUrl, "initialize-paystack-payment", token, { subject_slug: "e2e-coming-soon" });
    if (comingSoon.ok) fail("A coming-soon module was accepted for payment.");

    const pausedSubject = await service.from("subjects")
      .select("id")
      .eq("slug", "public-service-rules")
      .single();
    if (pausedSubject.error || !pausedSubject.data) fail("The payment pause fixture module is missing.");
    let pausedPayment;
    try {
      const pauseResult = await service.from("subjects")
        .update({ candidate_availability: "paused" })
        .eq("id", pausedSubject.data.id);
      if (pauseResult.error) fail(`Could not pause the payment fixture: ${pauseResult.error.message}`);
      pausedPayment = await invoke(apiUrl, "initialize-paystack-payment", token, { subject_slug: "public-service-rules" });
    } finally {
      const restoreResult = await service.from("subjects")
        .update({ candidate_availability: "available" })
        .eq("id", pausedSubject.data.id);
      if (restoreResult.error) fail(`Could not restore the payment fixture: ${restoreResult.error.message}`);
    }
    if (pausedPayment?.ok) fail("A paused module was accepted for payment.");

    resetLocalEdgeRateLimits([userId]);
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
    const declinedRecord = declinedHistory.data?.find((payment) => payment.provider_reference === oralBody.reference);
    if (
      declinedHistory.error ||
      declinedRecord?.provider_status !== "failed" ||
      declinedRecord?.record_type !== "history" ||
      declinedRecord?.receipt_eligible !== false
    ) {
      fail("Declined checkout outcome was not represented truthfully in customer payment history.");
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
    const queuedAttentionEmail = await service.from("transactional_email_events")
      .select("dispatch_status, attempt_count")
      .eq("event_key", `payment_access_issue:${invalidFulfillmentBody.reference}`)
      .single();
    if (queuedAttentionEmail.error || queuedAttentionEmail.data.dispatch_status !== "pending" || queuedAttentionEmail.data.attempt_count !== 0) {
      fail("Paid-but-access-review email was not durably queued without provider dispatch.");
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
    const queuedConfirmation = await service.from("transactional_email_events")
      .select("id, dispatch_status, attempt_count")
      .eq("event_key", `payment_success:${initializedBody.reference}`)
      .single();
    if (queuedConfirmation.error || queuedConfirmation.data.dispatch_status !== "pending" || queuedConfirmation.data.attempt_count !== 0) {
      fail("Payment confirmation was not queued after fulfillment.");
    }

    const replay = await invoke(apiUrl, "verify-paystack-payment", token, { reference: initializedBody.reference });
    if (!replay.ok) fail(`Verification replay was not idempotent: ${await replay.text()}`);
    const entitlements = await service.from("module_entitlements")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "active");
    if (entitlements.error || entitlements.count !== 1) fail("Verification replay created an invalid entitlement count.");
    const confirmationReplay = await service.from("transactional_email_events")
      .select("id", { count: "exact" })
      .eq("event_key", `payment_success:${initializedBody.reference}`);
    if (confirmationReplay.error || confirmationReplay.count !== 1 || confirmationReplay.data[0]?.id !== queuedConfirmation.data.id) {
      fail("Verification replay cloned the payment confirmation email event.");
    }

    const bundleEmail = `bundle-edge-${crypto.randomUUID()}@example.test`;
    const bundleUser = await service.auth.admin.createUser({
      email: bundleEmail,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Bundle Edge Candidate" },
    });
    if (bundleUser.error || !bundleUser.data.user) {
      fail(`Could not create the bundle payment candidate: ${bundleUser.error?.message ?? "unknown error"}`);
    }
    bundleTestUserIds.push(bundleUser.data.user.id);
    const bundleCandidate = createClient(apiUrl, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: WebSocket },
    });
    const bundleLogin = await bundleCandidate.auth.signInWithPassword({ email: bundleEmail, password: TEST_PASSWORD });
    if (bundleLogin.error || !bundleLogin.data.session) fail("Bundle payment candidate could not sign in.");
    const bundleToken = bundleLogin.data.session.access_token;
    const bundleUserId = bundleLogin.data.user.id;
    resetLocalEdgeRateLimits([bundleUserId]);

    const bundleModuleCatalog = await bundleCandidate.rpc("get_module_access_catalog_v2");
    if (bundleModuleCatalog.error) fail(`Bundle module catalogue failed: ${bundleModuleCatalog.error.message}`);
    const bundleModules = bundleModuleCatalog.data.filter((module) => module.can_purchase && !module.has_module_access).slice(0, 3);
    if (bundleModules.length !== 3) fail("The edge bundle test requires three purchasable module fixtures.");
    const separatePrice = bundleModules.reduce((total, module) => total + Number(module.price_kobo), 0);
    const bundlePrice = Math.max(1, Math.floor(separatePrice * 0.6));
    const createdOffer = await service.from("purchase_offers").insert({
      exam_pack_id: activePack.data.id,
      name: "Edge Any 3",
      offer_type: "pick_n_modules",
      selection_count: 3,
      price_kobo: bundlePrice,
      currency: "NGN",
      enabled: true,
    }).select("id").single();
    if (createdOffer.error || !createdOffer.data) fail(`Could not create bundle fixture: ${createdOffer.error?.message}`);
    bundleTestOfferIds.push(createdOffer.data.id);

    const visibleBundles = await bundleCandidate.rpc("get_bundle_offer_catalog");
    if (visibleBundles.error || !visibleBundles.data.some((offer) => offer.offer_id === createdOffer.data.id)) {
      fail("The enabled choose-three offer was not visible to an eligible candidate.");
    }

    const initializedBundle = await invoke(apiUrl, "initialize-paystack-payment", bundleToken, {
      purchase_type: "bundle_offer",
      purchase_offer_id: createdOffer.data.id,
      subject_slugs: bundleModules.map((module) => module.subject_slug),
      expected_price_kobo: bundlePrice,
    });
    if (!initializedBundle.ok) fail(`Bundle payment initialization failed: ${await initializedBundle.text()}`);
    const initializedBundleBody = await initializedBundle.json();
    const verifiedBundle = await invoke(apiUrl, "verify-paystack-payment", bundleToken, {
      reference: initializedBundleBody.reference,
    });
    if (!verifiedBundle.ok) fail(`Bundle payment verification failed: ${await verifiedBundle.text()}`);
    const verifiedBundleBody = await verifiedBundle.json();
    if (verifiedBundleBody.purchase_type !== "bundle_offer" || verifiedBundleBody.unlocked_count !== 3) {
      fail("Bundle verification did not report all three unlocked modules.");
    }
    const bundleOrder = await service.from("payment_orders")
      .select("id, fulfillment_status, payment_order_items(count)")
      .eq("provider_reference", initializedBundleBody.reference)
      .single();
    const bundleEntitlements = await service.from("module_entitlements")
      .select("id", { count: "exact", head: true })
      .eq("payment_order_id", bundleOrder.data?.id);
    if (
      bundleOrder.error
      || bundleOrder.data.fulfillment_status !== "fulfilled"
      || bundleOrder.data.payment_order_items?.[0]?.count !== 3
      || bundleEntitlements.error
      || bundleEntitlements.count !== 3
    ) {
      fail("Bundle payment did not persist one order with three fulfilled items.");
    }

    const durationPrice = await service.from("purchase_plan_prices")
      .select("price_kobo, purchase_plans!inner(code)")
      .eq("purchase_plans.code", "individual_objective")
      .eq("duration_months", 2)
      .eq("enabled", true)
      .single();
    if (durationPrice.error || !durationPrice.data) {
      fail(`Duration pricing fixture is missing: ${durationPrice.error?.message ?? "unknown error"}`);
    }
    const heldSubjectSlug = bundleModules.find((module) => module.practice_type !== "oral")?.subject_slug;
    if (!heldSubjectSlug) fail("The held-module checkout test requires an objective module.");

    const initializedExtension = await invoke(apiUrl, "initialize-paystack-payment", bundleToken, {
      purchase_type: "pricing_plan",
      plan_code: "individual_objective",
      duration_months: 2,
      subject_slugs: [heldSubjectSlug],
      expected_price_kobo: Number(durationPrice.data.price_kobo),
    });
    if (!initializedExtension.ok) {
      fail(`Duration extension initialization failed: ${await initializedExtension.text()}`);
    }
    const initializedExtensionBody = await initializedExtension.json();

    const disabledHistoricalDuration = await invoke(apiUrl, "initialize-paystack-payment", bundleToken, {
      purchase_type: "pricing_plan",
      plan_code: "individual_objective",
      duration_months: 6,
      subject_slugs: [heldSubjectSlug],
      expected_price_kobo: 1100000,
    });
    if (disabledHistoricalDuration.ok) {
      fail("A disabled historical duration was accepted for new checkout.");
    }
    const verifiedExtension = await invoke(apiUrl, "verify-paystack-payment", bundleToken, {
      reference: initializedExtensionBody.reference,
    });
    if (!verifiedExtension.ok) {
      fail(`Duration extension verification failed: ${await verifiedExtension.text()}`);
    }
    const extensionOrder = await service.from("payment_orders")
      .select("id, amount_kobo, currency")
      .eq("provider_reference", initializedExtensionBody.reference)
      .single();
    if (extensionOrder.error || !extensionOrder.data) fail("Verified extension order was not persisted.");
    const extensionOutcomes = await service.from("payment_order_item_access_outcomes")
      .select("id, effect_state")
      .eq("payment_order_id", extensionOrder.data.id);
    if (extensionOutcomes.error || extensionOutcomes.data.length !== 1 || extensionOutcomes.data[0].effect_state !== "effective") {
      fail("Verified duration extension did not create one effective access outcome.");
    }

    const openedDispute = await sendPaystackEvent({
      event: "charge.dispute.create",
      data: {
        id: `DSP-${crypto.randomUUID()}`,
        status: "pending",
        domain: "test",
        transaction: {
          domain: "test",
          status: "success",
          reference: initializedExtensionBody.reference,
          amount: extensionOrder.data.amount_kobo,
          currency: extensionOrder.data.currency,
        },
      },
    });
    if (!openedDispute.ok) fail(`Signed extension dispute was rejected: ${await openedDispute.text()}`);

    const blockedCheckout = await invoke(apiUrl, "initialize-paystack-payment", bundleToken, {
      purchase_type: "pricing_plan",
      plan_code: "individual_objective",
      duration_months: 2,
      subject_slugs: [heldSubjectSlug],
      expected_price_kobo: Number(durationPrice.data.price_kobo),
    });
    const blockedCheckoutBody = await blockedCheckout.json();
    if (
      blockedCheckout.status !== 409
      || blockedCheckoutBody.code !== "MODULE_ACCESS_UNDER_REVIEW"
    ) {
      fail(`Held module checkout did not return the stable restriction: ${JSON.stringify(blockedCheckoutBody)}`);
    }

    const resolvedDispute = await sendPaystackEvent({
      event: "charge.dispute.resolve",
      data: {
        id: `DSP-${crypto.randomUUID()}`,
        status: "resolved",
        resolution: "declined",
        domain: "test",
        transaction: {
          domain: "test",
          status: "success",
          reference: initializedExtensionBody.reference,
          amount: extensionOrder.data.amount_kobo,
          currency: extensionOrder.data.currency,
        },
      },
    });
    if (!resolvedDispute.ok) fail(`Signed extension dispute resolution was rejected: ${await resolvedDispute.text()}`);

    await service.from("purchase_offers").update({ enabled: false }).eq("id", createdOffer.data.id);
    await service.auth.admin.deleteUser(bundleUserId);

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
    const harmlessSignature = await createPaystackSignature(harmlessEvent, "sk_test_local-edge-payment-secret");
    const harmlessWebhook = await invoke(apiUrl, "paystack-webhook", null, harmlessEvent, {
      "x-paystack-signature": harmlessSignature,
    });
    if (!harmlessWebhook.ok) fail(`Valid harmless webhook was rejected: ${await harmlessWebhook.text()}`);

    const wrongEnvironmentEvent = JSON.stringify({
      event: "charge.success",
      data: { status: "success", domain: "live", reference: "PS-WRONG-ENVIRONMENT" },
    });
    const wrongEnvironmentSignature = await createPaystackSignature(
      wrongEnvironmentEvent,
      "sk_test_local-edge-payment-secret",
    );
    const wrongEnvironmentWebhook = await invoke(apiUrl, "paystack-webhook", null, wrongEnvironmentEvent, {
      "x-paystack-signature": wrongEnvironmentSignature,
    });
    if (wrongEnvironmentWebhook.status !== 400) fail("Mismatched Paystack environment was not rejected.");

    const event = JSON.stringify({
      event: "charge.success",
      data: {
        status: "success",
        domain: "test",
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
    const signature = await createPaystackSignature(event, "sk_test_local-edge-payment-secret");
    const webhook = await invoke(apiUrl, "paystack-webhook", null, event, { "x-paystack-signature": signature });
    if (!webhook.ok) fail(`Valid webhook replay failed: ${await webhook.text()}`);
    const webhookConfirmationReplay = await service.from("transactional_email_events")
      .select("id", { count: "exact" })
      .eq("event_key", `payment_success:${initializedBody.reference}`);
    if (webhookConfirmationReplay.error || webhookConfirmationReplay.count !== 1) {
      fail("Verification and payment-webhook race cloned the confirmation email event.");
    }

    const invalidRefundWebhook = await sendPaystackEvent({
      event: "refund.processed",
      data: {
        status: "processed",
        domain: "test",
        transaction_reference: initializedBody.reference,
        refund_reference: "RF-INVALID",
        amount: "250001",
        currency: "USD",
      },
    });
    if (invalidRefundWebhook.status !== 400) fail("An invalid refund amount and currency were accepted.");

    const pendingRefundWebhook = await sendPaystackEvent({
      event: "refund.pending",
      data: {
        status: "pending",
        domain: "test",
        transaction_reference: initializedBody.reference,
        refund_reference: "RF-PARTIAL-1",
        amount: "100000",
        currency: "NGN",
      },
    });
    if (!pendingRefundWebhook.ok) fail(`Pending refund webhook failed: ${await pendingRefundWebhook.text()}`);
    const pendingRefundOrder = await service.from("payment_orders")
      .select("review_status")
      .eq("provider_reference", initializedBody.reference)
      .single();
    if (pendingRefundOrder.data?.review_status !== "refund_pending") {
      fail("A pending refund was not surfaced for review.");
    }

    const partialRefund = {
      event: "refund.processed",
      data: {
        status: "processed",
        domain: "test",
        transaction_reference: initializedBody.reference,
        refund_reference: "RF-PARTIAL-1",
        amount: "100000",
        currency: "NGN",
        customer: { email: "must-not-be-stored@example.test" },
      },
    };
    const partialRefundWebhook = await sendPaystackEvent(partialRefund);
    if (!partialRefundWebhook.ok) fail(`Partial refund webhook failed: ${await partialRefundWebhook.text()}`);
    const partialOrder = await service.from("payment_orders")
      .select("id, user_id, exam_pack_id, subject_id, module_offering_id, review_status, refunded_amount_kobo")
      .eq("provider_reference", initializedBody.reference)
      .single();
    const partialAccess = await service.from("module_entitlements")
      .select("status")
      .eq("payment_order_id", partialOrder.data.id)
      .single();
    if (
      partialOrder.error ||
      partialOrder.data.review_status !== "partially_refunded" ||
      partialOrder.data.refunded_amount_kobo !== 100000 ||
      partialAccess.error ||
      partialAccess.data.status !== "active"
    ) {
      fail("A partial refund did not preserve access and record the refunded amount.");
    }

    const partialReplay = await sendPaystackEvent(partialRefund);
    if (!partialReplay.ok) fail(`Partial refund replay failed: ${await partialReplay.text()}`);
    const replayedRefund = await service.from("payment_orders")
      .select("refunded_amount_kobo")
      .eq("id", partialOrder.data.id)
      .single();
    if (replayedRefund.error || replayedRefund.data.refunded_amount_kobo !== 100000) {
      fail("A repeated refund webhook was counted more than once.");
    }

    const finalRefundWebhook = await sendPaystackEvent({
      event: "refund.processed",
      data: {
        status: "processed",
        domain: "test",
        transaction_reference: initializedBody.reference,
        refund_reference: "RF-PARTIAL-2",
        amount: "150000",
        currency: "NGN",
      },
    });
    if (!finalRefundWebhook.ok) fail(`Final refund webhook failed: ${await finalRefundWebhook.text()}`);
    const fullyRefundedOrder = await service.from("payment_orders")
      .select("status, provider_status, fulfillment_status, review_status, refunded_amount_kobo")
      .eq("id", partialOrder.data.id)
      .single();
    const revokedAccess = await service.from("module_entitlements")
      .select("status")
      .eq("payment_order_id", partialOrder.data.id)
      .single();
    if (
      fullyRefundedOrder.error ||
      fullyRefundedOrder.data.status !== "expired" ||
      fullyRefundedOrder.data.provider_status !== "reversed" ||
      fullyRefundedOrder.data.fulfillment_status !== "revoked" ||
      fullyRefundedOrder.data.review_status !== "refunded" ||
      fullyRefundedOrder.data.refunded_amount_kobo !== 250000 ||
      revokedAccess.error ||
      revokedAccess.data.status !== "expired"
    ) {
      fail("Cumulative full refunds did not revoke access atomically.");
    }
    const storedRefundEvent = await service.from("payment_provider_events")
      .select("payload")
      .eq("payment_order_id", partialOrder.data.id)
      .eq("event_type", "refund.processed")
      .eq("provider_object_key", "RF-PARTIAL-1")
      .single();
    if (storedRefundEvent.error || JSON.stringify(storedRefundEvent.data.payload).includes("must-not-be-stored")) {
      fail("Refund event persistence retained customer information.");
    }

    const disputeReference = `PS-DISPUTE-${crypto.randomUUID()}`;
    const disputeOrder = await service.from("payment_orders").insert({
      user_id: partialOrder.data.user_id,
      exam_pack_id: partialOrder.data.exam_pack_id,
      subject_id: partialOrder.data.subject_id,
      module_offering_id: partialOrder.data.module_offering_id,
      provider_reference: disputeReference,
      status: "active",
      amount_kobo: 250000,
      currency: "NGN",
      provider_status: "success",
      fulfillment_status: "fulfilled",
      paid_at: new Date().toISOString(),
    }).select("id").single();
    if (disputeOrder.error) fail(`Dispute fixture order failed: ${disputeOrder.error.message}`);
    const disputeItem = await service.from("payment_order_items").insert({
      payment_order_id: disputeOrder.data.id,
      subject_id: partialOrder.data.subject_id,
      module_offering_id: partialOrder.data.module_offering_id,
      list_price_kobo: 250000,
      allocated_amount_kobo: 250000,
    });
    if (disputeItem.error) fail(`Dispute fixture item failed: ${disputeItem.error.message}`);
    const disputeEntitlement = await service.from("module_entitlements").insert({
      user_id: partialOrder.data.user_id,
      exam_pack_id: partialOrder.data.exam_pack_id,
      subject_id: partialOrder.data.subject_id,
      payment_order_id: disputeOrder.data.id,
      status: "active",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    if (disputeEntitlement.error) fail(`Dispute fixture entitlement failed: ${disputeEntitlement.error.message}`);

    const disputeData = {
      id: 7001,
      status: "pending",
      domain: "test",
      reason: "not recognized",
      transaction: {
        domain: "test",
        status: "success",
        reference: disputeReference,
        amount: 250000,
        currency: "NGN",
      },
    };
    const disputeOpened = await sendPaystackEvent({ event: "charge.dispute.create", data: disputeData });
    if (!disputeOpened.ok) fail(`Dispute webhook failed: ${await disputeOpened.text()}`);
    const suspendedOrder = await service.from("payment_orders").select("review_status").eq("id", disputeOrder.data.id).single();
    const suspendedAccess = await service.from("module_entitlements").select("status").eq("payment_order_id", disputeOrder.data.id).single();
    if (suspendedOrder.data?.review_status !== "disputed" || suspendedAccess.data?.status !== "pending") {
      fail("An open dispute did not suspend module access.");
    }

    const disputeDeclined = await sendPaystackEvent({
      event: "charge.dispute.resolve",
      data: { ...disputeData, status: "resolved", resolution: "declined" },
    });
    if (!disputeDeclined.ok) fail(`Resolved dispute webhook failed: ${await disputeDeclined.text()}`);
    const restoredOrder = await service.from("payment_orders").select("review_status").eq("id", disputeOrder.data.id).single();
    const restoredAccess = await service.from("module_entitlements").select("status").eq("payment_order_id", disputeOrder.data.id).single();
    if (restoredOrder.data?.review_status !== "dispute_resolved" || restoredAccess.data?.status !== "active") {
      fail("A declined dispute did not restore valid module access.");
    }

    const acceptedDisputeData = { ...disputeData, id: 7002 };
    const secondDisputeOpened = await sendPaystackEvent({ event: "charge.dispute.create", data: acceptedDisputeData });
    if (!secondDisputeOpened.ok) fail(`Second dispute webhook failed: ${await secondDisputeOpened.text()}`);
    const disputeAccepted = await sendPaystackEvent({
      event: "charge.dispute.resolve",
      data: { ...acceptedDisputeData, status: "resolved", resolution: "merchant-accepted" },
    });
    if (!disputeAccepted.ok) fail(`Accepted dispute webhook failed: ${await disputeAccepted.text()}`);
    const acceptedOrder = await service.from("payment_orders")
      .select("status, fulfillment_status, review_status")
      .eq("id", disputeOrder.data.id)
      .single();
    const acceptedAccess = await service.from("module_entitlements")
      .select("status")
      .eq("payment_order_id", disputeOrder.data.id)
      .single();
    if (
      acceptedOrder.data?.status !== "expired" ||
      acceptedOrder.data?.fulfillment_status !== "revoked" ||
      acceptedOrder.data?.review_status !== "dispute_resolved" ||
      acceptedAccess.data?.status !== "expired"
    ) {
      fail("An accepted dispute did not revoke module access.");
    }

    console.log("Edge payment integration passed: payment, refund, dispute, replay, and webhook security lifecycles.");
  } finally {
    if (cleanupService) {
      for (const userIdToDelete of bundleTestUserIds) {
        await cleanupService.auth.admin.deleteUser(userIdToDelete).catch(() => null);
      }
      if (bundleTestOfferIds.length > 0) {
        await cleanupService.from("purchase_offers").delete().in("id", bundleTestOfferIds);
      }
    }
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
