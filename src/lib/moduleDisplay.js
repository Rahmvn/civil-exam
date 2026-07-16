export const FALLBACK_SUBJECTS = [
  {
    id: "pfm-preview",
    slug: "public-financial-management",
    name: "Public Financial Management",
    description: "Financial regulations, expenditure control, approvals, and accountability.",
  },
  {
    id: "psr-preview",
    slug: "public-service-rules",
    name: "Public Service Rules",
    description: "Conduct, discipline, appointments, and service-wide rules.",
  },
  {
    id: "ca-preview",
    slug: "current-affairs",
    name: "Current Affairs",
    description: "Governance, history, civic and general knowledge content.",
  },
];

export function formatDate(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
}

export function formatAccessDate(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return `${Math.round(Number(value))}%`;
}

export function formatAttemptPercent(attempt) {
  const total = Number(attempt?.total_questions ?? 0);
  const score = Number(attempt?.score ?? 0);

  if (!total) return null;
  return Math.round((score / total) * 100);
}

export function getFirstName(fullName) {
  if (!fullName) return "";
  return fullName.trim().split(/\s+/)[0] ?? "";
}

export function getSubjectSlugFromPracticeTarget(target) {
  if (typeof target !== "string") return null;

  const match = target.match(/^\/practice\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

export function getModuleDisplayName(subjectName) {
  const value = String(subjectName ?? "").trim();

  if (!value) return "Module";

  return value
    .replace(/\s*\([^)]*\)\s*/g, "")
    .split(/\s*\/\s*/)[0]
    .trim();
}

export function getModuleShortName(subjectSlug, subjectName) {
  if (subjectSlug === "public-financial-management") return "PFM";
  if (subjectSlug === "public-service-rules") return "PSR";
  if (subjectSlug === "current-affairs") return "Current Affairs";
  return getModuleDisplayName(subjectName);
}

export function isCandidateModuleComingSoon(subject, publishedCount = 0) {
  if (subject?.lifecycle_status === "coming_soon") return true;

  return subject?.slug === "current-affairs" || Number(publishedCount ?? 0) === 0;
}

export function hasUsableCandidateModuleAccess(subject, publishedCount, hasModuleAccess) {
  return Boolean(hasModuleAccess) && !isCandidateModuleComingSoon(subject, publishedCount);
}

export function getBatchStatusConfig(row, isPaidUser) {
  const batchNumber = Number(row?.batch_number ?? 1);

  if (!row) {
    return { label: `Batch ${batchNumber}`, tone: "muted" };
  }

  if (row.state === "completed_passed") {
    return { label: "Passed", tone: "success" };
  }

  if (row.state === "completed_failed") {
    if (!isPaidUser && row.reason_code === "free_retry_available") {
      return { label: "Retry Available", tone: "warning" };
    }

    return { label: "Failed", tone: "danger" };
  }

  if (row.state === "locked_requires_payment") {
    return { label: "Locked", tone: "locked" };
  }

  if (row.state === "unavailable_not_published") {
    if (row.reason_code === "not_published") {
      return { label: "Not Published", tone: "muted" };
    }

    return { label: "Coming Soon", tone: "muted" };
  }

  return { label: "Available", tone: "available" };
}

export function getLockReason(row, selectedModuleName) {
  if (!row) return "";

  switch (row.reason_code) {
    case "free_next_batch_requires_payment":
      return "Unlock this module to continue.";
    case "free_different_module_requires_payment":
      return `Your free practice is already set to ${selectedModuleName || "another module"}.`;
    case "free_batch_passed_requires_payment":
      return "You passed the free practice set. Unlock this module to continue.";
    case "free_retry_used_requires_payment":
      return "Your free attempts are complete. Unlock this module to continue.";
    case "not_published":
      return "This practice set is not available yet.";
    case "no_questions":
      return "Questions for this practice set are still being prepared.";
    default:
      return "";
  }
}

export function buildModuleStatusLine(subjectSlug, liveCount, comingSoonCount) {
  if (subjectSlug === "current-affairs") {
    return "Coming soon";
  }

  const batchLabel = liveCount > 5
    ? "5+ batches"
    : liveCount === 1
      ? "1 batch"
      : `${liveCount} batches`;

  if (liveCount > 0 && comingSoonCount > 0) {
    return `${batchLabel} - ${comingSoonCount} soon`;
  }

  if (liveCount > 0) {
    return batchLabel;
  }

  if (comingSoonCount > 0) {
    return "Coming soon";
  }

  return "No published batches yet";
}

export function getModuleStatusTone(subjectSlug, liveCount, comingSoonCount) {
  if (subjectSlug === "current-affairs") {
    return "soon";
  }

  if (liveCount > 0 && comingSoonCount > 0) {
    return "mixed";
  }

  if (liveCount > 0) {
    return "live";
  }

  if (comingSoonCount > 0) {
    return "soon";
  }

  return "muted";
}

export function isPublishedBatchRow(row) {
  return Boolean(row) && Number(row.published_question_count ?? 0) > 0 && row.state !== "unavailable_not_published";
}

export function getProgressionRecommendation(rows, { isPaidUser = false } = {}) {
  const sortedRows = [...(rows ?? [])].sort(
    (left, right) => Number(left?.batch_number ?? 0) - Number(right?.batch_number ?? 0),
  );

  if (!isPaidUser) {
    const recommendedRow = (
      sortedRows.find((row) => row?.is_recommended) ??
      sortedRows.find((row) => row?.can_start) ??
      sortedRows.find((row) => isPublishedBatchRow(row)) ??
      null
    );

    return {
      recommendedRow,
      recommendedBatchNumber: recommendedRow ? Number(recommendedRow.batch_number ?? 1) : null,
      kind: recommendedRow?.state === "completed_failed" ? "retry" : "default",
      hasOpenRecommendation: Boolean(recommendedRow && recommendedRow.state !== "completed_passed"),
    };
  }

  const publishedRows = sortedRows.filter((row) => isPublishedBatchRow(row));

  if (publishedRows.length === 0) {
    return {
      recommendedRow: null,
      recommendedBatchNumber: null,
      kind: "none",
      hasOpenRecommendation: false,
    };
  }

  const earliestUnpassedRow = publishedRows.find((row) => row.state !== "completed_passed") ?? null;
  const recommendedRow = earliestUnpassedRow ?? publishedRows[publishedRows.length - 1] ?? null;

  let kind = "complete";

  if (earliestUnpassedRow?.state === "completed_failed") {
    kind = "retry";
  } else if (earliestUnpassedRow) {
    kind = Number(earliestUnpassedRow.attempt_count ?? 0) > 0 ? "continue" : "start";
  }

  return {
    recommendedRow,
    recommendedBatchNumber: recommendedRow ? Number(recommendedRow.batch_number ?? 1) : null,
    kind,
    hasOpenRecommendation: Boolean(earliestUnpassedRow),
  };
}

export function getPracticeModuleRecommendation(modules, attempts = []) {
  const availableModules = (modules ?? []).filter(
    (module) => !module?.isComingSoon && Number(module?.publishedCount ?? 0) > 0,
  );
  const modulesBySlug = new Map(
    availableModules.map((module) => [module?.subject?.slug, module]),
  );
  const recentModules = [];
  const seenSlugs = new Set();

  (attempts ?? []).forEach((attempt) => {
    const slug = attempt?.subjects?.slug;
    const module = modulesBySlug.get(slug);

    if (!module || seenSlugs.has(slug)) return;
    seenSlugs.add(slug);
    recentModules.push(module);
  });

  const mostRecentModule = recentModules[0] ?? null;
  const recommendedModule =
    recentModules.find((module) => !module.isComplete) ??
    availableModules.find((module) => !module.isComplete) ??
    mostRecentModule ??
    availableModules[0] ??
    null;

  return {
    recommendedModule,
    mostRecentModule,
    allComplete:
      availableModules.length > 0 && availableModules.every((module) => module.isComplete),
    availableCount: availableModules.length,
    completedCount: availableModules.filter((module) => module.isComplete).length,
  };
}

export function getBatchProgressionGuidance(row, progression, { isPaidUser = false } = {}) {
  const batchNumber = Number(row?.batch_number ?? 0);
  const recommendedBatchNumber = Number(progression?.recommendedBatchNumber ?? 0);
  const isRecommended =
    Boolean(progression?.hasOpenRecommendation) &&
    recommendedBatchNumber > 0 &&
    batchNumber === recommendedBatchNumber;
  const isSkipAhead =
    Boolean(isPaidUser) &&
    Boolean(progression?.hasOpenRecommendation) &&
    recommendedBatchNumber > 0 &&
    batchNumber > recommendedBatchNumber &&
    isPublishedBatchRow(row);

  let kind = "neutral";

  if (isRecommended) {
    kind = "recommended";
  } else if (isSkipAhead) {
    kind = "skip-ahead";
  } else if (
    row?.state === "completed_passed" ||
    row?.state === "completed_failed" ||
    Number(row?.attempt_count ?? 0) > 0
  ) {
    kind = "history";
  }

  return {
    kind,
    isRecommended,
    isSkipAhead,
    note: isSkipAhead ? `Practice set ${recommendedBatchNumber} is recommended first.` : "",
  };
}

export function buildRecommendedBatchLabel(progression) {
  const batchNumber = Number(progression?.recommendedBatchNumber ?? 0);

  if (!progression?.hasOpenRecommendation || batchNumber <= 0) {
    return "";
  }

  return `Recommended: Practice set ${batchNumber}`;
}
