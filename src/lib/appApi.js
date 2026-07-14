import { supabase } from "./supabaseClient";
import { EXAM_MODULES, NIGERIA_STATES, SERVICE_LEVELS } from "./catalog";
import { readWithPolicy } from "./requestPolicy";

export const DIFFICULTIES = ["easy", "medium", "hard"];
export const QUESTION_STATUSES = ["draft", "review", "published"];

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function requireData({ data, error }) {
  if (error) {
    throw error;
  }

  return data;
}

export { NIGERIA_STATES, SERVICE_LEVELS };

export async function getProfile(userId) {
  return readWithPolicy(`profile:${userId}`, async () => requireData(
    await supabase
      .from("profiles")
      .select(
        "id, email, full_name, phone_number, state_code, service_level, organization_name, onboarding_completed_at, role, created_at",
      )
      .eq("id", userId)
      .maybeSingle(),
  ));
}

export async function ensureMyProfile() {
  const row = await readWithPolicy("profile:ensure-mine", async () =>
    requireData(await supabase.rpc("ensure_my_profile")),
  );
  return row ?? null;
}

export async function updateProfile(userId, updates) {
  const selectClause =
    "id, email, full_name, phone_number, state_code, service_level, organization_name, onboarding_completed_at, role, created_at";

  let result = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select(selectClause)
    .maybeSingle();

  if (!result.error && result.data) {
    return result.data;
  }

  if (!result.error && !result.data) {
    await ensureMyProfile();

    result = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", userId)
      .select(selectClause)
      .maybeSingle();

    if (!result.error && result.data) {
      return result.data;
    }
  }

  return requireData(result);
}

export async function getCandidateSummary() {
  const rows = await readWithPolicy("candidate-summary", async () =>
    requireData(await supabase.rpc("get_candidate_summary")),
  );
  return rows?.[0] ?? null;
}

export async function getPaymentRecords(limit = 10) {
  return readWithPolicy(`payment-records:${limit}`, async () => {
    const rows = ensureArray(requireData(
      await supabase.rpc("get_payment_history", { requested_limit: limit }),
    ));

    return rows.map((row) => ({
      ...row,
      paystack_reference: row.provider_reference,
      expires_at: row.access_expires_at,
    }));
  });
}

export async function getModuleAccessCatalog() {
  return readWithPolicy("module-access-catalog", async () => ensureArray(requireData(
    await supabase.rpc("get_module_access_catalog"),
  )));
}

export async function getSubjects() {
  const rows = await readWithPolicy("subjects", async () => requireData(
    await supabase
      .from("subjects")
      .select("id, slug, name, description, sort_order, batch_size, pass_mark_percent")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ));

  return ensureArray(rows).length > 0 ? rows : EXAM_MODULES;
}

export async function getModuleProgress() {
  return readWithPolicy("module-progress", async () =>
    ensureArray(requireData(await supabase.rpc("get_module_progress"))),
  );
}

export async function getModuleBatchAccess(subjectSlug = null) {
  const payload = {};

  if (subjectSlug) {
    payload.requested_subject_slug = subjectSlug;
  }

  return readWithPolicy(`module-batch-access:${subjectSlug ?? "all"}`, async () =>
    ensureArray(requireData(await supabase.rpc("get_module_batch_access", payload))),
  );
}

export async function getModuleAvailability() {
  const rows = await getModuleProgress();

  return rows.map((row) => ({
    subject_id: row.subject_id,
    subject_slug: row.subject_slug,
    has_content: Boolean(row.has_questions),
    is_prepared: Boolean(row.has_questions),
  }));
}

export async function getRecentAttempts(limit = 6) {
  return readWithPolicy(`recent-attempts:${limit}`, async () => ensureArray(requireData(
    await supabase
      .from("attempts")
      .select(
        "id, mode, score, total_questions, completed_at, started_at, service_level, batch_number, score_percent, passed, retry_number, subjects(name, slug)",
      )
      .order("started_at", { ascending: false })
      .limit(limit),
  )));
}

export async function getReviewQueue(limit = 12) {
  return readWithPolicy(`review-queue:${limit}`, async () =>
    ensureArray(requireData(await supabase.rpc("get_review_queue", { requested_limit: limit }))),
  );
}

export async function getQueueAttemptMatches(questionIds = []) {
  const normalizedIds = [...new Set(questionIds.map(String).filter(Boolean))].sort();
  if (normalizedIds.length === 0) return [];

  return readWithPolicy(`queue-attempt-matches:${normalizedIds.join(",")}`, async () => ensureArray(requireData(
    await supabase
      .from("attempt_answers")
      .select("attempt_id, question_id, answered_at")
      .in("question_id", normalizedIds)
      .order("answered_at", { ascending: false })
      .limit(100),
  )));
}

export async function getAttemptReview(attemptId = null) {
  return readWithPolicy(`attempt-review:${attemptId ?? "latest"}`, async () => ensureArray(requireData(
    await supabase.rpc("get_attempt_review", {
      requested_attempt_id: attemptId,
    }),
  )));
}

export async function getPracticeQuestions({ subjectId, limit = 30, batchNumber = null }) {
  if (!subjectId) return [];

  const payload = {
    requested_subject_id: subjectId,
  };

  if (typeof limit === "number") {
    payload.requested_limit = limit;
  }

  if (typeof batchNumber === "number" && Number.isFinite(batchNumber)) {
    payload.requested_batch_number = batchNumber;
  }

  return readWithPolicy(
    `practice-questions:${subjectId}:${batchNumber ?? "next"}:${limit ?? "all"}`,
    async () => ensureArray(requireData(await supabase.rpc("get_practice_questions", payload))),
  );
}

export async function startPracticeBatch(subjectSlug, batchNumber = null) {
  if (!subjectSlug) return [];

  const payload = {
    requested_subject_slug: subjectSlug,
  };

  if (typeof batchNumber === "number" && Number.isFinite(batchNumber)) {
    payload.requested_batch_number = batchNumber;
  }

  return ensureArray(requireData(await supabase.rpc("start_practice_batch", payload)));
}

export async function submitAttempt({ mode, subjectId, answers, batchNumber = null }) {
  const payload = {
    submitted_mode: mode,
    submitted_subject_id: subjectId,
    submitted_answers: answers,
  };

  if (typeof batchNumber === "number" && Number.isFinite(batchNumber)) {
    payload.submitted_batch_number = batchNumber;
  }

  const rows = requireData(
    await supabase.rpc("submit_attempt", payload),
  );

  return rows?.[0] ?? null;
}

export async function initializePayment(subjectSlug) {
  const { data, error } = await supabase.functions.invoke("initialize-paystack-payment", {
    body: { subject_slug: subjectSlug },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  return data;
}

export async function verifyPayment(reference) {
  const { data, error } = await supabase.functions.invoke("verify-paystack-payment", {
    body: { reference },
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  return data;
}

export async function getAdminQuestionCounts() {
  const rows = await readWithPolicy("admin-question-counts", async () =>
    requireData(await supabase.rpc("get_admin_question_counts")),
  );
  return rows?.[0] ?? { draft_count: 0, review_count: 0, published_count: 0 };
}

export async function getAdminQuestions() {
  return readWithPolicy("admin-questions", async () => requireData(
    await supabase
      .from("questions")
      .select(
        "id, question_text, service_level, difficulty, status, explanation, reference_note, source_note, option_a, option_b, option_c, option_d, correct_option, subject_id, batch_number, batch_position, subjects(name, slug)",
      )
      .order("subject_id", { ascending: true })
      .order("batch_number", { ascending: true })
      .order("batch_position", { ascending: true, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(200),
  ));
}

export async function saveQuestion(question, userId) {
  const payload = {
    exam_pack_id: question.exam_pack_id,
    subject_id: question.subject_id,
    service_level: question.service_level || null,
    difficulty: question.difficulty,
    question_text: question.question_text.trim(),
    option_a: question.option_a.trim(),
    option_b: question.option_b.trim(),
    option_c: question.option_c.trim(),
    option_d: question.option_d.trim(),
    correct_option: question.correct_option,
    explanation: question.explanation.trim(),
    reference_note: question.reference_note.trim(),
    source_note: question.source_note.trim(),
    status: question.status,
    batch_number: Number(question.batch_number ?? 1),
    batch_position: question.batch_position ? Number(question.batch_position) : null,
    updated_by: userId,
  };

  if (!question.id) {
    payload.created_by = userId;
  }

  return requireData(
    await supabase
      .from("questions")
      .upsert(question.id ? { id: question.id, ...payload } : payload)
      .select()
      .single(),
  );
}

export async function getAdminAuditLogs() {
  return readWithPolicy("admin-audit-logs", async () => requireData(
    await supabase
      .from("admin_audit_logs")
      .select(
        "id, action, entity_type, entity_id, metadata, created_at, actor:profiles(email, full_name)",
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ));
}

export async function getActivePack() {
  const rows = await readWithPolicy("active-exam-pack", async () => requireData(
    await supabase
      .from("exam_packs")
      .select("id, name, price_kobo, currency, active_until")
      .eq("is_active", true)
      .order("active_from", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1),
  ));

  return rows?.[0] ?? null;
}
