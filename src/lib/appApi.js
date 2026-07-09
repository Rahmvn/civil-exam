import { supabase } from "./supabaseClient";
import { EXAM_MODULES, NIGERIA_STATES, SERVICE_LEVELS } from "./catalog";
import { logAppError } from "./errors";

export const DIFFICULTIES = ["easy", "medium", "hard"];
export const QUESTION_STATUSES = ["draft", "review", "published"];

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function requireData({ data, error }) {
  if (error) {
    logAppError("Supabase request", error);
    throw error;
  }

  return data;
}

export { NIGERIA_STATES, SERVICE_LEVELS };

export async function getProfile(userId) {
  return requireData(
    await supabase
      .from("profiles")
      .select(
        "id, email, full_name, phone_number, state_code, service_level, organization_name, onboarding_completed_at, role, created_at",
      )
      .eq("id", userId)
      .maybeSingle(),
  );
}

export async function ensureMyProfile() {
  const row = requireData(await supabase.rpc("ensure_my_profile"));
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
  const rows = requireData(await supabase.rpc("get_candidate_summary"));
  return rows?.[0] ?? null;
}

export async function getSubjects() {
  const rows = requireData(
    await supabase
      .from("subjects")
      .select("id, slug, name, description, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  );

  return ensureArray(rows).length > 0 ? rows : EXAM_MODULES;
}

export async function getModuleProgress() {
  return ensureArray(requireData(await supabase.rpc("get_module_progress")));
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

export async function getRecentAttempts() {
  return ensureArray(requireData(
    await supabase
      .from("attempts")
      .select(
        "id, mode, score, total_questions, completed_at, started_at, service_level, subjects(name, slug)",
      )
      .order("started_at", { ascending: false })
      .limit(6),
  ));
}

export async function getReviewQueue(limit = 12) {
  return ensureArray(requireData(await supabase.rpc("get_review_queue", { requested_limit: limit })));
}

export async function getAttemptReview(attemptId = null) {
  return ensureArray(requireData(
    await supabase.rpc("get_attempt_review", {
      requested_attempt_id: attemptId,
    }),
  ));
}

export async function getPracticeQuestions({ subjectId, limit = 30 }) {
  if (!subjectId) return [];

  const payload = {
    requested_subject_id: subjectId,
  };

  if (typeof limit === "number") {
    payload.requested_limit = limit;
  }

  return ensureArray(requireData(await supabase.rpc("get_practice_questions", payload)));
}

export async function startPracticeBatch(subjectSlug) {
  if (!subjectSlug) return [];

  return ensureArray(requireData(
    await supabase.rpc("start_practice_batch", {
      requested_subject_slug: subjectSlug,
    }),
  ));
}

export async function submitAttempt({ mode, subjectId, answers }) {
  const rows = requireData(
    await supabase.rpc("submit_attempt", {
      submitted_mode: mode,
      submitted_subject_id: subjectId,
      submitted_answers: answers,
    }),
  );

  return rows?.[0] ?? null;
}

export async function initializePayment() {
  const { data, error } = await supabase.functions.invoke("initialize-paystack-payment", {
    body: {},
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
  const rows = requireData(await supabase.rpc("get_admin_question_counts"));
  return rows?.[0] ?? { draft_count: 0, review_count: 0, published_count: 0 };
}

export async function getAdminQuestions() {
  return requireData(
    await supabase
      .from("questions")
      .select(
        "id, question_text, service_level, difficulty, status, explanation, reference_note, source_note, option_a, option_b, option_c, option_d, correct_option, subject_id, subjects(name, slug)",
      )
      .order("updated_at", { ascending: false })
      .limit(100),
  );
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
  return requireData(
    await supabase
      .from("admin_audit_logs")
      .select(
        "id, action, entity_type, entity_id, metadata, created_at, actor:profiles(email, full_name)",
      )
      .order("created_at", { ascending: false })
      .limit(50),
  );
}

export async function getActivePack() {
  const rows = requireData(
    await supabase
      .from("exam_packs")
      .select("id, name, price_kobo, currency, active_until")
      .eq("is_active", true)
      .order("active_from", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1),
  );

  return rows?.[0] ?? null;
}
