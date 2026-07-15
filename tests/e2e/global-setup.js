import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { TEST_PASSWORD, TEST_USERS } from "./test-data.js";

const FIXTURE_SOURCE = "E2E local regression fixture";

function requireLocalUrl(value) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("E2E fixture setup refused to use a non-local Supabase project.");
  }
  return value;
}

function requireResult(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

async function findOrCreateUser(client, details) {
  const listed = requireResult(
    await client.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    "List test users",
  );
  const existing = listed.users.find((user) => user.email === details.email);

  if (existing) {
    return requireResult(
      await client.auth.admin.updateUserById(existing.id, {
        email_confirm: true,
        password: TEST_PASSWORD,
        user_metadata: { full_name: details.fullName },
      }),
      `Update ${details.email}`,
    ).user;
  }

  return requireResult(
    await client.auth.admin.createUser({
      email: details.email,
      email_confirm: true,
      password: TEST_PASSWORD,
      user_metadata: { full_name: details.fullName },
    }),
    `Create ${details.email}`,
  ).user;
}

async function resetCandidateData(client, user) {
  const testDetails = Object.values(TEST_USERS).find((details) => details.email === user.email);
  requireResult(
    await client.from("module_entitlements").delete().eq("user_id", user.id),
    `Clear module entitlements for ${user.email}`,
  );
  requireResult(
    await client.from("payment_orders").delete().eq("user_id", user.id),
    `Clear payment orders for ${user.email}`,
  );
  requireResult(
    await client.from("user_module_progress").delete().eq("user_id", user.id),
    `Clear module progress for ${user.email}`,
  );
  requireResult(
    await client.from("attempt_answers").delete().eq("user_id", user.id),
    `Clear attempt answers for ${user.email}`,
  );
  requireResult(
    await client.from("attempts").delete().eq("user_id", user.id),
    `Clear attempts for ${user.email}`,
  );
  requireResult(
    await client.from("entitlements").delete().eq("user_id", user.id),
    `Clear entitlements for ${user.email}`,
  );
  requireResult(
    await client.from("profiles").update({
      full_name: user.user_metadata.full_name,
      organization_name: testDetails?.organizationName ?? null,
      phone_number: testDetails?.phoneNumber ?? null,
      state_code: testDetails?.stateCode ?? null,
      role: "candidate",
    }).eq("id", user.id),
    `Refresh profile for ${user.email}`,
  );
}

async function clearAdminContentFixtures(client) {
  const modules = requireResult(
    await client.from("subjects").select("id").like("slug", "e2e-%"),
    "Find stale admin content fixtures",
  );
  const moduleIds = modules.map((module) => module.id);
  if (moduleIds.length === 0) return;

  requireResult(
    await client.from("questions").delete().in("subject_id", moduleIds),
    "Clear admin fixture questions",
  );
  requireResult(
    await client.from("practice_sets").delete().in("subject_id", moduleIds),
    "Clear admin fixture practice sets",
  );
  requireResult(
    await client.from("subjects").delete().in("id", moduleIds),
    "Clear admin fixture modules",
  );
}

function question(id, subjectId, packId, batchNumber, position, correctOption, text) {
  return {
    id,
    exam_pack_id: packId,
    subject_id: subjectId,
    difficulty: "medium",
    question_text: text,
    option_a: `Option A for question ${position}`,
    option_b: `Option B for question ${position}`,
    option_c: `Option C for question ${position}`,
    option_d: `Option D for question ${position}`,
    correct_option: correctOption,
    explanation: `Option ${correctOption} is correct for this local regression question.`,
    reference_note: "Local automated test fixture",
    source_note: FIXTURE_SOURCE,
    status: "published",
    batch_number: batchNumber,
    batch_position: position,
  };
}

async function seedPracticeContent(client, packId, subjects) {
  requireResult(
    await client.from("questions").delete().eq("source_note", FIXTURE_SOURCE),
    "Clear practice fixtures",
  );

  const pfm = subjects.find((subject) => subject.slug === "public-financial-management");
  const psr = subjects.find((subject) => subject.slug === "public-service-rules");
  if (!pfm || !psr) throw new Error("Required local test modules are missing.");

  const rows = [
    question("10000000-0000-4000-8000-000000000001", pfm.id, packId, 1, 1, "A", "Which record supports accountable public spending?"),
    question("10000000-0000-4000-8000-000000000002", pfm.id, packId, 1, 2, "B", "Which control helps confirm that a payment was authorised?"),
    question("10000000-0000-4000-8000-000000000003", pfm.id, packId, 1, 3, "C", "Which action best supports financial stewardship?"),
    question("10000000-0000-4000-8000-000000000004", pfm.id, packId, 1, 4, "D", "Which document should be checked before committing public funds?"),
    question("10000000-0000-4000-8000-000000000005", pfm.id, packId, 2, 1, "A", "Which practice improves reconciliation quality?"),
    question("10000000-0000-4000-8000-000000000006", pfm.id, packId, 2, 2, "B", "Which record supports an audit trail?"),
    question("20000000-0000-4000-8000-000000000001", psr.id, packId, 1, 1, "A", "Which principle supports impartial public service?"),
    question("20000000-0000-4000-8000-000000000002", psr.id, packId, 1, 2, "B", "Which action follows an approved public service procedure?"),
  ];

  requireResult(await client.from("questions").upsert(rows), "Seed practice fixtures");
}

export default async function globalSetup() {
  const supabaseUrl = requireLocalUrl(process.env.E2E_SUPABASE_URL);
  const secretKey = process.env.E2E_SUPABASE_SECRET_KEY;
  if (!secretKey) throw new Error("The local Supabase secret key is missing.");

  const client = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: WebSocket },
  });

  await clearAdminContentFixtures(client);

  const packs = requireResult(
    await client.from("exam_packs").select("id").eq("is_active", true).order("active_from", { ascending: false }).limit(1),
    "Load active exam pack",
  );
  if (!packs[0]) throw new Error("The local database has no active exam pack. Run `supabase db reset`.");

  const subjects = requireResult(
    await client.from("subjects").select("id, slug").in("slug", ["public-financial-management", "public-service-rules"]),
    "Load test modules",
  );

  const adminUser = await findOrCreateUser(client, TEST_USERS.admin);
  const paidUser = await findOrCreateUser(client, TEST_USERS.paid);
  const freeUser = await findOrCreateUser(client, TEST_USERS.free);
  requireResult(
    await client.from("profiles").update({
      full_name: adminUser.user_metadata.full_name,
      role: "admin",
    }).eq("id", adminUser.id),
    "Configure local admin account",
  );
  await resetCandidateData(client, paidUser);
  await resetCandidateData(client, freeUser);
  await seedPracticeContent(client, packs[0].id, subjects);

  requireResult(
    await client.from("subjects").update({
      lifecycle_status: "active",
      is_active: true,
    }).in("id", subjects.map((subject) => subject.id)),
    "Activate published test modules",
  );

  requireResult(
    await client.from("module_offerings").upsert(
      subjects.map((subject) => ({
        exam_pack_id: packs[0].id,
        subject_id: subject.id,
        price_kobo: 250000,
        currency: "NGN",
        is_active: true,
      })),
      { onConflict: "exam_pack_id,subject_id" },
    ),
    "Create module offers",
  );

  const paidModule = subjects.find((subject) => subject.slug === "public-financial-management");
  if (!paidModule) throw new Error("The paid test module is missing.");

  requireResult(
    await client.from("module_entitlements").insert({
      user_id: paidUser.id,
      exam_pack_id: packs[0].id,
      subject_id: paidModule.id,
      status: "active",
      expires_at: "2027-12-31T23:59:59.000Z",
      metadata: { source: "local-e2e" },
    }),
    "Create paid module entitlement",
  );
}
