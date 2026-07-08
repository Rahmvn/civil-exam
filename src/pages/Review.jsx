import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { getAttemptReview, getReviewQueue } from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";

function getPercent(score, total) {
  if (!total) return 0;
  return Math.round((score / total) * 100);
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
    async function loadReview() {
      try {
        const [nextReview, nextQueue] = await Promise.all([
          getAttemptReview(attemptId),
          getReviewQueue(10),
        ]);

        setReviewRows(Array.isArray(nextReview) ? nextReview : []);
        setReviewQueue(Array.isArray(nextQueue) ? nextQueue : []);
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
    return {
      attemptId: first.attempt_id,
      completedAt: first.completed_at,
      score: first.score,
      totalQuestions: first.total_questions,
      subjectName: first.subject_name,
      percent: getPercent(first.score, first.total_questions),
    };
  }, [reviewRows]);

  const fallbackSummary = useMemo(() => {
    const result = location.state?.result;
    if (!result) return null;

    const totalQuestions = Number(result.total_questions ?? 0);
    const score = Number(result.score ?? 0);

    return {
      attemptId: result.attempt_id ?? null,
      completedAt: result.completed_at ?? null,
      score,
      totalQuestions,
      subjectName: location.state?.subject?.name ?? result.subject_name ?? "Module session",
      percent: getPercent(score, totalQuestions),
    };
  }, [location.state]);

  const activeSummary = reviewSummary ?? fallbackSummary;
  const hasAttemptHistory = Boolean(activeSummary) || reviewQueue.length > 0;

  const recommendedAction = useMemo(() => {
    if (!activeSummary) return "Complete a module session to start review.";
    if (activeSummary.percent >= 70) {
      return "You cleared the mastery line. Repeat the module only if you want a stronger margin.";
    }
    return "Use the weak-area queue below, then return to the same module for another 30-question run.";
  }, [activeSummary]);

  return (
    <AppFrame>
      <section className="practice-shell">
        <header className="practice-topbar">
          <div>
            <p className="eyebrow">Review</p>
            <h1 className="page-title">Check what to reinforce next.</h1>
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
              <p className="eyebrow">Latest session</p>
              <h1>{activeSummary?.percent ?? 0}%</h1>
              <p>
                {activeSummary
                  ? `${activeSummary.subjectName} - ${activeSummary.score}/${activeSummary.totalQuestions}`
                  : "No completed session found yet."}
              </p>
              <p className="support-copy">{recommendedAction}</p>
              <div className="hero-actions">
                {activeSummary && (
                  <Link className="primary-action" to="/dashboard">
                    Back to dashboard
                  </Link>
                )}
                <Link className="secondary-action" to="/profile">
                  View profile
                </Link>
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
                          Q{index + 1} - {row.subject_name}
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
                  <p className="support-copy">Your weak-area queue will build up as you practice.</p>
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
