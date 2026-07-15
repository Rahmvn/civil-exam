import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import { getOralAttemptReview, saveOralSelfRating } from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { getModuleDisplayName } from "../lib/moduleDisplay";

const RATING_OPTIONS = [
  { value: "strong", label: "Strong" },
  { value: "partly_covered", label: "Partly covered" },
  { value: "needs_practice", label: "Needs practice" },
];

function responseLabel(status) {
  if (status === "timed_out") return "Time ended";
  if (status === "skipped") return "No answer";
  return "Answered";
}

export default function OralReview() {
  const [searchParams] = useSearchParams();
  const attemptId = searchParams.get("attempt");
  const [rows, setRows] = useState([]);
  const [ratings, setRatings] = useState({});
  const [savingRating, setSavingRating] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadReview() {
      if (!attemptId) {
        setError("This oral practice review could not be found.");
        setLoading(false);
        return;
      }

      try {
        const nextRows = await getOralAttemptReview(attemptId);
        if (!active) return;
        setRows(nextRows);
        setRatings(Object.fromEntries(nextRows.map((row) => [row.response_id, row.self_rating])));
      } catch (loadError) {
        if (!active) return;
        logAppError("Oral review load", loadError);
        setError(friendlyErrorMessage(loadError, "This oral practice review could not be loaded."));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadReview();
    return () => {
      active = false;
    };
  }, [attemptId]);

  const summary = useMemo(() => ({
    answered: rows.filter((row) => row.response_status === "answered").length,
    noAnswer: rows.filter((row) => row.response_status !== "answered").length,
  }), [rows]);

  async function rateResponse(responseId, rating) {
    const previousRating = ratings[responseId] ?? null;
    setRatings((current) => ({ ...current, [responseId]: rating }));
    setSavingRating(responseId);
    setError("");

    try {
      await saveOralSelfRating(responseId, rating);
    } catch (ratingError) {
      logAppError("Oral review rating", ratingError);
      setRatings((current) => ({ ...current, [responseId]: previousRating }));
      setError(friendlyErrorMessage(ratingError, "We could not save that reflection yet."));
    } finally {
      setSavingRating("");
    }
  }

  if (loading) {
    return <AppFrame showBottomNav={false}><LoadingState /></AppFrame>;
  }

  if (error && rows.length === 0) {
    return (
      <AppFrame showBottomNav={false}>
        <section className="oral-review-page">
          <article className="oral-review-empty">
            <h1>Review unavailable</h1>
            <p>{error}</p>
            <Link className="secondary-action" to="/practice">Back to practice</Link>
          </article>
        </section>
      </AppFrame>
    );
  }

  const first = rows[0];

  return (
    <AppFrame showBottomNav={false}>
      <section className="oral-review-page">
        <header className="oral-review-header">
          <div>
            <p className="eyebrow">Oral practice complete</p>
            <h1>Compare your answers</h1>
            <span>{`${getModuleDisplayName(first?.subject_name)} · Practice set ${first?.set_number}`}</span>
          </div>
          <div className="oral-review-summary" aria-label="Completion summary">
            <span><strong>{summary.answered}</strong> answered</span>
            <span><strong>{summary.noAnswer}</strong> no answer</span>
            <span><strong>{rows.length}</strong> total</span>
          </div>
        </header>

        <p className="oral-review-guidance">
          This is a self-review, not a score. Compare the meaning and key points rather than matching every word.
        </p>
        {error && <p className="action-error" role="alert">{error}</p>}

        <div className="oral-review-list">
          {rows.map((row) => (
            <article className="oral-review-card" key={row.response_id}>
              <header>
                <span>{`Question ${row.display_order}`}</span>
                <strong className={`oral-response-status is-${row.response_status}`}>{responseLabel(row.response_status)}</strong>
              </header>
              <h2>{row.question_text}</h2>

              <div className="oral-review-comparison">
                <section>
                  <h3>Your answer</h3>
                  <p className={row.response_text?.trim() ? "" : "is-empty"}>
                    {row.response_text?.trim() || "No answer was recorded."}
                  </p>
                </section>
                <section>
                  <h3>Model answer</h3>
                  <p>{row.model_answer}</p>
                </section>
              </div>

              <section className="oral-key-points">
                <h3>Key points to check</h3>
                <ul>
                  {(row.key_points ?? []).map((point) => <li key={point}>{point}</li>)}
                </ul>
                {row.reference_note && <p><strong>Reference:</strong> {row.reference_note}</p>}
              </section>

              <fieldset className="oral-rating-fieldset" disabled={savingRating === row.response_id}>
                <legend>How well did your answer cover the key points?</legend>
                <div>
                  {RATING_OPTIONS.map((option) => (
                    <button
                      aria-pressed={ratings[row.response_id] === option.value}
                      className={`oral-rating-button ${ratings[row.response_id] === option.value ? "is-selected" : ""}`.trim()}
                      key={option.value}
                      onClick={() => void rateResponse(row.response_id, option.value)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            </article>
          ))}
        </div>

        <footer className="oral-review-actions">
          <Link className="primary-action" to={`/modules/${first.subject_slug}`}>Back to practice sets</Link>
          <Link className="secondary-action" to="/dashboard#modules">Back to modules</Link>
        </footer>
      </section>
    </AppFrame>
  );
}
