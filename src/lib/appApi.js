import { supabase } from "./supabaseClient";
import { NIGERIA_STATES, SERVICE_LEVELS } from "./catalog";
import { readWithPolicy } from "./requestPolicy";

export const DIFFICULTIES = ["easy", "medium", "hard"];
export const QUESTION_STATUSES = ["draft", "review", "published", "withdrawn", "archived"];
export const MODULE_LIFECYCLE_STATUSES = ["draft", "coming_soon", "active", "retired"];

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function requireData({ data, error }) {
  if (error) {
    throw error;
  }

  return data;
}

async function getFunctionErrorDetails(error, fallbackData = null) {
  let payload = fallbackData && typeof fallbackData === "object" ? fallbackData : null;

  const response = error?.context;
  if (!payload && response && typeof response.clone === "function") {
    try {
      payload = await response.clone().json();
    } catch {
      // Supabase wraps non-JSON Edge Function failures too; fall back below.
    }
  }

  return {
    message: payload?.error ?? payload?.message ?? error?.message ?? "The request could not be completed.",
    code: payload?.code ?? error?.code ?? null,
    status: Number(response?.status ?? error?.status ?? 0) || null,
  };
}

async function requireFunctionData({ data, error }) {
  if (error) {
    const details = await getFunctionErrorDetails(error, data);
    throw Object.assign(new Error(details.message), {
      code: details.code,
      status: details.status,
    });
  }

  if (data?.error || data?.message) {
    const details = await getFunctionErrorDetails(null, data);
    throw Object.assign(new Error(details.message), {
      code: details.code,
      status: details.status,
    });
  }

  return data;
}

async function getAuthenticatedUserId() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (!data.session?.user?.id) throw new Error("Authentication is required.");
  return data.session.user.id;
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

export async function getMySupportRequests(limit = 10) {
  const userId = await getAuthenticatedUserId();
  return readWithPolicy(`support-requests:${userId}:${limit}`, async () => ensureArray(requireData(
    await supabase
      .from("support_requests")
      .select("id, category, subject, payment_reference, status, resolution_note, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
  )));
}

export async function getPublicModuleCatalog() {
  return readWithPolicy("public-module-catalog", async () => ensureArray(requireData(
    await supabase.rpc("get_public_module_catalog"),
  )));
}

export async function createSupportRequest({ category, subject, description, paymentReference, pagePath }) {
  return requireData(await supabase.rpc("create_support_request", {
    requested_category: category,
    requested_subject: subject,
    requested_description: description,
    requested_payment_reference: paymentReference || null,
    requested_page_path: pagePath || null,
  }));
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
      .select("id, slug, name, description, sort_order, batch_size, pass_mark_percent, practice_type, lifecycle_status, candidate_availability, objective_time_limit_minutes, oral_allowed_durations_seconds")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
  ));

  return ensureArray(rows);
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

  return readWithPolicy(`module-batch-access:${subjectSlug ?? "all"}`, async () => {
    const [objectiveResult, oralResult] = await Promise.all([
      supabase.rpc("get_module_batch_access", payload),
      supabase.rpc("get_oral_practice_set_access", payload),
    ]);
    const objectiveRows = ensureArray(requireData(objectiveResult));
    const oralRows = ensureArray(requireData(oralResult));
    const oralSlugs = new Set(oralRows.map((row) => row.subject_slug));

    return [
      ...objectiveRows.filter((row) => !oralSlugs.has(row.subject_slug)),
      ...oralRows,
    ];
  });
}

export async function getActiveOralAttempt(subjectSlug, setNumber = 1) {
  if (!subjectSlug) return null;

  return requireData(await supabase.rpc("get_active_oral_attempt", {
    requested_subject_slug: subjectSlug,
    requested_set_number: setNumber,
  }));
}

export async function startOrResumeOralAttempt({ subjectSlug, setNumber = 1, secondsPerQuestion }) {
  return requireData(await supabase.rpc("start_or_resume_oral_attempt_v2", {
    requested_subject_slug: subjectSlug,
    requested_set_number: setNumber,
    requested_seconds_per_question: secondsPerQuestion,
  }));
}

export async function getOralAttemptState(attemptId) {
  return requireData(await supabase.rpc("get_oral_attempt_state", {
    requested_attempt_id: attemptId,
  }));
}

export async function saveOralResponseDraft({ attemptId, questionId, responseText }) {
  return requireData(await supabase.rpc("save_oral_response_draft", {
    requested_attempt_id: attemptId,
    requested_question_id: questionId,
    requested_response_text: responseText,
  }));
}

export async function advanceOralAttempt({ attemptId, questionId, responseText, reason = "manual" }) {
  return requireData(await supabase.rpc("advance_oral_attempt", {
    requested_attempt_id: attemptId,
    requested_question_id: questionId,
    requested_response_text: responseText,
    requested_reason: reason,
  }));
}

export async function getOralAttemptReview(attemptId) {
  return ensureArray(requireData(await supabase.rpc("get_oral_attempt_review", {
    requested_attempt_id: attemptId,
  })));
}

export async function saveOralSelfRating(responseId, rating) {
  return requireData(await supabase.rpc("save_oral_self_rating", {
    requested_response_id: responseId,
    requested_rating: rating,
  }));
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
  const userId = await getAuthenticatedUserId();
  return readWithPolicy(`recent-attempts:${userId}:${limit}`, async () => ensureArray(requireData(
    await supabase
      .from("attempts")
      .select(
        "id, mode, score, total_questions, completed_at, started_at, service_level, batch_number, score_percent, passed, retry_number, subjects(name, slug)",
      )
      .eq("user_id", userId)
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

  const userId = await getAuthenticatedUserId();
  return readWithPolicy(`queue-attempt-matches:${userId}:${normalizedIds.join(",")}`, async () => ensureArray(requireData(
    await supabase
      .from("attempt_answers")
      .select("attempt_id, question_id, answered_at")
      .eq("user_id", userId)
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

  if (typeof batchNumber === "number" && Number.isFinite(batchNumber)) {
    payload.requested_batch_number = batchNumber;
  }

  return readWithPolicy(
    `practice-questions:${subjectId}:${batchNumber ?? "next"}:${limit ?? "all"}`,
    async () => decorateObjectiveSessionQuestions(requireData(await supabase.rpc("start_objective_practice_session_v2", {
      ...payload,
      requested_allow_free_lock: false,
    }))),
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

  const session = requireData(await supabase.rpc("start_objective_practice_session_v2", {
    ...payload,
    requested_allow_free_lock: true,
  }));
  return decorateObjectiveSessionQuestions(session);
}

export async function abandonObjectivePracticeSession(practiceSessionId) {
  if (!practiceSessionId) return null;

  return requireData(await supabase.rpc("abandon_objective_practice_session", {
    requested_session_id: practiceSessionId,
  }));
}

function decorateObjectiveSessionQuestions(session) {
  const serverNow = Date.parse(session?.server_now);
  const serverDeadline = Date.parse(session?.deadline_at);
  const remainingMilliseconds = Number.isFinite(serverNow) && Number.isFinite(serverDeadline)
    ? Math.max(0, serverDeadline - serverNow)
    : Number(session?.time_limit_seconds ?? 1800) * 1000;
  const clientDeadline = Date.now() + remainingMilliseconds;

  return ensureArray(session?.questions).map((question) => ({
    ...question,
    session_deadline_at: clientDeadline,
    time_limit_seconds: Number(session?.time_limit_seconds ?? 1800),
  }));
}

export async function submitAttempt({ mode, subjectId, answers, batchNumber = null, practiceSessionId, submissionToken }) {
  if (!practiceSessionId) {
    return requireData(await supabase.rpc("submit_attempt_idempotent", {
      submitted_mode: mode,
      submitted_subject_id: subjectId,
      submitted_answers: answers,
      submitted_batch_number: typeof batchNumber === "number" && Number.isFinite(batchNumber) ? batchNumber : null,
      submitted_token: submissionToken,
    }));
  }

  const payload = {
    submitted_session_id: practiceSessionId,
    submitted_mode: mode,
    submitted_answers: answers,
    submitted_token: submissionToken,
  };

  return requireData(await supabase.rpc("submit_attempt_idempotent_v2", payload));
}

export async function initializePayment(subjectSlug) {
  return requireFunctionData(await supabase.functions.invoke("initialize-paystack-payment", {
    body: { subject_slug: subjectSlug },
  }));
}

export async function verifyPayment(reference) {
  return requireFunctionData(await supabase.functions.invoke("verify-paystack-payment", {
    body: { reference },
  }));
}

export async function getAdminQuestionCounts() {
  const rows = await readWithPolicy("admin-question-counts", async () =>
    requireData(await supabase.rpc("get_admin_question_counts")),
  );
  return rows?.[0] ?? { draft_count: 0, review_count: 0, published_count: 0 };
}

export async function getAdminQuestions(practiceSetId = null, practiceType = "objective") {
  return readWithPolicy(`admin-questions:${practiceType}:${practiceSetId ?? "all"}`, async () => {
    if (practiceType === "oral") {
      let request = supabase
        .from("oral_questions")
        .select(
          "id, exam_pack_id, practice_set_id, question_text, difficulty, status, model_answer, key_points, reference_note, source_note, subject_id, batch_position, supersedes_question_id, revision_number, created_at, updated_at, subjects(name, slug)",
        );

      if (practiceSetId) request = request.eq("practice_set_id", practiceSetId);
      return requireData(await request
        .order("subject_id", { ascending: true })
        .order("batch_position", { ascending: true, nullsFirst: false })
        .order("revision_number", { ascending: false })
        .limit(practiceSetId ? 1000 : 200));
    }

    let request = supabase
      .from("questions")
      .select(
        "id, exam_pack_id, practice_set_id, question_text, service_level, difficulty, status, explanation, reference_note, source_note, option_a, option_b, option_c, option_d, correct_option, subject_id, batch_number, batch_position, supersedes_question_id, revision_number, created_at, updated_at, subjects(name, slug)",
      );

    if (practiceSetId) {
      request = request.eq("practice_set_id", practiceSetId);
    }

    return requireData(await request
      .order("subject_id", { ascending: true })
      .order("batch_number", { ascending: true })
      .order("batch_position", { ascending: true, nullsFirst: false })
      .order("revision_number", { ascending: false })
      .limit(practiceSetId ? 1000 : 200));
  });
}

export async function getAdminContentModules() {
  return readWithPolicy("admin-content-modules", async () => {
    const [modulesResult, timingResult] = await Promise.all([
      supabase.rpc("get_admin_content_modules_v3"),
      supabase.from("subjects").select("id, objective_time_limit_minutes, oral_allowed_durations_seconds"),
    ]);
    const timingBySubject = new Map(ensureArray(requireData(timingResult)).map((row) => [row.id, row]));
    return ensureArray(requireData(modulesResult)).map((module) => ({
      ...module,
      objective_time_limit_minutes: Number(timingBySubject.get(module.subject_id)?.objective_time_limit_minutes ?? 30),
      oral_allowed_durations_seconds: timingBySubject.get(module.subject_id)?.oral_allowed_durations_seconds ?? [180, 300],
    }));
  });
}

export async function getAdminPracticeSets(subjectId) {
  if (!subjectId) return [];
  return readWithPolicy(`admin-practice-sets:${subjectId}`, async () => ensureArray(requireData(
    await supabase.rpc("get_admin_practice_sets_v3", {
      requested_subject_id: subjectId,
    }),
  )));
}

export async function getAdminPracticeSetValidation(practiceSetId) {
  return readWithPolicy(`admin-practice-set-validation:${practiceSetId}`, async () => requireData(
    await supabase.rpc("admin_get_practice_set_validation_v2", {
      requested_practice_set_id: practiceSetId,
    }),
  ));
}

export async function createAdminModule(module) {
  return requireData(await supabase.rpc("admin_create_module_typed_v2", {
    requested_name: module.name.trim(),
    requested_slug: module.slug.trim(),
    requested_sort_order: Number(module.sort_order),
    requested_price_kobo: Number(module.price_kobo),
    requested_currency: module.currency || "NGN",
    requested_batch_size: Number(module.batch_size),
    requested_pass_mark_percent: Number(module.pass_mark_percent),
    requested_lifecycle_status: module.lifecycle_status,
    requested_practice_type: module.practice_type || "objective",
    requested_objective_time_limit_minutes: Number(module.objective_time_limit_minutes),
    requested_oral_allowed_durations_seconds: module.oral_allowed_durations_seconds,
  }));
}

export async function updateAdminModule(module) {
  return requireData(await supabase.rpc("admin_update_module_v3", {
    requested_subject_id: module.subject_id,
    requested_name: module.subject_name.trim(),
    requested_sort_order: Number(module.sort_order),
    requested_price_kobo: Number(module.price_kobo),
    requested_currency: module.currency || "NGN",
    requested_batch_size: Number(module.batch_size),
    requested_pass_mark_percent: Number(module.pass_mark_percent),
    requested_lifecycle_status: module.lifecycle_status,
    requested_available_for_purchase: Boolean(module.available_for_purchase),
    requested_objective_time_limit_minutes: Number(module.objective_time_limit_minutes),
    requested_oral_allowed_durations_seconds: module.oral_allowed_durations_seconds,
  }));
}

export async function deleteEmptyAdminModule(subjectId) {
  return requireData(await supabase.rpc("admin_delete_empty_module_v2", {
    requested_subject_id: subjectId,
  }));
}

export async function createAdminPracticeSet(subjectId, expectedQuestionCount) {
  return requireData(await supabase.rpc("admin_create_practice_set", {
    requested_subject_id: subjectId,
    requested_expected_question_count: Number(expectedQuestionCount),
  }));
}

export async function updateAdminPracticeSet(practiceSetId, expectedQuestionCount) {
  return requireData(await supabase.rpc("admin_update_practice_set", {
    requested_practice_set_id: practiceSetId,
    requested_expected_question_count: Number(expectedQuestionCount),
  }));
}

export async function transitionAdminPracticeSet(practiceSetId, status) {
  return requireData(await supabase.rpc("admin_transition_practice_set_v2", {
    requested_practice_set_id: practiceSetId,
    requested_status: status,
  }));
}

export async function withdrawAdminPracticeSet(practiceSetId) {
  return requireData(await supabase.rpc("admin_withdraw_practice_set", {
    requested_practice_set_id: practiceSetId,
  }));
}

export async function republishAdminPracticeSet(practiceSetId) {
  return requireData(await supabase.rpc("admin_republish_practice_set", {
    requested_practice_set_id: practiceSetId,
  }));
}

export async function retireAdminPracticeSet(practiceSetId, reason) {
  return requireData(await supabase.rpc("admin_retire_practice_set", {
    requested_practice_set_id: practiceSetId,
    requested_reason: reason,
  }));
}

export async function createAdminPracticeSetReplacement(practiceSetId, copyQuestions = true) {
  return requireData(await supabase.rpc("admin_create_practice_set_replacement", {
    requested_source_practice_set_id: practiceSetId,
    requested_copy_questions: copyQuestions,
  }));
}

export async function publishAdminPracticeSetReplacement(practiceSetId) {
  return requireData(await supabase.rpc("admin_publish_practice_set_replacement", {
    requested_replacement_practice_set_id: practiceSetId,
  }));
}

export async function updateAdminModuleAvailability(subjectId, availability, reason = null) {
  return requireData(await supabase.rpc("admin_update_module_availability", {
    requested_subject_id: subjectId,
    requested_availability: availability,
    requested_reason: reason,
  }));
}

export async function updateAdminModuleLifecycle(subjectId, lifecycleStatus, reason = null) {
  return requireData(await supabase.rpc("admin_update_module_lifecycle", {
    requested_subject_id: subjectId,
    requested_lifecycle_status: lifecycleStatus,
    requested_reason: reason,
  }));
}

export async function updateAdminModuleSalesAvailability(subjectId, availableForPurchase) {
  return requireData(await supabase.rpc("admin_update_module_sales_availability", {
    requested_subject_id: subjectId,
    requested_available_for_purchase: Boolean(availableForPurchase),
  }));
}

export async function deleteEmptyAdminPracticeSet(practiceSetId) {
  return requireData(await supabase.rpc("admin_delete_empty_practice_set_v2", {
    requested_practice_set_id: practiceSetId,
  }));
}

export async function saveAdminQuestion(question, practiceType = "objective") {
  return requireData(await supabase.rpc(practiceType === "oral" ? "admin_save_oral_question" : "admin_save_question", {
    requested_question: question,
  }));
}

export async function createAdminQuestionRevision(question, practiceType = "objective") {
  return requireData(await supabase.rpc(practiceType === "oral" ? "admin_create_oral_question_revision" : "admin_create_question_revision", {
    requested_question: question,
  }));
}

export async function updateAdminQuestionRevision(question, practiceType = "objective") {
  return requireData(await supabase.rpc(practiceType === "oral" ? "admin_update_oral_question_revision" : "admin_update_question_revision", {
    requested_question: question,
  }));
}

export async function publishAdminQuestionRevision(questionId, practiceType = "objective") {
  return requireData(await supabase.rpc(practiceType === "oral" ? "admin_publish_oral_question_revision" : "admin_publish_question_revision", {
    requested_question_id: questionId,
  }));
}

export async function archiveAdminQuestion(questionId, practiceType = "objective") {
  return requireData(await supabase.rpc(practiceType === "oral" ? "admin_archive_oral_question" : "admin_archive_question", {
    requested_question_id: questionId,
  }));
}

export async function deleteDraftAdminQuestion(questionId, practiceType = "objective") {
  return requireData(await supabase.rpc(practiceType === "oral" ? "admin_delete_draft_oral_question" : "admin_delete_draft_question", {
    requested_question_id: questionId,
  }));
}

export async function importAdminQuestions(practiceSetId, questions, metadata = {}, practiceType = "objective", mode = "append") {
  const functionName = mode === "replace"
    ? "admin_replace_practice_set_questions"
    : practiceType === "oral" ? "admin_import_oral_questions" : "admin_import_questions";
  return requireData(await supabase.rpc(functionName, {
    requested_practice_set_id: practiceSetId,
    requested_questions: questions,
    requested_file_name: metadata?.fileName || null,
    requested_file_checksum: metadata?.checksum || null,
  }));
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

export async function getAdminSupportRequests(limit = 100) {
  return readWithPolicy(`admin-support-requests:${limit}`, async () => ensureArray(requireData(
    await supabase.rpc("get_admin_support_requests", { requested_limit: limit }),
  )));
}

export async function getAdminSupportQueue({ status = "open", query = "", limit = 25, offset = 0 } = {}) {
  const data = await readWithPolicy(
    `admin-support-queue:${status}:${query}:${limit}:${offset}`,
    async () => requireData(await supabase.rpc("get_admin_support_queue", {
      requested_status: status,
      requested_query: query || null,
      requested_limit: limit,
      requested_offset: offset,
    })),
  );

  return {
    items: ensureArray(data?.items),
    total: Number(data?.total) || 0,
    counts: {
      open: Number(data?.counts?.open) || 0,
      received: Number(data?.counts?.received) || 0,
      in_review: Number(data?.counts?.in_review) || 0,
      resolved: Number(data?.counts?.resolved) || 0,
      closed: Number(data?.counts?.closed) || 0,
      all: Number(data?.counts?.all) || 0,
    },
    limit: Number(data?.limit) || limit,
    offset: Number(data?.offset) || 0,
    hasMore: Boolean(data?.has_more),
  };
}

export async function getAdminPaymentAttention(limit = 100) {
  return readWithPolicy(`admin-payment-attention:${limit}`, async () => ensureArray(requireData(
    await supabase.rpc("get_admin_payment_attention", { requested_limit: limit }),
  )));
}

export async function updateSupportRequest(requestId, status, resolutionNote) {
  return requireData(await supabase.rpc("update_support_request", {
    requested_id: requestId,
    requested_status: status,
    requested_resolution_note: resolutionNote || null,
  }));
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
