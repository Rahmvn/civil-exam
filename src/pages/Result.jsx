import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { getAttemptReview } from "../lib/appApi";
import { friendlyErrorMessage, isExpectedAbortError, logAppError } from "../lib/errors";
import { getModuleDisplayName } from "../lib/moduleDisplay";

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
      <span>{passed ? "✓" : "×"}</span>
    </div>
  );
}

export default function Result() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const attemptId = searchParams.get("attempt") ?? location.state?.result?.attempt_id ?? null;
  const [rows, setRows] = useState([]);
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
        const nextRows = await getAttemptReview(attemptId);
        if (!active) return;
        setRows(Array.isArray(nextRows) ? nextRows : []);
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
  }, [attemptId]);

  const summary = useMemo(
    () => getResultSummary(rows, location.state),
    [location.state, rows],
  );

  if (loading) {
    return (
      <AppFrame showBottomNav={false} showFooter={false}>
        <section className="result-page">
          <article className="state-card page-loading-card">
            <p>Preparing your result...</p>
          </article>
        </section>
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

  const reviewPath = `/review?attempt=${summary.attemptId}`;
  const retryPath = summary.subjectSlug
    ? `/practice/${summary.subjectSlug}?batch=${summary.batchNumber}`
    : "/dashboard";
  const nextBatchPath = summary.subjectSlug && summary.nextBatchNumber
    ? `/practice/${summary.subjectSlug}?batch=${summary.nextBatchNumber}`
    : null;
  const showNextBatch = summary.passed && summary.nextAction === "next_batch" && nextBatchPath;
  const showRetry = !summary.passed && summary.canRetry;

  return (
    <AppFrame showBottomNav={false} showFooter={false}>
      <section className={`result-page ${summary.passed ? "is-pass" : "is-retry"}`}>
        <article className="dashboard-panel-card result-card">
          <ResultMark passed={summary.passed} />

          <div className="result-heading">
            <p>{summary.subjectName}</p>
            <h1>{summary.passed ? "You passed" : "Keep going"}</h1>
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

          <div className="result-actions">
            <Link className="primary-action" state={{ returnTo: `/result?attempt=${summary.attemptId}` }} to={reviewPath}>
              Review answers
            </Link>
            {showNextBatch ? (
              <Link className="result-secondary-action" to={nextBatchPath}>
                {`Start Batch ${summary.nextBatchNumber}`}
              </Link>
            ) : showRetry ? (
              <Link className="result-secondary-action" to={retryPath}>Retry</Link>
            ) : (
              <Link className="result-secondary-action" to="/dashboard">Back to dashboard</Link>
            )}
          </div>
        </article>
      </section>
    </AppFrame>
  );
}
