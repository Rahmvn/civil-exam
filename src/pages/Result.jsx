import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import { AnimatedProgressBar } from "../components/DashboardUi";
import { getAttemptReview, getModuleBatchAccess } from "../lib/appApi";
import { friendlyErrorMessage, isExpectedAbortError, logAppError } from "../lib/errors";
import {
  getModuleDisplayName,
  getProgressionRecommendation,
  isPublishedBatchRow,
} from "../lib/moduleDisplay";
import { withReturnTo } from "../lib/navigation";

function getResultSummary(rows, navigationState) {
  const first = rows[0] ?? null;
  const submittedResult = navigationState?.result ?? null;

  if (!first && !submittedResult) return null;

  const totalQuestions = Number(first?.total_questions ?? submittedResult?.total_questions ?? 0);
  const correctCount = rows.length > 0
    ? rows.filter((row) => row?.is_correct).length
    : Number(submittedResult?.score ?? 0);
  const answeredCount = rows.length > 0
    ? rows.filter((row) => Boolean(row?.selected_option)).length
    : totalQuestions;
  const wrongCount = Math.max(answeredCount - correctCount, 0);
  const unansweredCount = Math.max(totalQuestions - answeredCount, 0);
  const scorePercent = Number(
    first?.score_percent
      ?? submittedResult?.score_percent
      ?? (totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0),
  );

  return {
    attemptId: first?.attempt_id ?? submittedResult?.attempt_id ?? null,
    subjectName: getModuleDisplayName(
      first?.subject_name ?? navigationState?.subject?.name ?? submittedResult?.subject_name ?? "Practice result",
    ),
    subjectSlug: first?.subject_slug ?? navigationState?.subject?.slug ?? null,
    batchNumber: Number(first?.batch_number ?? submittedResult?.batch_number ?? navigationState?.batchNumber ?? 1),
    scorePercent,
    passed: Boolean(first?.passed ?? submittedResult?.passed),
    passMarkPercent: Number(first?.pass_mark_percent ?? navigationState?.passMarkPercent ?? 70),
    nextAction: first?.next_action ?? submittedResult?.next_action ?? "review_only",
    nextBatchNumber: Number(first?.next_batch_number ?? submittedResult?.next_batch_number ?? 0) || null,
    canRetry: Boolean(first?.can_retry ?? submittedResult?.can_retry ?? true),
    correctCount,
    wrongCount,
    unansweredCount,
  };
}

function ResultMark({ passed }) {
  return (
    <div className={`result-mark ${passed ? "is-pass" : "is-retry"}`} aria-hidden="true">
      <span />
    </div>
  );
}

function ResultConfetti() {
  return (
    <div className="result-confetti" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
    </div>
  );
}

export default function Result() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const attemptId = searchParams.get("attempt") ?? location.state?.result?.attempt_id ?? null;
  const [rows, setRows] = useState([]);
  const [moduleRows, setModuleRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadResult() {
      if (!attemptId) {
        setError("This result could not be found.");
        setLoading(false);
        return;
      }

      try {
        const [reviewResult] = await Promise.allSettled([getAttemptReview(attemptId)]);

        if (!active) return;

        if (reviewResult.status === "rejected") throw reviewResult.reason;

        const nextRows = Array.isArray(reviewResult.value) ? reviewResult.value : [];
        setRows(nextRows);

        const subjectSlug = nextRows[0]?.subject_slug ?? location.state?.subject?.slug ?? null;
        if (subjectSlug) {
          try {
            const nextModuleRows = await getModuleBatchAccess(subjectSlug);
            if (active) setModuleRows(Array.isArray(nextModuleRows) ? nextModuleRows : []);
          } catch (progressError) {
            if (!isExpectedAbortError(progressError)) {
              logAppError("Result module progress", progressError);
            }
          }
        }
      } catch (loadError) {
        if (!active || isExpectedAbortError(loadError)) return;
        logAppError("Result load", loadError);
        setError(friendlyErrorMessage(loadError, "This result could not be loaded."));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadResult();
    return () => {
      active = false;
    };
  }, [attemptId, location.state]);

  const summary = useMemo(
    () => getResultSummary(rows, location.state),
    [location.state, rows],
  );

  const moduleProgress = useMemo(() => {
    const publishedRows = moduleRows.filter(isPublishedBatchRow);
    const completedCount = publishedRows.filter((row) => row.state === "completed_passed").length;
    const hasModuleAccess = moduleRows.some((row) => Boolean(row?.is_paid));
    const progression = getProgressionRecommendation(moduleRows, { isPaidUser: hasModuleAccess });

    return {
      completedCount,
      publishedCount: publishedRows.length,
      percent: publishedRows.length > 0 ? Math.round((completedCount / publishedRows.length) * 100) : 0,
      recommendedRow: progression.hasOpenRecommendation ? progression.recommendedRow : null,
      hasModuleAccess,
    };
  }, [moduleRows]);

  if (loading) {
    return (
      <AppFrame showBottomNav={false} showFooter={false}>
        <LoadingState />
      </AppFrame>
    );
  }

  if (error || !summary || rows.length === 0) {
    return (
      <AppFrame showBottomNav={false} showFooter={false}>
        <section className="result-page">
          <article className="dashboard-panel-card result-unavailable">
            <h1>Result unavailable</h1>
            <p>{error || "This result could not be found."}</p>
            <Link className="secondary-action" to="/dashboard">Back to dashboard</Link>
          </article>
        </section>
      </AppFrame>
    );
  }

  const resultPath = `/result?attempt=${summary.attemptId}`;
  const reviewPath = withReturnTo(`/review?attempt=${summary.attemptId}`, resultPath);
  const retryPath = summary.subjectSlug
    ? `/practice/${summary.subjectSlug}?batch=${summary.batchNumber}`
    : "/dashboard";
  const recommendedBatchNumber = Number(moduleProgress.recommendedRow?.batch_number ?? summary.nextBatchNumber ?? 0) || null;
  const nextPracticePath = summary.subjectSlug && recommendedBatchNumber
    ? `/practice/${summary.subjectSlug}?batch=${recommendedBatchNumber}`
    : null;
  const unlockPath = summary.subjectSlug
    ? `/access?module=${encodeURIComponent(summary.subjectSlug)}`
    : "/access";
  const isFreeCompletion = summary.passed && summary.nextAction === "unlock_module";
  const isModuleComplete = summary.passed && moduleProgress.hasModuleAccess && (
    (moduleProgress.publishedCount > 0 && moduleProgress.completedCount === moduleProgress.publishedCount)
    || (moduleProgress.publishedCount === 0 && summary.nextAction === "module_complete")
  );
  const showRetry = !summary.passed && summary.canRetry;
  const passedPrimaryAction = (() => {
    if (isFreeCompletion) return { label: "Unlock module", to: unlockPath };
    if (isModuleComplete) return { label: "Back to modules", to: "/dashboard#modules" };
    if (nextPracticePath) return { label: "Continue practice", to: nextPracticePath };
    return { label: "Back to modules", to: "/dashboard#modules" };
  })();

  return (
    <AppFrame showBottomNav={false} showFooter={false}>
      <section className={`result-page ${summary.passed ? "is-pass" : "is-retry"}`}>
        <article className="dashboard-panel-card result-card">
          {summary.passed && <ResultConfetti />}
          <ResultMark passed={summary.passed} />

          <div className="result-heading">
            <p>{summary.subjectName}</p>
            <h1>{isModuleComplete ? "Module completed" : summary.passed ? "You passed" : "Keep going"}</h1>
            <span>
              {isModuleComplete
                ? "Excellent work. You completed every published practice set in this module."
                : summary.passed
                  ? "Strong work. You are ready to keep moving."
                  : "Review what you missed, then try again with focus."}
            </span>
          </div>

          <div className="result-score-panel">
            <strong>{`${summary.scorePercent}%`}</strong>
            <span>Your score</span>
            <small>{`Pass mark ${summary.passMarkPercent}%`}</small>
          </div>

          <div className="result-counts" aria-label="Result totals">
            <article><strong>{summary.correctCount}</strong><span>Correct</span></article>
            <article><strong>{summary.wrongCount}</strong><span>Wrong</span></article>
            <article><strong>{summary.unansweredCount}</strong><span>Unanswered</span></article>
          </div>

          {summary.passed && moduleProgress.publishedCount > 0 && (
            <div className="result-module-progress">
              <div>
                <span>Module progress</span>
                <strong>{`${moduleProgress.completedCount} of ${moduleProgress.publishedCount} completed`}</strong>
              </div>
              <AnimatedProgressBar value={moduleProgress.percent} />
            </div>
          )}

          <div className="result-actions">
            {summary.passed ? (
              <>
                <Link className="primary-action" to={passedPrimaryAction.to}>{passedPrimaryAction.label}</Link>
                <Link className="result-secondary-action" to={reviewPath}>
                  Review answers
                </Link>
              </>
            ) : (
              <>
                <Link className="primary-action" to={reviewPath}>
                  Review answers
                </Link>
                {showRetry ? (
                  <Link className="result-secondary-action" to={retryPath}>Retry</Link>
                ) : summary.nextAction === "unlock_module" ? (
                  <Link className="result-secondary-action" to={unlockPath}>Unlock module</Link>
                ) : (
                  <Link className="result-secondary-action" to="/dashboard">Back to dashboard</Link>
                )}
              </>
            )}
          </div>
        </article>
      </section>
    </AppFrame>
  );
}
