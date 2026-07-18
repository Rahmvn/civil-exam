import assert from "node:assert/strict";
import test from "node:test";
import {
  buildModuleStatusLine,
  buildRecommendedBatchLabel,
  formatAttemptPercent,
  getBatchProgressionGuidance,
  getBatchStatusConfig,
  hasUsableCandidateModuleAccess,
  hasStartablePublishedBatch,
  isCandidateModuleComingSoon,
  isModulePurchaseUnavailable,
  getLockReason,
  getModuleDisplayName,
  getPracticeModuleRecommendation,
  getProgressionRecommendation,
  isPublishedBatchRow,
  shouldShowCandidateModule,
  shouldShowPracticeHubModule,
} from "../../src/lib/moduleDisplay.js";

function batch(number, state, overrides = {}) {
  return {
    batch_number: number,
    state,
    published_question_count: 30,
    attempt_count: 0,
    can_start: state === "available",
    ...overrides,
  };
}

test("module display helpers normalize names, scores, and publication status", () => {
  assert.equal(getModuleDisplayName("Public Financial Management (Financial Regulations) / 2026"), "Public Financial Management");
  assert.equal(formatAttemptPercent({ score: 7, total_questions: 10 }), 70);
  assert.equal(formatAttemptPercent({ score: 0, total_questions: 0 }), null);
  assert.equal(isPublishedBatchRow(batch(1, "available")), true);
  assert.equal(isPublishedBatchRow(batch(1, "unavailable_not_published")), false);
  assert.equal(buildModuleStatusLine("public-service-rules", 6, 2), "5+ batches - 2 soon");
  assert.equal(buildModuleStatusLine("current-affairs", 4, 0), "4 batches");
});

test("coming-soon lifecycle takes precedence over a stored module entitlement", () => {
  const comingSoonSubject = {
    slug: "future-module",
    lifecycle_status: "coming_soon",
  };
  const activeSubject = {
    slug: "active-module",
    lifecycle_status: "active",
  };

  assert.equal(isCandidateModuleComingSoon(comingSoonSubject, 3), true);
  assert.equal(hasUsableCandidateModuleAccess(comingSoonSubject, 3, true), false);
  assert.equal(isCandidateModuleComingSoon(activeSubject, 3), false);
  assert.equal(hasUsableCandidateModuleAccess(activeSubject, 3, true), true);
  assert.equal(hasUsableCandidateModuleAccess(activeSubject, 3, false), false);
});

test("current affairs follows admin candidate availability instead of a hard-coded hold", () => {
  const availableCurrentAffairs = {
    slug: "current-affairs",
    lifecycle_status: "active",
    candidate_availability: "available",
  };
  const heldCurrentAffairs = {
    ...availableCurrentAffairs,
    candidate_availability: "coming_soon",
  };

  assert.equal(isCandidateModuleComingSoon(availableCurrentAffairs, 7), false);
  assert.equal(hasUsableCandidateModuleAccess(availableCurrentAffairs, 7, true), true);
  assert.equal(isCandidateModuleComingSoon(heldCurrentAffairs, 7), true);
});

test("batch status and lock copy follow server state and reason codes", () => {
  assert.deepEqual(getBatchStatusConfig(batch(1, "completed_passed"), false), { label: "Passed", tone: "success" });
  assert.deepEqual(
    getBatchStatusConfig(batch(1, "completed_failed", { reason_code: "free_retry_available" }), false),
    { label: "Retry Available", tone: "warning" },
  );
  assert.deepEqual(getBatchStatusConfig(batch(2, "locked_requires_payment"), true), { label: "Locked", tone: "locked" });
  assert.equal(
    getLockReason({ reason_code: "free_different_module_requires_payment" }, "Public Service Rules"),
    "Your free practice is already set to Public Service Rules.",
  );
  assert.equal(getLockReason({ reason_code: "no_questions" }), "Questions for this practice set are still being prepared.");
});

test("paid progression recommends the earliest incomplete published set", () => {
  const rows = [
    batch(3, "available"),
    batch(1, "completed_passed", { attempt_count: 1 }),
    batch(2, "completed_failed", { attempt_count: 1 }),
  ];
  const progression = getProgressionRecommendation(rows, { isPaidUser: true });

  assert.equal(progression.recommendedBatchNumber, 2);
  assert.equal(progression.kind, "retry");
  assert.equal(progression.hasOpenRecommendation, true);
  assert.equal(buildRecommendedBatchLabel(progression), "Recommended: Practice set 2");
  assert.deepEqual(
    getBatchProgressionGuidance(rows[0], progression, { isPaidUser: true }),
    { kind: "skip-ahead", isRecommended: false, isSkipAhead: true, note: "Practice set 2 is recommended first." },
  );
});

test("free progression honors the server recommendation before other available rows", () => {
  const rows = [
    batch(1, "available", { can_start: true }),
    batch(2, "completed_failed", { can_start: true, is_recommended: true }),
  ];
  const progression = getProgressionRecommendation(rows);

  assert.equal(progression.recommendedBatchNumber, 2);
  assert.equal(progression.kind, "retry");
  assert.equal(progression.hasOpenRecommendation, true);
});

test("module recommendations prioritize recent unfinished usable modules", () => {
  const modules = [
    { subject: { slug: "pfm" }, publishedCount: 2, isComplete: true },
    { subject: { slug: "psr" }, publishedCount: 2, isComplete: false },
    { subject: { slug: "future" }, publishedCount: 0, isComingSoon: true, isComplete: false },
  ];
  const result = getPracticeModuleRecommendation(modules, [
    { subjects: { slug: "pfm" } },
    { subjects: { slug: "psr" } },
  ]);

  assert.equal(result.recommendedModule.subject.slug, "psr");
  assert.equal(result.mostRecentModule.subject.slug, "pfm");
  assert.equal(result.availableCount, 2);
  assert.equal(result.completedCount, 1);
  assert.equal(result.allComplete, false);
});

test("practice hub visibility respects startable access and sale availability", () => {
  const completedFreeOralRows = [
    batch(1, "completed_passed", { can_start: false }),
    batch(2, "locked_requires_payment", { can_start: false }),
  ];
  const startableFreeRows = [
    batch(1, "available", { can_start: true, reason_code: "free_batch_available" }),
  ];

  assert.equal(hasStartablePublishedBatch(completedFreeOralRows), false);
  assert.equal(hasStartablePublishedBatch(startableFreeRows), true);
  assert.equal(
    shouldShowPracticeHubModule({
      hasModuleAccess: false,
      canPurchase: false,
      rows: completedFreeOralRows,
    }),
    false,
  );
  assert.equal(
    shouldShowPracticeHubModule({
      hasModuleAccess: false,
      canPurchase: true,
      rows: completedFreeOralRows,
    }),
    true,
  );
  assert.equal(
    isModulePurchaseUnavailable({
      hasModuleAccess: false,
      canPurchase: false,
      rows: completedFreeOralRows,
    }),
    true,
  );
  assert.equal(
    isModulePurchaseUnavailable({
      hasModuleAccess: false,
      canPurchase: false,
      rows: startableFreeRows,
    }),
    false,
  );
  assert.equal(
    shouldShowCandidateModule({
      subject: { slug: "oral-questions", lifecycle_status: "active" },
      publishedCount: 2,
      hasModuleAccess: false,
      canPurchase: false,
      rows: completedFreeOralRows,
    }),
    false,
  );
  assert.equal(
    shouldShowCandidateModule({
      subject: { slug: "future-module", lifecycle_status: "coming_soon" },
      publishedCount: 0,
      hasModuleAccess: false,
      canPurchase: false,
      rows: [],
    }),
    true,
  );
});
