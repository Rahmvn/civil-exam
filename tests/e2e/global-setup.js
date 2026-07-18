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
    await client.from("oral_attempts").delete().eq("user_id", user.id),
    `Clear oral attempts for ${user.email}`,
  );
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

  const attempts = requireResult(
    await client.from("attempts").select("id").in("subject_id", moduleIds),
    "Find admin fixture attempts",
  );
  const attemptIds = attempts.map((attempt) => attempt.id);
  if (attemptIds.length > 0) {
    requireResult(
      await client.from("attempt_answers").delete().in("attempt_id", attemptIds),
      "Clear admin fixture attempt answers",
    );
    requireResult(
      await client.from("attempts").delete().in("id", attemptIds),
      "Clear admin fixture attempts",
    );
  }

  requireResult(
    await client.from("oral_attempts").delete().in("subject_id", moduleIds),
    "Clear admin fixture oral attempts",
  );
  requireResult(
    await client.from("module_entitlements").delete().in("subject_id", moduleIds),
    "Clear admin fixture module entitlements",
  );
  requireResult(
    await client.from("payment_orders").delete().in("subject_id", moduleIds),
    "Clear admin fixture payment orders",
  );
  requireResult(
    await client.from("module_offerings").delete().in("subject_id", moduleIds),
    "Clear admin fixture module offerings",
  );
  requireResult(
    await client.from("oral_questions").update({ status: "archived" }).in("subject_id", moduleIds).eq("status", "published"),
    "Archive admin fixture oral questions",
  );
  requireResult(
    await client.from("questions").update({ status: "archived" }).in("subject_id", moduleIds).eq("status", "published"),
    "Archive admin fixture questions",
  );
  requireResult(
    await client.from("oral_questions").delete().in("subject_id", moduleIds),
    "Clear admin fixture oral questions",
  );
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
    await client.from("questions").update({ status: "archived" }).eq("source_note", FIXTURE_SOURCE).eq("status", "published"),
    "Archive practice fixtures",
  );
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
  rows[0].explanation = "";
  rows[0].reference_note = "";

  requireResult(await client.from("questions").upsert(rows), "Seed practice fixtures");
}

async function seedOralPracticeContent(client, packId) {
  const subject = requireResult(
    await client.from("subjects").insert({
      id: "30000000-0000-4000-8000-000000000001",
      name: "Oral Questions",
      slug: "e2e-oral-questions",
      description: "Timed oral-answer rehearsal with self-review.",
      sort_order: 3,
      is_active: true,
      batch_size: 3,
      pass_mark_percent: 70,
      lifecycle_status: "active",
      practice_type: "oral",
    }).select("id, slug, name, practice_type").single(),
    "Create oral module fixture",
  );

  const practiceSet = requireResult(
    await client.from("practice_sets").insert({
      id: "31000000-0000-4000-8000-000000000001",
      exam_pack_id: packId,
      subject_id: subject.id,
      set_number: 1,
      expected_question_count: 3,
      status: "published",
      published_at: new Date().toISOString(),
      practice_type: "oral",
    }).select("id").single(),
    "Create oral practice set fixture",
  );

  const oralQuestions = [
    {
      id: "32000000-0000-4000-8000-000000000001",
      question_text: "Explain why accountability matters in public service.",
      model_answer: "Accountability makes public officers answerable for decisions, conduct, and the use of public resources.",
      key_points: ["Answerability for decisions", "Responsible use of public resources"],
      reference_note: "Public Service Rules: accountability",
      batch_position: 1,
    },
    {
      id: "32000000-0000-4000-8000-000000000002",
      question_text: "Describe one practical safeguard for public funds.",
      model_answer: "Segregation of duties ensures that one officer does not control authorization, payment, and review.",
      key_points: ["Separate key duties", "Independent authorization or review"],
      reference_note: "Financial Regulations: internal control",
      batch_position: 2,
    },
    {
      id: "32000000-0000-4000-8000-000000000003",
      question_text: "How would you respond to an instruction that conflicts with approved procedure?",
      model_answer: "Clarify the instruction, refer to the approved rule, document the concern, and escalate through the proper channel if necessary.",
      key_points: ["Check the approved rule", "Document the concern", "Use the proper escalation channel"],
      reference_note: "Public Service Rules: lawful instructions",
      batch_position: 3,
    },
  ].map((questionRow) => ({
    ...questionRow,
    exam_pack_id: packId,
    subject_id: subject.id,
    practice_set_id: practiceSet.id,
    difficulty: "medium",
    source_note: FIXTURE_SOURCE,
    status: "published",
  }));

  requireResult(await client.from("oral_questions").insert(oralQuestions), "Seed oral question fixtures");
  return subject;
}

async function seedComingSoonModule(client, packId) {
  const subject = requireResult(
    await client.from("subjects").insert({
      name: "Coming Soon Regression",
      slug: "e2e-coming-soon",
      description: "Lifecycle and entitlement precedence regression fixture.",
      sort_order: 90,
      is_active: true,
      batch_size: 5,
      pass_mark_percent: 70,
      lifecycle_status: "coming_soon",
      practice_type: "objective",
    }).select("id, slug, name, practice_type").single(),
    "Create coming-soon module fixture",
  );

  requireResult(
    await client.from("module_offerings").upsert({
      exam_pack_id: packId,
      subject_id: subject.id,
      price_kobo: 250000,
      currency: "NGN",
      is_active: false,
    }, { onConflict: "exam_pack_id,subject_id" }),
    "Create disabled coming-soon module offer",
  );

  return subject;
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
  const oralSubject = await seedOralPracticeContent(client, packs[0].id);
  const comingSoonSubject = await seedComingSoonModule(client, packs[0].id);
  const allTestSubjects = [...subjects, oralSubject];

  requireResult(
    await client.from("subjects").update({
      lifecycle_status: "active",
      is_active: true,
    }).in("id", allTestSubjects.map((subject) => subject.id)),
    "Activate published test modules",
  );

  requireResult(
    await client.from("module_offerings").upsert(
      allTestSubjects.map((subject) => ({
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
    await client.from("module_entitlements").insert([
      {
        user_id: paidUser.id,
        exam_pack_id: packs[0].id,
        subject_id: paidModule.id,
        status: "active",
        expires_at: "2027-12-31T23:59:59.000Z",
        metadata: { source: "local-e2e" },
      },
      {
        user_id: paidUser.id,
        exam_pack_id: packs[0].id,
        subject_id: oralSubject.id,
        status: "active",
        expires_at: "2027-12-31T23:59:59.000Z",
        metadata: { source: "local-e2e" },
      },
      {
        user_id: paidUser.id,
        exam_pack_id: packs[0].id,
        subject_id: comingSoonSubject.id,
        status: "active",
        expires_at: "2027-12-31T23:59:59.000Z",
        metadata: { source: "local-e2e-coming-soon-regression" },
      },
    ]),
    "Create paid module entitlements",
  );
}
