import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import {
  AnimatedProgressBar,
  DashboardActionButton,
  FreeBatchConfirmationModal,
} from "../components/DashboardUi";
import ProfileOnboardingModal from "../components/ProfileOnboardingModal";
import {
  getCandidateSummary,
  getModuleBatchAccess,
  getModuleProgress,
  getRecentAttempts,
  getSubjects,
  startPracticeBatch,
} from "../lib/appApi";
import { friendlyErrorMessage, isExpectedAbortError, logAppError } from "../lib/errors";
import {
  FALLBACK_SUBJECTS,
  buildModuleStatusLine,
  formatDate,
  formatPercent,
  getBatchStatusConfig,
  getLockReason,
  getModuleStatusTone,
} from "../lib/moduleDisplay";
import { storePracticeBatch } from "../lib/practiceSession";
import { useAuth } from "../lib/useAuth";

export default function ModuleDetail() {
  const { profileComplete } = useAuth();
  const { subjectSlug = "" } = useParams();
  const navigate = useNavigate();
  const mountedRef = useRef(true);
  const [summary, setSummary] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [progress, setProgress] = useState([]);
  const [rows, setRows] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moduleNotice, setModuleNotice] = useState("");
  const [ctaError, setCtaError] = useState("");
  const [onboardingTarget, setOnboardingTarget] = useState(null);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [startConfirmSubject, setStartConfirmSubject] = useState(null);
  const [startingBatch, setStartingBatch] = useState(false);

  const loadModuleData = useCallback(async ({ showLoading = true } = {}) => {
    if (!subjectSlug) return;

    if (showLoading && mountedRef.current) {
      setLoading(true);
    }

    if (mountedRef.current) {
      setModuleNotice("");
    }

    const requests = [
      { key: "summary", promise: getCandidateSummary() },
      { key: "subjects", promise: getSubjects() },
      { key: "progress", promise: getModuleProgress() },
      { key: "batchAccess", promise: getModuleBatchAccess(subjectSlug) },
      { key: "attempts", promise: getRecentAttempts() },
    ];

    const results = await Promise.allSettled(requests.map((item) => item.promise));

    if (!mountedRef.current) {
      return;
    }

    const next = {};

    results.forEach((result, index) => {
      const { key } = requests[index];

      if (result.status === "fulfilled") {
        next[key] = result.value;
      } else if (!isExpectedAbortError(result.reason)) {
        logAppError(`Module detail load ${key}`, result.reason);
        if (key === "batchAccess") {
          setModuleNotice("We could not load this module's batches right now.");
        }
      }
    });

    setSummary(next.summary ?? null);
    setSubjects(Array.isArray(next.subjects) && next.subjects.length > 0 ? next.subjects : FALLBACK_SUBJECTS);
    setProgress(Array.isArray(next.progress) ? next.progress : []);
    setRows(Array.isArray(next.batchAccess) ? next.batchAccess : []);
    setAttempts(Array.isArray(next.attempts) ? next.attempts : []);
    setLoading(false);
  }, [subjectSlug]);

  useEffect(() => {
    mountedRef.current = true;
    void loadModuleData();

    return () => {
      mountedRef.current = false;
    };
  }, [loadModuleData]);

  const subjectsForDisplay = subjects.length > 0 ? subjects : FALLBACK_SUBJECTS;
  const subject = subjectsForDisplay.find((item) => item.slug === subjectSlug) ?? null;
  const freeModuleSlug = summary?.free_module_subject_slug ?? null;
  const hasSelectedFreeModule = Boolean(freeModuleSlug);
  const isPaidUser = Boolean(summary?.has_paid_access);
  const selectedModuleName = subjectsForDisplay.find((item) => item.slug === freeModuleSlug)?.name ?? "";
  const liveRows = rows.filter((row) => Number(row.published_question_count ?? 0) > 0);
  const comingSoonRows = rows.filter((row) => row.state === "unavailable_not_published");
  const progressBySubject = useMemo(
    () => Object.fromEntries(progress.map((item) => [item.subject_id, item])),
    [progress],
  );
  const subjectProgress = subject ? progressBySubject[subject.id] ?? null : null;
  const latestAttemptByBatch = useMemo(() => {
    const map = new Map();

    attempts.forEach((attempt) => {
      const slug = attempt?.subjects?.slug;
      if (!slug || slug !== subjectSlug) return;

      const key = `${slug}:${Number(attempt.batch_number ?? 1)}`;
      if (!map.has(key)) {
        map.set(key, attempt);
      }
    });

    return map;
  }, [attempts, subjectSlug]);
  const latestSubjectAttempt = useMemo(
    () => attempts.find((attempt) => attempt?.subjects?.slug === subjectSlug) ?? null,
    [attempts, subjectSlug],
  );

  const passedCount = liveRows.filter((row) => row.state === "completed_passed").length;
  const progressPercent = liveRows.length > 0 ? Math.round((passedCount / liveRows.length) * 100) : 0;
  const statusLine = subject ? buildModuleStatusLine(subject.slug, liveRows.length, comingSoonRows.length) : "";
  const statusTone = subject ? getModuleStatusTone(subject.slug, liveRows.length, comingSoonRows.length) : "muted";
  const bestScoreValue = rows.reduce((best, row) => {
    const value = Number(row.best_score ?? 0);
    return value > best ? value : best;
  }, 0);
  const latestScoreValue = Number(subjectProgress?.last_score_percent ?? 0) || null;
  const isSelectedFreeModule = hasSelectedFreeModule && freeModuleSlug === subjectSlug;
  const moduleSummaryLine = (() => {
    if (!profileComplete) {
      return "Complete your account to start practice.";
    }

    if (isPaidUser) {
      return "All published batches in this module are available.";
    }

    if (!hasSelectedFreeModule) {
      return "Choose one module and start Batch 1 for free.";
    }

    if (isSelectedFreeModule) {
      return "Your selected free module is shown below.";
    }

    return "Unlock full access to start this module.";
  })();

  let emphasisText = "Not attempted yet";
  if (bestScoreValue > 0) {
    emphasisText = `Best score ${formatPercent(bestScoreValue)}`;
  } else if (latestScoreValue !== null) {
    emphasisText = `Latest score ${formatPercent(latestScoreValue)}`;
  } else if (liveRows.length > 0 && passedCount > 0) {
    emphasisText = `${passedCount} of ${liveRows.length} published batches passed`;
  } else if (subjectSlug === "current-affairs") {
    emphasisText = "Fact-check hold";
  }

  let supportText = null;
  if (!isPaidUser && isSelectedFreeModule) {
    supportText = "Selected free module";
  } else if (!isPaidUser && hasSelectedFreeModule && liveRows.length > 0) {
    supportText = "Full access required";
  } else if (latestSubjectAttempt) {
    supportText = `Last attempt ${formatDate(latestSubjectAttempt.completed_at ?? latestSubjectAttempt.started_at)}`;
  }

  function openOnboarding() {
    setOnboardingTarget(`/modules/${subjectSlug}`);
    setShowOnboardingModal(true);
  }

  function getBatchPrimaryAction(row) {
    const batchNumber = Number(row?.batch_number ?? 1);

    if (!profileComplete) {
      return {
        label: "Complete account",
        action: openOnboarding,
      };
    }

    if (!row || row.state === "unavailable_not_published" || Number(row.published_question_count ?? 0) === 0) {
      return { label: "Coming soon", disabled: true };
    }

    if (row.state === "locked_requires_payment" || !row.can_start) {
      return { label: "Unlock Full Access", to: "/access" };
    }

    if (!isPaidUser && !hasSelectedFreeModule && batchNumber === 1 && row.reason_code === "free_batch_available") {
      return {
        label: "Start free batch",
        action: () => {
          if (!subject) return;
          setCtaError("");
          setStartConfirmSubject(subject);
        },
      };
    }

    if (row.state === "completed_failed") {
      return { label: `Retry Batch ${batchNumber}`, to: `/practice/${subjectSlug}?batch=${batchNumber}` };
    }

    if (row.state === "completed_passed") {
      return isPaidUser
        ? { label: `Retry Batch ${batchNumber}`, to: `/practice/${subjectSlug}?batch=${batchNumber}` }
        : { label: "Unlock Full Access", to: "/access" };
    }

    if (Number(row.attempt_count ?? 0) > 0) {
      return { label: `Continue Batch ${batchNumber}`, to: `/practice/${subjectSlug}?batch=${batchNumber}` };
    }

    return { label: `Start Batch ${batchNumber}`, to: `/practice/${subjectSlug}?batch=${batchNumber}` };
  }

  function getBatchSecondaryAction(row) {
    if (!row || Number(row.attempt_count ?? 0) <= 0) return null;

    const batchNumber = Number(row.batch_number ?? 1);
    const latestAttemptForBatch = latestAttemptByBatch.get(`${subjectSlug}:${batchNumber}`) ?? null;

    if (!latestAttemptForBatch) return null;

    return {
      label: "Review",
      to: `/review?attempt=${latestAttemptForBatch.id}`,
    };
  }

  async function confirmStartFreeBatch() {
    if (!startConfirmSubject) return;

    setStartingBatch(true);
    setCtaError("");

    try {
      const batch = await startPracticeBatch(startConfirmSubject.slug, 1);
      storePracticeBatch(startConfirmSubject.slug, batch);
      setStartConfirmSubject(null);
      navigate(`/practice/${startConfirmSubject.slug}?batch=1`, {
        state: { batchStarted: true },
      });
    } catch (error) {
      logAppError(`Module detail start batch:${startConfirmSubject.slug}`, error);
      setCtaError(friendlyErrorMessage(error, "We could not start this batch right now."));
      setStartConfirmSubject(null);
    } finally {
      setStartingBatch(false);
    }
  }

  function closeOnboardingModal() {
    setShowOnboardingModal(false);
    setOnboardingTarget(null);
  }

  if (loading) {
    return (
      <AppFrame>
        <section className="dashboard-section-block">
          <article className="dashboard-panel-card">Loading module...</article>
        </section>
      </AppFrame>
    );
  }

  if (!subject) {
    return (
      <AppFrame>
        <section className="dashboard-section-block">
          <article className="dashboard-panel-card module-detail-empty">
            <h1>Module not found</h1>
            <p className="support-copy">We could not find that module.</p>
            <Link className="ghost-button" to="/dashboard#modules">
              Back to modules
            </Link>
          </article>
        </section>
      </AppFrame>
    );
  }

  const rowsToShow = rows.length > 0
    ? rows
    : [{ batch_number: 1, state: "unavailable_not_published", reason_code: "no_questions" }];

  return (
    <AppFrame>
      <section className="dashboard-hub dashboard-hub-compact module-detail-page">
        <section className="dashboard-section-block">
          <div className="dashboard-section-heading module-detail-heading">
            <div className="dashboard-section-heading-copy">
              <p className="dashboard-section-kicker">Module</p>
              <h1 className="module-detail-title">{subject.name}</h1>
            </div>
            <Link className="text-link" to="/dashboard#modules">
              Back to modules
            </Link>
          </div>

          <article className="dashboard-panel-card module-detail-hero">
            <div className="module-card-v3-head">
              <p className="module-card-description">{subject.description}</p>
            </div>

            <div className="module-card-status-row">
              <span className={`module-status-pill is-${statusTone}`}>{statusLine}</span>
              <span className="module-status-copy">{emphasisText}</span>
              {supportText && <span className="module-status-copy">{supportText}</span>}
            </div>

            <p className="module-detail-summary">{moduleSummaryLine}</p>

            {progressPercent > 0 && (
              <div className="module-inline-progress module-inline-progress-plain">
                <span className="module-inline-progress-label">{`${progressPercent}% complete`}</span>
                <AnimatedProgressBar value={progressPercent} />
              </div>
            )}

            {ctaError && <p className="notice error">{ctaError}</p>}
            {moduleNotice && <p className="support-copy">{moduleNotice}</p>}
          </article>
        </section>

        <section className="dashboard-section-block">
          <div className="dashboard-section-heading">
            <div className="dashboard-section-heading-copy">
              <p className="dashboard-section-kicker">Published batches</p>
              <h2>Batches</h2>
            </div>
          </div>

          <article className="dashboard-panel-card module-detail-batches-card">
            <div className="module-preview-panel module-preview-panel-detail">
              {rowsToShow.map((row) => {
                const status = getBatchStatusConfig(row, isPaidUser);
                const primaryAction = getBatchPrimaryAction(row);
                const secondaryAction = getBatchSecondaryAction(row);
                const supportCopy = getLockReason(row, selectedModuleName);
                const metaBits = [];
                const attemptCount = Number(row.attempt_count ?? 0);
                const showStatusBadge =
                  status.label !== "Available" &&
                  !(status.label === "Not Published" && row.state !== "unavailable_not_published");
                const showNotAttemptedTag =
                  status.label === "Available" &&
                  attemptCount === 0 &&
                  row.state !== "unavailable_not_published";

                if (attemptCount > 0) {
                  metaBits.push(`${attemptCount} attempt${attemptCount === 1 ? "" : "s"}`);
                }

                if (row.last_score !== null && row.last_score !== undefined && attemptCount > 0) {
                  metaBits.push(`Last score ${row.last_score}%`);
                } else if (row.best_score !== null && row.best_score !== undefined && attemptCount > 0) {
                  metaBits.push(`Score ${row.best_score}%`);
                }

                return (
                  <article className="module-preview-row" key={`${subject.slug}-${row.batch_number ?? 1}`}>
                    <div className="module-preview-copy">
                      <div className="module-preview-top">
                        <strong>{`Batch ${row.batch_number ?? 1}`}</strong>
                        {showStatusBadge && (
                          <span className={`batch-status-badge is-${status.tone}`}>{status.label}</span>
                        )}
                        {showNotAttemptedTag && (
                          <span className="batch-status-badge is-muted">Not attempted</span>
                        )}
                      </div>
                      {metaBits.length > 0 && (
                        <p className="module-preview-meta">{metaBits.join(" - ")}</p>
                      )}
                      {supportCopy && <p className="module-preview-note">{supportCopy}</p>}
                    </div>

                    <div className="module-preview-actions">
                      <DashboardActionButton action={primaryAction} />
                      <DashboardActionButton action={secondaryAction} className="ghost-button dashboard-soft-button" />
                    </div>
                  </article>
                );
              })}
            </div>
          </article>
        </section>
      </section>

      {showOnboardingModal && (
        <ProfileOnboardingModal
          key={subjectSlug}
          nextPath={onboardingTarget ?? `/modules/${subjectSlug}`}
          onClose={closeOnboardingModal}
          onComplete={async () => {
            await loadModuleData({ showLoading: false });
            setShowOnboardingModal(false);
            setOnboardingTarget(null);
          }}
        />
      )}

      <FreeBatchConfirmationModal
        loading={startingBatch}
        onCancel={() => setStartConfirmSubject(null)}
        onConfirm={() => void confirmStartFreeBatch()}
        subject={startConfirmSubject}
      />
    </AppFrame>
  );
}
