import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import {
  AnimatedProgressBar,
  DashboardActionButton,
  FreeBatchConfirmationModal,
  ScoreRing,
} from "../components/DashboardUi";
import {
  getCandidateSummary,
  getModuleBatchAccess,
  getRecentAttempts,
  getReviewQueue,
  getSubjects,
  startPracticeBatch,
} from "../lib/appApi";
import { friendlyErrorMessage, isExpectedAbortError, logAppError } from "../lib/errors";
import {
  FALLBACK_SUBJECTS,
  formatAttemptPercent,
  formatDate,
  formatPercent,
  getFirstName,
  getModuleDisplayName,
  getProgressionRecommendation,
  isPublishedBatchRow,
} from "../lib/moduleDisplay";
import { storePracticeBatch } from "../lib/practiceSession";
import { getPracticeRoute } from "../lib/oralPractice";
import { useAuth } from "../lib/useAuth";

export default function Dashboard() {
  const { profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const mountedRef = useRef(true);
  const [summary, setSummary] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [moduleBatchAccess, setModuleBatchAccess] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subjectsNotice, setSubjectsNotice] = useState("");
  const [attemptsNotice, setAttemptsNotice] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [startConfirmSubject, setStartConfirmSubject] = useState(null);
  const [startingBatch, setStartingBatch] = useState(false);
  const [ctaError, setCtaError] = useState("");

  const loadDashboardData = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading && mountedRef.current) setLoading(true);

    const requests = [
      { key: "summary", promise: getCandidateSummary() },
      { key: "subjects", promise: getSubjects() },
      { key: "batchAccess", promise: getModuleBatchAccess() },
      { key: "attempts", promise: getRecentAttempts(12) },
      { key: "review", promise: getReviewQueue(6) },
    ];
    const results = await Promise.allSettled(requests.map((item) => item.promise));

    if (!mountedRef.current) return;

    requests.forEach((request, index) => {
      const result = results[index];

      if (result.status === "fulfilled") {
        if (request.key === "summary") setSummary(result.value);
        if (request.key === "subjects") {
          setSubjects(Array.isArray(result.value) ? result.value : []);
          setSubjectsNotice("");
        }
        if (request.key === "batchAccess") setModuleBatchAccess(Array.isArray(result.value) ? result.value : []);
        if (request.key === "attempts") {
          setAttempts(Array.isArray(result.value) ? result.value : []);
          setAttemptsNotice("");
        }
        if (request.key === "review") {
          setReviewQueue(Array.isArray(result.value) ? result.value : []);
          setReviewNotice("");
        }
        return;
      }

      const error = result.reason;
      if (isExpectedAbortError(error)) return;
      logAppError(`Dashboard ${request.key}`, error);

      if (request.key === "summary") setSummary(null);
      if (request.key === "subjects") {
        setSubjects([]);
        setSubjectsNotice("Modules are not available right now.");
      }
      if (request.key === "batchAccess") setModuleBatchAccess([]);
      if (request.key === "attempts") {
        setAttempts([]);
        setAttemptsNotice("Recent attempts could not be loaded right now.");
      }
      if (request.key === "review") {
        setReviewQueue([]);
        setReviewNotice("Review items are not available right now.");
      }
    });

    if (mountedRef.current) setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadDashboardData();
    return () => {
      mountedRef.current = false;
    };
  }, [loadDashboardData]);

  const subjectsForDisplay = subjects.length > 0 ? subjects : FALLBACK_SUBJECTS;
  const batchAccessBySubject = useMemo(() => {
    const grouped = {};

    moduleBatchAccess.forEach((row) => {
      if (!row?.subject_slug) return;
      grouped[row.subject_slug] ??= [];
      grouped[row.subject_slug].push(row);
    });

    Object.values(grouped).forEach((rows) => {
      rows.sort((left, right) => Number(left.batch_number ?? 0) - Number(right.batch_number ?? 0));
    });

    return grouped;
  }, [moduleBatchAccess]);

  const freeModuleSlug = summary?.free_module_subject_slug ?? null;
  const hasSelectedFreeModule = Boolean(freeModuleSlug);
  const unlockedModuleCount = useMemo(() => new Set(
    moduleBatchAccess
      .filter((row) => row?.is_paid)
      .map((row) => row.subject_slug)
      .filter(Boolean),
  ).size, [moduleBatchAccess]);
  const firstName = getFirstName(profile?.full_name);
  const averageScore = attempts.length > 0
    ? Math.round(
        attempts.reduce(
          (sum, attempt) => sum + Number(attempt.score_percent ?? formatAttemptPercent(attempt) ?? 0),
          0,
        ) / attempts.length,
      )
    : 0;
  const previewAttempts = attempts.slice(0, 2);
  const reviewQueueCount = reviewQueue.length;
  useEffect(() => {
    if (loading || location.hash !== "#modules") return;
    const target = document.getElementById("modules");
    if (!target) return;
    const frameId = window.requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frameId);
  }, [loading, location.hash]);

  function buildModuleAction(subject, rows, progression, completedCount, publishedCount, hasModuleAccess) {
    const recommendedRow = progression.recommendedRow;
    const batchOneRow = rows.find((row) => Number(row.batch_number ?? 0) === 1) ?? recommendedRow;
    const targetRow = !hasModuleAccess ? batchOneRow : recommendedRow;
    const batchNumber = Number(targetRow?.batch_number ?? 1);

    if (publishedCount === 0 || !targetRow) {
      return { label: "Coming soon", disabled: true };
    }

    if (hasModuleAccess && completedCount === publishedCount) {
      return { label: "Practice again", to: `/modules/${subject.slug}` };
    }

    if (!hasModuleAccess && !hasSelectedFreeModule && targetRow.reason_code === "free_batch_available") {
      return {
        label: "Try free",
        action: () => {
          setCtaError("");
          setStartConfirmSubject(subject);
        },
      };
    }

    if (targetRow.state === "locked_requires_payment" || !targetRow.can_start) {
      return { label: "Unlock module", to: `/access?module=${encodeURIComponent(subject.slug)}` };
    }

    if (targetRow.state === "completed_failed") {
      return { label: "Retry practice", to: getPracticeRoute(subject, batchNumber) };
    }

    if (!hasModuleAccess && targetRow.state === "completed_passed") {
      return { label: "Unlock module", to: `/access?module=${encodeURIComponent(subject.slug)}` };
    }

    if (Number(targetRow.attempt_count ?? 0) > 0) {
      return { label: "Continue practice", to: getPracticeRoute(subject, batchNumber) };
    }

    return {
      label: subject.slug === freeModuleSlug ? "Continue practice" : "Start practice",
      to: getPracticeRoute(subject, batchNumber),
    };
  }

  const moduleCards = subjectsForDisplay.map((subject) => {
    const rows = batchAccessBySubject[subject.slug] ?? [];
    const publishedRows = rows.filter(isPublishedBatchRow);
    const batchOneRow = rows.find((row) => Number(row.batch_number ?? 0) === 1) ?? null;
    const hasModuleAccess = rows.some((row) => Boolean(row?.is_paid));
    const hasModuleActivity = hasModuleAccess || publishedRows.some((row) =>
      Number(row?.attempt_count ?? 0) > 0
      || row?.state === "completed_passed"
      || row?.state === "completed_failed"
    );
    const completedCount = publishedRows.filter((row) => row.state === "completed_passed").length;
    const progression = getProgressionRecommendation(rows, { isPaidUser: hasModuleAccess });
    const progressPercent = publishedRows.length > 0
      ? Math.round((completedCount / publishedRows.length) * 100)
      : 0;
    const isComingSoon = subject.slug === "current-affairs" || publishedRows.length === 0;
    const primaryAction = isComingSoon
      ? { label: "Coming soon", disabled: true }
      : buildModuleAction(subject, rows, progression, completedCount, publishedRows.length, hasModuleAccess);
    const secondaryAction = hasModuleAccess && publishedRows.length > 0 && completedCount < publishedRows.length
      ? { label: "Choose another practice set", to: `/modules/${subject.slug}` }
      : !hasModuleAccess && primaryAction.label !== "Unlock module" && !isComingSoon
        ? { label: "Unlock module", to: `/access?module=${encodeURIComponent(subject.slug)}` }
        : null;

    return {
      subject,
      displayName: getModuleDisplayName(subject.name),
      completedCount,
      publishedCount: publishedRows.length,
      progressPercent,
      isComingSoon,
      isComplete: publishedRows.length > 0 && completedCount === publishedRows.length,
      hasModuleAccess,
      showProgress: hasModuleActivity,
      freePracticeComplete: Boolean(
        batchOneRow?.state === "completed_passed"
        || (batchOneRow?.state === "completed_failed" && !batchOneRow?.can_start)
        || batchOneRow?.reason_code === "free_retry_used_requires_payment"
        || batchOneRow?.reason_code === "free_batch_passed_requires_payment"
      ),
      primaryAction,
      secondaryAction,
    };
  });

  const accessCopy = (() => {
    if (unlockedModuleCount > 0) {
      return `${unlockedModuleCount} module${unlockedModuleCount === 1 ? "" : "s"} unlocked.`;
    }
    if (!hasSelectedFreeModule) return "Begin free or unlock any module.";

    const selectedCard = moduleCards.find((card) => card.subject.slug === freeModuleSlug);
    if (selectedCard?.freePracticeComplete) return "Your free practice is complete.";
    return `${selectedCard?.displayName ?? "One module"} selected for free practice.`;
  })();
  const moduleChoiceCopy = !hasSelectedFreeModule
    ? "Try one module free, or unlock any module now."
    : unlockedModuleCount > 0
      ? "Continue practising or unlock another module."
      : "Continue your free module or unlock any module.";

  async function confirmStartFreeBatch() {
    if (!startConfirmSubject) return;
    setStartingBatch(true);
    setCtaError("");

    try {
      if (startConfirmSubject.practice_type === "oral") {
        const nextPath = getPracticeRoute(startConfirmSubject, 1);
        setStartConfirmSubject(null);
        navigate(nextPath);
        return;
      }

      const batch = await startPracticeBatch(startConfirmSubject.slug, 1);
      storePracticeBatch(startConfirmSubject.slug, batch);
      setStartConfirmSubject(null);
      navigate(`/practice/${startConfirmSubject.slug}?batch=1`, { state: { batchStarted: true } });
    } catch (error) {
      logAppError(`Dashboard start practice:${startConfirmSubject.slug}`, error);
      setCtaError(friendlyErrorMessage(error, "We could not start this practice right now."));
      setStartConfirmSubject(null);
    } finally {
      setStartingBatch(false);
    }
  }

  if (loading) {
    return (
      <AppFrame>
        <LoadingState />
      </AppFrame>
    );
  }

  return (
    <AppFrame>
      <section className="dashboard-hub dashboard-hub-compact dashboard-module-first">
        <section className={`dashboard-welcome-panel dashboard-welcome-panel-compact ${attempts.length === 0 ? "without-score" : ""}`.trim()}>
          <div className="dashboard-welcome-copy dashboard-welcome-copy-intro">
            <h1>{firstName ? `Welcome, ${firstName}` : "Welcome"}</h1>
            <div className="dashboard-welcome-access-line">
              <span className={`dashboard-access-chip ${unlockedModuleCount > 0 ? "is-full" : "is-free"}`}>
                {unlockedModuleCount > 0 ? "Module access" : "Free practice available"}
              </span>
              <p>{accessCopy}</p>
            </div>
          </div>
          {attempts.length > 0 && (
            <ScoreRing
              className="dashboard-welcome-score"
              label="Average score"
              sublabel={`Based on last ${attempts.length} attempt${attempts.length === 1 ? "" : "s"}`}
              value={averageScore}
            />
          )}
        </section>

        {ctaError && <p className="action-error" role="alert">{ctaError}</p>}

        <section className="dashboard-section-block" id="modules">
          <div className="dashboard-section-heading">
            <div className="dashboard-section-heading-copy">
              <h2>Modules</h2>
              <p className="dashboard-module-choice-copy">{moduleChoiceCopy}</p>
            </div>
            {subjectsNotice && <p className="section-note">{subjectsNotice}</p>}
          </div>

          <div className="dashboard-module-grid-v3">
            {moduleCards.map((card) => (
              <article className={`module-card-v3 module-card-progressive ${card.hasModuleAccess ? "is-unlocked" : ""} ${card.isComplete ? "is-complete" : ""}`.trim()} key={card.subject.id}>
                <div className="module-card-v3-head">
                  <h3>{card.displayName}</h3>
                  {card.hasModuleAccess && !card.isComplete && (
                    <span className="module-access-state">Unlocked</span>
                  )}
                </div>

                <div className={`module-card-progressive-body ${card.showProgress ? "has-progress" : ""}`.trim()}>
                  {card.isComingSoon ? (
                    <p className="module-card-availability">Practice for this module is coming soon.</p>
                  ) : card.showProgress ? (
                    <div className="module-progress-summary">
                      <div className="module-progress-summary-copy">
                        <span>{card.isComplete ? "Completed" : "Module progress"}</span>
                        <strong>{`${card.completedCount} of ${card.publishedCount} practice sets completed`}</strong>
                      </div>
                      <AnimatedProgressBar value={card.progressPercent} />
                    </div>
                  ) : null}

                  <div className="module-card-actions module-card-actions-progressive">
                    <DashboardActionButton action={card.primaryAction} />
                    <DashboardActionButton
                      action={card.secondaryAction}
                      className={card.hasModuleAccess ? "module-chooser-link" : "secondary-action module-unlock-action"}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {(previewAttempts.length > 0 || attemptsNotice) && <section className="dashboard-section-block">
          <div className="dashboard-section-heading">
            <div className="dashboard-section-heading-copy"><h2>Recent attempts</h2></div>
          </div>

          <article className="dashboard-panel-card recent-attempts-card">
            {attemptsNotice ? (
              <p className="support-copy">{attemptsNotice}</p>
            ) : (
              <div className="recent-attempts-list">
                {previewAttempts.map((attempt) => {
                  const attemptScore = formatPercent(attempt.score_percent ?? formatAttemptPercent(attempt));
                  return (
                    <article className="recent-attempt-row" key={attempt.id}>
                      <div className="recent-attempt-copy">
                        <strong>{getModuleDisplayName(attempt.subjects?.name) ?? "Module"}</strong>
                        <p>{[
                          `Practice set ${attempt.batch_number ?? 1}`,
                          attemptScore ?? "Score unavailable",
                          attempt.passed ? "Passed" : "Not passed",
                          formatDate(attempt.completed_at ?? attempt.started_at),
                        ].join(" - ")}</p>
                      </div>
                      <Link className="ghost-button" to={`/review?attempt=${attempt.id}`}>Review</Link>
                    </article>
                  );
                })}
              </div>
            )}

            <div className="dashboard-review-handoff">
              {previewAttempts.length > 0 && <Link className="text-link dashboard-inline-link" to="/review">View all reviews</Link>}
              {!reviewNotice && reviewQueueCount > 0 && <p>{`${reviewQueueCount} review item${reviewQueueCount === 1 ? "" : "s"} waiting in Review.`}</p>}
              {reviewNotice && <p>{reviewNotice}</p>}
            </div>
          </article>
        </section>}
      </section>

      <FreeBatchConfirmationModal
        loading={startingBatch}
        onCancel={() => setStartConfirmSubject(null)}
        onConfirm={() => void confirmStartFreeBatch()}
        subject={startConfirmSubject}
      />
    </AppFrame>
  );
}
