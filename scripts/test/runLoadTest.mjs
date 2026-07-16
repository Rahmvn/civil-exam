import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import globalSetup from "../../tests/e2e/global-setup.js";
import { TEST_PASSWORD, TEST_USERS } from "../../tests/e2e/test-data.js";

const fullRun = process.argv.includes("--full");
const soakRun = process.argv.includes("--soak");
const outputPath = "test-results/load-test-report.json";

function fail(message) {
  throw new Error(message);
}

function parseEnvironment(output) {
  return Object.fromEntries(
    output.split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(?:"(.*)"|(.*))$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2] ?? match[3] ?? ""]),
  );
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

  const hostname = new URL(apiUrl).hostname;
  if (!['127.0.0.1', 'localhost'].includes(hostname)) {
    fail("Load tests refused to run because Supabase is not local.");
  }
  return { apiUrl, publicKey, secretKey };
}

function percentile(values, percentileValue) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1)];
}

async function measured(label, factory) {
  const started = performance.now();
  try {
    const result = await factory();
    if (result?.error) throw result.error;
    return { label, durationMs: performance.now() - started, ok: true };
  } catch (error) {
    return {
      label,
      durationMs: performance.now() - started,
      ok: false,
      error: String(error?.message ?? error).slice(0, 300),
    };
  }
}

function summarize(name, concurrency, iterations, elapsedMs, results, budgetMs) {
  const durations = results.map((result) => result.durationMs);
  const failures = results.filter((result) => !result.ok);
  const errorRate = results.length ? failures.length / results.length : 1;
  const p95 = percentile(durations, 95);
  const p99 = percentile(durations, 99);
  const summary = {
    name,
    concurrency,
    iterations,
    requests: results.length,
    failures: failures.length,
    errorRate,
    elapsedMs,
    requestsPerSecond: results.length / (elapsedMs / 1000),
    minMs: Math.min(...durations),
    medianMs: percentile(durations, 50),
    p95Ms: p95,
    p99Ms: p99,
    maxMs: Math.max(...durations),
    budgetMs,
    passed: errorRate <= 0.01 && p95 <= budgetMs && p99 <= 8000,
    sampleErrors: [...new Set(failures.map((failure) => failure.error))].slice(0, 5),
    operations: Object.fromEntries([...new Set(results.map((result) => result.label))].map((label) => {
      const operationResults = results.filter((result) => result.label === label);
      const operationDurations = operationResults.map((result) => result.durationMs);
      return [label, {
        requests: operationResults.length,
        failures: operationResults.filter((result) => !result.ok).length,
        medianMs: percentile(operationDurations, 50),
        p95Ms: percentile(operationDurations, 95),
        p99Ms: percentile(operationDurations, 99),
        maxMs: Math.max(...operationDurations),
      }];
    })),
  };
  return summary;
}

async function runStage({ name, concurrency, iterations = 1, durationMs = 0, budgetMs, operations }) {
  const results = [];
  const started = performance.now();

  let round = 0;
  do {
    const roundResults = await Promise.all(Array.from({ length: concurrency }, (_, index) => {
      const operation = operations[(round * concurrency + index) % operations.length];
      return measured(operation.label, operation.run);
    }));
    results.push(...roundResults);
    round += 1;
  } while (round < iterations || (durationMs > 0 && performance.now() - started < durationMs));

  return summarize(name, concurrency, round, performance.now() - started, results, budgetMs);
}

async function signIn(client, email) {
  const { data, error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error || !data.session) fail(`Load test sign-in failed for ${email}: ${error?.message ?? "no session"}`);
}

function printSummary(summary) {
  const status = summary.passed ? "PASS" : "FAIL";
  process.stdout.write(
    `${status} ${summary.name}: ${summary.requests} requests, ${summary.failures} failures, `
      + `${summary.requestsPerSecond.toFixed(1)} req/s, p50 ${summary.medianMs.toFixed(1)} ms, `
      + `p95 ${summary.p95Ms.toFixed(1)} ms, p99 ${summary.p99Ms.toFixed(1)} ms\n`,
  );
}

async function main() {
  const { apiUrl, publicKey, secretKey } = localEnvironment();
  process.env.E2E_LOCAL_SUPABASE = "true";
  process.env.E2E_SUPABASE_URL = apiUrl;
  process.env.E2E_SUPABASE_PUBLIC_KEY = publicKey;
  process.env.E2E_SUPABASE_SECRET_KEY = secretKey;

  await globalSetup();

  const clientOptions = {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket },
  };
  const poolSize = fullRun || soakRun ? 12 : 5;
  const paidClients = Array.from({ length: poolSize }, () => createClient(apiUrl, publicKey, clientOptions));
  const paidClient = paidClients[0];
  const adminClient = createClient(apiUrl, publicKey, clientOptions);
  const serviceClient = createClient(apiUrl, secretKey, {
    ...clientOptions,
    realtime: { transport: WebSocket },
  });
  await Promise.all(paidClients.map((client) => signIn(client, TEST_USERS.paid.email)));
  await signIn(adminClient, TEST_USERS.admin.email);

  const candidateOperations = paidClients.flatMap((client) => [
    { label: "candidate-summary", run: () => client.rpc("get_candidate_summary") },
    { label: "module-catalog", run: () => client.rpc("get_module_access_catalog") },
    { label: "module-progress", run: () => client.rpc("get_module_progress") },
    { label: "objective-set-access", run: () => client.rpc("get_module_batch_access") },
    { label: "oral-set-access", run: () => client.rpc("get_oral_practice_set_access") },
    { label: "objective-practice-start", run: () => client.rpc("start_practice_batch", {
      requested_subject_slug: "public-financial-management",
      requested_batch_number: 1,
    }) },
  ]);

  for (const operation of candidateOperations) {
    const warmup = await operation.run();
    if (warmup.error) fail(`Warmup failed for ${operation.label}: ${warmup.error.message}`);
  }

  const stages = soakRun
    ? [{ name: "candidate-read-soak", concurrency: 50, durationMs: 45 * 60 * 1000, budgetMs: 3000 }]
    : fullRun
    ? [
        { name: "candidate-read-25", concurrency: 25, iterations: 4, budgetMs: 2000 },
        { name: "candidate-read-100", concurrency: 100, iterations: 3, budgetMs: 3000 },
        { name: "candidate-read-250", concurrency: 250, iterations: 2, budgetMs: 5000 },
        { name: "candidate-read-spike-300", concurrency: 300, iterations: 1, budgetMs: 6000 },
      ]
    : [
        { name: "candidate-read-10", concurrency: 10, iterations: 3, budgetMs: 1500 },
        { name: "candidate-read-25", concurrency: 25, iterations: 3, budgetMs: 2000 },
        { name: "candidate-read-50", concurrency: 50, iterations: 2, budgetMs: 2500 },
      ];

  const summaries = [];
  for (const stage of stages) {
    summaries.push(await runStage({ ...stage, operations: candidateOperations }));
  }

  const modules = await adminClient.rpc("get_admin_content_modules_v2");
  if (modules.error || !modules.data?.[0]) fail(`Admin load fixture failed: ${modules.error?.message ?? "no modules"}`);
  const subjectId = modules.data[0].subject_id;
  const adminOperations = [
    { label: "admin-modules", run: () => adminClient.rpc("get_admin_content_modules_v2") },
    { label: "admin-sets", run: () => adminClient.rpc("get_admin_practice_sets_v2", { requested_subject_id: subjectId }) },
    { label: "admin-activity", run: () => adminClient.from("admin_audit_logs").select("id,action,entity_type,created_at").limit(50) },
  ];
  summaries.push(await runStage({
    name: "admin-read-25",
    concurrency: 25,
    iterations: fullRun ? 4 : 2,
    budgetMs: 2500,
    operations: adminOperations,
  }));

  const objectiveSubject = await serviceClient.from("subjects")
    .select("id")
    .eq("slug", "public-financial-management")
    .single();
  if (objectiveSubject.error) fail(`Objective load fixture failed: ${objectiveSubject.error.message}`);
  const objectiveQuestions = await serviceClient.from("questions")
    .select("id,correct_option,batch_position")
    .eq("subject_id", objectiveSubject.data.id)
    .eq("batch_number", 1)
    .eq("status", "published")
    .order("batch_position");
  if (objectiveQuestions.error || !objectiveQuestions.data?.length) {
    fail(`Objective submission fixture failed: ${objectiveQuestions.error?.message ?? "no questions"}`);
  }
  const submittedAnswers = objectiveQuestions.data.map((question) => ({
    question_id: question.id,
    selected_option: question.correct_option,
    display_order: question.batch_position,
    option_order: ["A", "B", "C", "D"],
  }));
  const submissionOperations = paidClients.map((client) => ({
    label: "objective-attempt-submit",
    run: () => client.rpc("submit_attempt", {
      submitted_mode: "timed_mock",
      submitted_subject_id: objectiveSubject.data.id,
      submitted_answers: submittedAnswers,
      submitted_batch_number: 1,
    }),
  }));
  summaries.push(await runStage({
    name: "objective-submit-contention",
    concurrency: fullRun || soakRun ? 25 : 10,
    iterations: 1,
    budgetMs: 4000,
    operations: submissionOperations,
  }));

  const oralStart = await paidClient.rpc("start_or_resume_oral_attempt", {
    requested_subject_slug: "e2e-oral-questions",
    requested_set_number: 1,
    requested_seconds_per_question: 180,
  });
  if (oralStart.error) fail(`Oral autosave setup failed: ${oralStart.error.message}`);
  const attemptId = oralStart.data.attempt_id;
  const questionId = oralStart.data.current_question.id;
  const autosaveOperations = Array.from({ length: 10 }, (_, index) => ({
    label: "oral-autosave",
    run: () => paidClient.rpc("save_oral_response_draft", {
      requested_attempt_id: attemptId,
      requested_question_id: questionId,
      requested_response_text: `Concurrent autosave payload ${index}`,
    }),
  }));
  summaries.push(await runStage({
    name: "oral-autosave-hot-row",
    concurrency: fullRun ? 50 : 20,
    iterations: 1,
    budgetMs: 3000,
    operations: autosaveOperations,
  }));
  const cleanup = await serviceClient.from("oral_attempts").delete().eq("id", attemptId);
  if (cleanup.error) fail(`Oral autosave cleanup failed: ${cleanup.error.message}`);

  summaries.forEach(printSummary);
  const report = {
    generatedAt: new Date().toISOString(),
    target: apiUrl,
    profile: soakRun ? "soak" : fullRun ? "full" : "smoke",
    localOnly: true,
    authenticatedClientPool: poolSize,
    uniqueCandidateIdentities: 1,
    identityNote: "Local regression uses isolated clients sharing one deterministic paid identity; staging capacity tests must use multiple identities.",
    paymentEndpointsExcluded: true,
    passed: summaries.every((summary) => summary.passed),
    stages: summaries,
  };
  await mkdir("test-results", { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`Load report: ${outputPath}\n`);
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
