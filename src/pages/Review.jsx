import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { getAttemptReview, getModuleProgress, getReviewQueue } from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";

function getPercent(score, total) {
  if (!total) return 0;
  return Math.round((score / total) * 100);
}

function getActionConfig(nextAction, subjectSlug) {
  switch (nextAction) {
    case "proceed_next_batch":
      return {
        primaryLabel: "Proceed to next batch",
        primaryTo: subjectSlug ? `/practice/${subjectSlug}` : "/dashboard",
        secondaryLabel: "Back to dashboard",
        secondaryTo: "/dashboard",
      };
    case "retry_batch":
      return {
        primaryLabel: "Retry this batch",
        primaryTo: subjectSlug ? `/practice/${subjectSlug}` : "/dashboard",
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
    default:
      return {
        primaryLabel: "Back to dashboard",
        primaryTo: "/dashboard",
      };
  }
}

export default function Review() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const attemptId = searchParams.get("attempt");
  const [reviewRows, setReviewRows] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [moduleProgress, setModuleProgress] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadReview() {
      try {
        const [nextReview, nextQueue, nextProgress] = await Promise.all([
          getAttemptReview(attemptId),
          getReviewQueue(10),
          getModuleProgress(),
        ]);

        setReviewRows(Array.isArray(nextReview) ? nextReview : []);
        setReviewQueue(Array.isArray(nextQueue) ? nextQueue : []);
        setModuleProgress(Array.isArray(nextProgress) ? nextProgress : []);
      } catch (loadError) {
        logAppError("Review load", loadError);
        setError(
          friendlyErrorMessage(loadError, "We could not load the review page. Please try again."),
        );
      } finally {
        setLoading(false);
      }
    }

    void loadReview();
  }, [attemptId]);

  const reviewSummary = useMemo(() => {
    if (reviewRows.length === 0) return null;
    const first = reviewRows[0];
    const progressForSubject = moduleProgress.find((item) => item.subject_id === first.subject_id);

    return {
      attemptId: first.attempt_id,
      completedAt: first.completed_at,
      score: first.score,
      totalQuestions: first.total_questions,
      subjectId: first.subject_id,
      subjectName: first.subject_name,
      batchNumber: Number(first.batch_number ?? 1),
      scorePercent: Number(first.score_percent ?? getPercent(first.score, first.total_questions)),
      passed: Boolean(first.passed),
      retryNumber: Number(first.retry_number ?? 0),
      nextAction: first.next_action ?? "back_to_dashboard",
      passMarkPercent: Number(
        progressForSubject?.pass_mark_percent ?? location.state?.passMarkPercent ?? 70,
      ),
      subjectSlug:
        progressForSubject?.subject_slug ??
        location.state?.subject?.slug ??
        null,
    };
  }, [location.state?.passMarkPercent, location.state?.subject?.slug, moduleProgress, reviewRows]);

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
      subjectName: location.state?.subject?.name ?? result.subject_name ?? "Module session",
      batchNumber: Number(result.batch_number ?? 1),
      scorePercent: Number(result.score_percent ?? getPercent(score, totalQuestions)),
      passed: Boolean(result.passed),
      retryNumber: Number(result.retry_number ?? 0),
      nextAction: result.next_action ?? "back_to_dashboard",
      passMarkPercent: Number(location.state?.passMarkPercent ?? 70),
      subjectSlug,
    };
  }, [location.state]);

  const activeSummary = reviewSummary ?? fallbackSummary;
  const hasAttemptHistory = Boolean(activeSummary) || reviewQueue.length > 0;
  const actionConfig = getActionConfig(activeSummary?.nextAction, activeSummary?.subjectSlug);

  const recommendedAction = useMemo(() => {
    if (!activeSummary) return "Complete a batch to start review.";
    if (activeSummary.nextAction === "proceed_next_batch") {
      return "You passed this batch. Continue to the next batch when you are ready.";
    }
    if (activeSummary.nextAction === "unlock_full_access") {
      return "Full access is required to continue beyond this point.";
    }
    return "Review your mistakes, then retry this batch.";
  }, [activeSummary]);

  return (
    <AppFrame>
      <section className="practice-shell">
        <header className="practice-topbar">
          <div>
            <p className="eyebrow">Review</p>
            <h1 className="page-title">Review your batch result.</h1>
          </div>
          <div className="practice-topbar-actions">
            <Link className="text-link" to="/dashboard">
              Dashboard
            </Link>
          </div>
        </header>

        {loading ? (
          <section className="state-card">Loading your review...</section>
        ) : (
          <>
            {error && <section className="state-card inline-state">{error}</section>}

            <section className="result-summary">
              <p className="eyebrow">Latest batch</p>
              <h1>{activeSummary?.scorePercent ?? 0}%</h1>
              <p>
                {activeSummary
                  ? `${activeSummary.subjectName} - Batch ${activeSummary.batchNumber}`
                  : "No completed batch found yet."}
              </p>
              {activeSummary && (
                <>
                  <p className="support-copy">
                    {`${activeSummary.score}/${activeSummary.totalQuestions} correct · Pass mark ${activeSummary.passMarkPercent}% · ${activeSummary.passed ? "Passed" : "Retry required"}`}
                  </p>
                  <p className="support-copy">{recommendedAction}</p>
                  {activeSummary.retryNumber > 0 && (
                    <p className="support-copy">Retry attempt: {activeSummary.retryNumber}</p>
                  )}
                </>
              )}
              <div className="hero-actions">
                <Link className="primary-action" to={actionConfig.primaryTo}>
                  {actionConfig.primaryLabel}
                </Link>
                {actionConfig.secondaryTo && (
                  <Link className="secondary-action" to={actionConfig.secondaryTo}>
                    {actionConfig.secondaryLabel}
                  </Link>
                )}
              </div>
              {fallbackSummary && !reviewSummary && (
                <p className="support-copy">Your latest result is being prepared for review.</p>
              )}
            </section>

            {reviewRows.length > 0 && (
              <section className="review-list">
                {reviewRows.map((row, index) => {
                  const answerText = row.selected_option
                    ? row[`option_${row.selected_option.toLowerCase()}`]
                    : "Not answered";
                  const correctText = row.correct_option
                    ? row[`option_${row.correct_option.toLowerCase()}`]
                    : "";

                  return (
                    <article key={row.question_id} className="review-card">
                      <div className="review-card-header">
                        <span>
                          Q{index + 1} - Batch {row.batch_number} - {row.subject_name}
                        </span>
                        <strong className={row.is_correct ? "is-correct" : "is-wrong"}>
                          {row.is_correct ? "Correct" : "Incorrect"}
                        </strong>
                      </div>
                      <h2>{row.question_text}</h2>
                      <div className="review-answer">
                        <p>
                          <strong>Your answer:</strong>{" "}
                          {row.selected_option ? `${row.selected_option}. ${answerText}` : "Not answered"}
                        </p>
                        <p>
                          <strong>Correct answer:</strong>{" "}
                          {row.correct_option ? `${row.correct_option}. ${correctText}` : "Answer key will be added."}
                        </p>
                      </div>
                      <div className="explanation-box">
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

            <section className="landing-section compact-section">
              <div className="section-heading left-heading">
                <p className="eyebrow">Weak-area queue</p>
                <h2>Questions worth seeing again.</h2>
              </div>
              {!hasAttemptHistory ? (
                <section className="side-panel">
                  <p className="support-copy">Weak areas will appear after real attempts.</p>
                </section>
              ) : reviewQueue.length === 0 ? (
                <section className="side-panel">
                  <p className="support-copy">Your weak-area queue will build up as you practise.</p>
                </section>
              ) : (
                <div className="review-list">
                  {reviewQueue.map((item) => (
                    <article key={item.question_id} className="review-card compact-review-card">
                      <div className="review-card-header">
                        <span>{item.subject_name}</span>
                        <strong>{item.times_missed} misses</strong>
                      </div>
                      <h2>{item.question_text}</h2>
                      <div className="explanation-box">
                        <strong>Answer</strong>
                        <p>
                          {item.correct_option
                            ? `${item.correct_option}. ${item[`option_${item.correct_option.toLowerCase()}`] ?? "Answer text will be added."}`
                            : "Answer key will be added."}
                        </p>
                        <p>{item.explanation?.trim() || "Explanation will be added."}</p>
                        <p>
                          <strong>Reference:</strong>{" "}
                          {item.reference_note?.trim() || "Reference will be added."}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </section>
    </AppFrame>
  );
}
