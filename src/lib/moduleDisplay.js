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

export function getModuleShortName(subjectSlug, subjectName) {
  if (subjectSlug === "public-financial-management") return "PFM";
  if (subjectSlug === "public-service-rules") return "PSR";
  if (subjectSlug === "current-affairs") return "Current Affairs";
  return subjectName ?? "Module";
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
      return "Later batches require full access.";
    case "free_different_module_requires_payment":
      return `Your free batch is already locked to ${selectedModuleName || "another module"}.`;
    case "free_batch_passed_requires_payment":
      return "You passed the free batch. Unlock full access to continue.";
    case "free_retry_used_requires_payment":
      return "Your free attempts are complete. Unlock full access to continue.";
    case "not_published":
      return "This batch is not available yet.";
    case "no_questions":
      return "Questions for this batch are still being prepared.";
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
