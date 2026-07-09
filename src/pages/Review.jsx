import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { getAttemptReview, getReviewQueue } from "../lib/appApi";
import { friendlyErrorMessage, isExpectedAbortError, logAppError } from "../lib/errors";

function getPercent(score, total) {
  if (!total) return 0;
  return Math.round((score / total) * 100);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
}

function getActionConfig(summary) {
  const subjectSlug = summary?.subjectSlug ?? null;
  const currentBatchNumber = Number(summary?.batchNumber ?? 1);
  const nextBatchNumber = Number(summary?.nextBatchNumber ?? 0) || null;
  const retryPath = subjectSlug ? `/practice/${subjectSlug}?batch=${currentBatchNumber}` : "/dashboard";
  const nextPath = subjectSlug && nextBatchNumber ? `/practice/${subjectSlug}?batch=${nextBatchNumber}` : "/dashboard";

  switch (summary?.nextAction) {
    case "next_batch":
      return {
        primaryLabel: nextBatchNumber ? `Start Batch ${nextBatchNumber}` : "Continue",
        primaryTo: nextPath,
        secondaryLabel: "Back to dashboard",
        secondaryTo: "/dashboard",
      };
    case "retry_or_next":
      return {
        primaryLabel: `Retry Batch ${currentBatchNumber}`,
        primaryTo: retryPath,
        secondaryLabel: nextBatchNumber ? `Try Batch ${nextBatchNumber}` : "Back to dashboard",
        secondaryTo: nextBatchNumber ? nextPath : "/dashboard",
      };
    case "retry_free_batch":
      return {
        primaryLabel: `Retry Batch ${currentBatchNumber}`,
        primaryTo: retryPath,
        secondaryLabel: "Back to dashboard",
        secondaryTo: "/dashboard",
      };
    case "unlock_full_access":
      return {
        primaryLabel: "Unlock full access",
        primaryTo: "/access",
        secondaryLabel: "Back to dashboard",
        secondaryTo: "/dashboard",
      };
    case "review_only":
      return {
        primaryLabel: `Retry Batch ${currentBatchNumber}`,
        primaryTo: retryPath,
        secondaryLabel: "Back to dashboard",
        secondaryTo: "/dashboard",
      };
    case "module_complete":
      return {
        primaryLabel: "Back to dashboard",
        primaryTo: "/dashboard",
        secondaryLabel: `Retry Batch ${currentBatchNumber}`,
        secondaryTo: retryPath,
      };
    default:
      return {
        primaryLabel: "Back to dashboard",
        primaryTo: "/dashboard",
      };
  }
}

function getOutcomeText(summary) {
  if (!summary) return "Complete a batch and your review will appear here.";

  switch (summary.nextAction) {
    case "next_batch":
      return summary.nextBatchNumber
        ? `You passed this batch. Batch ${summary.nextBatchNumber} is available next.`
        : "You passed this batch.";
    case "retry_or_next":
      return "You scored below 70%. You can retry, or continue if another published batch is available.";
    case "retry_free_batch":
      return "You scored below 70%. You can retry your free batch once.";
    case "unlock_full_access":
      return "Full access is required to continue beyond this point.";
    case "module_complete":
      return "You passed the latest published batch in this module.";
    default:
      return "Review your mistakes, then retry this batch.";
  }
}

export default function Review() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const attemptId = searchParams.get("attempt");
  const [reviewRows, setReviewRows] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadReview() {
      try {
        const [nextReview, nextQueue] = await Promise.all([
          getAttemptReview(attemptId),
          getReviewQueue(8),
        ]);

        if (!active) return;
        setReviewRows(Array.isArray(nextReview) ? nextReview : []);
        setReviewQueue(Array.isArray(nextQueue) ? nextQueue : []);
      } catch (loadError) {
        if (!active || isExpectedAbortError(loadError)) return;
        logAppError("Review load", loadError);
        setError(
          friendlyErrorMessage(loadError, "We could not load the review page. Please try again."),
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadReview();

    return () => {
      active = false;
    };
  }, [attemptId]);

  const orderedReviewRows = useMemo(
    () =>
      [...reviewRows].sort(
        (left, right) =>
          Number(left.display_order ?? 0) - Number(right.display_order ?? 0),
      ),
    [reviewRows],
  );

  const reviewSummary = useMemo(() => {
    if (orderedReviewRows.length === 0) return null;
    const first = orderedReviewRows[0];

    return {
      attemptId: first.attempt_id,
      completedAt: first.completed_at,
      score: first.score,
      totalQuestions: first.total_questions,
      subjectId: first.subject_id,
      subjectName: first.subject_name,
      subjectSlug: first.subject_slug,
      batchNumber: Number(first.batch_number ?? 1),
      scorePercent: Number(first.score_percent ?? getPercent(first.score, first.total_questions)),
      passed: Boolean(first.passed),
      retryNumber: Number(first.retry_number ?? 0),
      nextAction: first.next_action ?? "review_only",
      passMarkPercent: Number(first.pass_mark_percent ?? location.state?.passMarkPercent ?? 70),
      nextBatchNumber: Number(first.next_batch_number ?? 0) || null,
      canRetry: Boolean(first.can_retry ?? true),
    };
  }, [location.state?.passMarkPercent, orderedReviewRows]);

  const fallbackSummary = useMemo(() => {
    const result = location.state?.result;
    if (!result) return null;

    const totalQuestions = Number(result.total_questions ?? 0);
    const score = Number(result.score ?? 0);
    const subjectSlug = location.state?.subject?.slug ?? null;

    return {
      attemptId: result.attempt_id ?? null,
      completedAt: result.completed_at ?? null,
      score,
      totalQuestions,
      subjectId: location.state?.subject?.id ?? null,
      subjectName: location.state?.subject?.name ?? result.subject_name ?? "Module batch",
      subjectSlug,
      batchNumber: Number(result.batch_number ?? location.state?.batchNumber ?? 1),
      scorePercent: Number(result.score_percent ?? getPercent(score, totalQuestions)),
      passed: Boolean(result.passed),
      retryNumber: Number(result.retry_number ?? 0),
      nextAction: result.next_action ?? "review_only",
      passMarkPercent: Number(location.state?.passMarkPercent ?? 70),
      nextBatchNumber: Number(result.next_batch_number ?? 0) || null,
      canRetry: result.can_retry ?? true,
    };
  }, [location.state]);

  const activeSummary = reviewSummary ?? fallbackSummary;
  const correctCount = activeSummary?.score ?? 0;
  const totalQuestions = activeSummary?.totalQuestions ?? 0;
  const wrongCount = Math.max(totalQuestions - correctCount, 0);
  const actionConfig = getActionConfig(activeSummary);
  const outcomeText = getOutcomeText(activeSummary);
  const summaryReady = Boolean(activeSummary);
  const showInitialLoading = loading && !summaryReady;

  return (
    <AppFrame>
      <section className="review-page">
        <header className="review-page-header">
          <div>
            <p className="eyebrow">Review</p>
            <h1>Review your batch</h1>
            <p>{outcomeText}</p>
          </div>
          <Link className="secondary-action" to="/dashboard">
            Back to dashboard
          </Link>
        </header>

        {showInitialLoading ? (
          <section className="state-card">Loading your review...</section>
        ) : (
          <>
            {error && <section className="state-card inline-state">{error}</section>}

            <section className="review-summary-card">
              <div className="review-summary-main">
                <div className="review-summary-copy">
                  <p className="eyebrow">Latest result</p>
                  <h2>{activeSummary?.subjectName ?? "No completed batch yet"}</h2>
                  {activeSummary ? (
                    <p>
                      {`Batch ${activeSummary.batchNumber} · ${activeSummary.passed ? "Passed" : "Retry required"} · Pass mark ${activeSummary.passMarkPercent}%`}
                    </p>
                  ) : (
                    <p>No completed batch found yet.</p>
                  )}
                </div>
                {activeSummary && (
                  <span className={`review-result-badge ${activeSummary.passed ? "is-pass" : "is-retry"}`}>
                    {activeSummary.passed ? "Passed" : "Retry required"}
                  </span>
                )}
              </div>

              {activeSummary && (
                <>
                  <div className="review-metric-grid">
                    <article>
                      <span>Score</span>
                      <strong>{activeSummary.scorePercent}%</strong>
                    </article>
                    <article>
                      <span>Correct</span>
                      <strong>{correctCount}</strong>
                    </article>
                    <article>
                      <span>Wrong</span>
                      <strong>{wrongCount}</strong>
                    </article>
                    <article>
                      <span>Completed</span>
                      <strong>{formatDate(activeSummary.completedAt) || "Today"}</strong>
                    </article>
                  </div>

                  {activeSummary.retryNumber > 0 && (
                    <p className="review-summary-note">{`Retry attempt: ${activeSummary.retryNumber}`}</p>
                  )}

                  <div className="review-summary-actions">
                    <Link className="primary-action" to={actionConfig.primaryTo}>
                      {actionConfig.primaryLabel}
                    </Link>
                    {actionConfig.secondaryTo && (
                      <Link className="secondary-action" to={actionConfig.secondaryTo}>
                        {actionConfig.secondaryLabel}
                      </Link>
                    )}
                  </div>
                </>
              )}
            </section>

            {loading && summaryReady && (
              <section className="state-card inline-state">Loading full answer review...</section>
            )}

            {orderedReviewRows.length > 0 && (
              <section className="review-answer-list">
                {orderedReviewRows.map((row, index) => {
                  const answerText = row.selected_option
                    ? row[`option_${row.selected_option.toLowerCase()}`]
                    : "Not answered";
                  const correctText = row.correct_option
                    ? row[`option_${row.correct_option.toLowerCase()}`]
                    : "";

                  return (
                    <article key={row.question_id} className="review-answer-card">
                      <div className="review-answer-top">
                        <div>
                          <span>{`Question ${Number(row.display_order ?? index + 1)}`}</span>
                          <strong>{`Batch ${row.batch_number}`}</strong>
                        </div>
                        <span className={`review-answer-state ${row.is_correct ? "is-correct" : "is-wrong"}`}>
                          {row.is_correct ? "Correct" : "Incorrect"}
                        </span>
                      </div>

                      <h3>{row.question_text}</h3>

                      <div className="review-answer-grid">
                        <div>
                          <span>Your answer</span>
                          <p>{row.selected_option ? `${row.selected_option}. ${answerText}` : "Not answered"}</p>
                        </div>
                        <div>
                          <span>Correct answer</span>
                          <p>{row.correct_option ? `${row.correct_option}. ${correctText}` : "Answer key will be added."}</p>
                        </div>
                      </div>

                      <div className="review-explanation">
                        <strong>Explanation</strong>
                        <p>{row.explanation?.trim() || "Explanation will be added."}</p>
                        <p>
                          <strong>Reference:</strong>{" "}
                          {row.reference_note?.trim() || "Reference will be added."}
                        </p>
                      </div>
                    </article>
                  );
                })}
              </section>
            )}

            {reviewQueue.length > 0 && (
              <section className="review-side-section">
                <div className="dashboard-section-heading">
                  <div>
                    <p className="eyebrow">Review queue</p>
                    <h2>Questions worth revisiting</h2>
                  </div>
                </div>
                <div className="dashboard-attempt-list">
                  {reviewQueue.map((item) => (
                    <article key={item.question_id}>
                      <div>
                        <strong>{item.subject_name}</strong>
                        <span>{item.question_text}</span>
                      </div>
                      <span className="dashboard-mini-tag">{item.times_missed} misses</span>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </section>
    </AppFrame>
  );
}
