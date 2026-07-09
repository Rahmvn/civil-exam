import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import {
  getCandidateSummary,
  getPracticeQuestions,
  getSubjects,
  submitAttempt,
} from "../lib/appApi";
import { friendlyErrorMessage, isExpectedAbortError, logAppError } from "../lib/errors";
import { clearPracticeBatch, readPracticeBatch } from "../lib/practiceSession";
import { useAuth } from "../lib/useAuth";

const EXAM_DURATION_MINUTES = 30;

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export default function Practice() {
  const { profileComplete } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { subjectSlug } = useParams();
  const [summary, setSummary] = useState(null);
  const [subject, setSubject] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [timeSpent, setTimeSpent] = useState({});
  const [flagged, setFlagged] = useState([]);
  const [remainingSeconds, setRemainingSeconds] = useState(EXAM_DURATION_MINUTES * 60);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [emptyMessage, setEmptyMessage] = useState("");
  const bootstrapReadyRef = useRef(false);

  const currentQuestion = questions[currentIndex];
  const answeredCount = Object.keys(answers).length;
  const batchMeta = questions[0]
    ? {
        batchNumber: Number(questions[0].batch_number ?? 1),
        batchSize: Number(questions[0].batch_size ?? questions.length),
        passMarkPercent: Number(questions[0].pass_mark_percent ?? 70),
        isFreeAttempt: Boolean(questions[0].is_free_attempt),
      }
    : {
        batchNumber: Number(location.state?.batchNumber ?? 1),
        batchSize: Number(location.state?.batchSize ?? 0),
        passMarkPercent: Number(location.state?.passMarkPercent ?? 70),
        isFreeAttempt: Boolean(location.state?.isFreeAttempt ?? false),
      };
  const requiresAccess =
    error.includes("Unlock full access") ||
    error.includes("Batch 2 requires full access") ||
    emptyMessage.includes("Unlock full access");

  useEffect(() => {
    let active = true;
    bootstrapReadyRef.current = false;

    async function bootstrap() {
      try {
        const [nextSummary, nextSubjects] = await Promise.all([
          getCandidateSummary(),
          getSubjects(),
        ]);
        const nextSubject = nextSubjects.find((item) => item.slug === subjectSlug) ?? null;

        if (!active) return;
        setSummary(nextSummary);
        setSubject(nextSubject);
      } catch (loadError) {
        if (!active || isExpectedAbortError(loadError)) return;
        logAppError("Practice bootstrap", loadError);
        setError(
          friendlyErrorMessage(loadError, "We could not prepare this module. Please try again."),
        );
      } finally {
        if (active) {
          bootstrapReadyRef.current = true;
          setLoading(false);
        }
      }
    }

    void bootstrap();

    return () => {
      active = false;
    };
  }, [subjectSlug]);

  useEffect(() => {
    if (!subject || !bootstrapReadyRef.current) return undefined;
    let active = true;

    async function loadBatch() {
      setLoading(true);
      setError("");
      setEmptyMessage("");
      setAnswers({});
      setTimeSpent({});
      setFlagged([]);
      setCurrentIndex(0);
      setRemainingSeconds(EXAM_DURATION_MINUTES * 60);

      const storedBatch = readPracticeBatch(subject.slug);

      if (storedBatch?.length > 0) {
        if (!active) return;
        setQuestions(storedBatch);
        setLoading(false);
        return;
      }

      if (summary && !summary.has_paid_access && !summary.free_module_subject_slug) {
        if (!active) return;
        setQuestions([]);
        setEmptyMessage("Start your free batch from the dashboard to continue.");
        setLoading(false);
        return;
      }

      try {
        const nextQuestions = await getPracticeQuestions({
          subjectId: subject.id,
          limit: undefined,
        });

        if (nextQuestions.length === 0) {
          if (!active) return;
          setQuestions([]);
          setEmptyMessage("Questions for this module are not available yet.");
          return;
        }

        if (!active) return;
        setQuestions(nextQuestions);
      } catch (loadError) {
        if (!active || isExpectedAbortError(loadError)) return;
        logAppError(`Practice questions:${subject.slug}`, loadError);
        setQuestions([]);
        setEmptyMessage(
          friendlyErrorMessage(
            loadError,
            "We could not load this batch right now. Start again from the dashboard.",
          ),
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadBatch();

    return () => {
      active = false;
    };
  }, [location.key, subject, summary]);

  const submitCurrentSession = useCallback(async () => {
    if (submitting || !subject || questions.length === 0) return;

    setSubmitting(true);
    setError("");

    try {
      const submittedAnswers = questions
        .map((question) => ({
          question_id: question.id,
          selected_option: answers[question.id] ?? "",
          time_spent_seconds: timeSpent[question.id] ?? 0,
          display_order: question.display_order ?? 0,
          batch_number: question.batch_number ?? batchMeta.batchNumber,
        }))
        .filter((item) => item.selected_option);

      const nextResult = await submitAttempt({
        mode: "timed_mock",
        subjectId: subject.id,
        answers: submittedAnswers,
      });

      clearPracticeBatch(subject.slug);
      setSummary(await getCandidateSummary());
      navigate(`/review?attempt=${nextResult.attempt_id}`, {
        state: {
          result: nextResult,
          subject: {
            ...subject,
            slug: subject.slug,
          },
          passMarkPercent: batchMeta.passMarkPercent,
        },
      });
    } catch (submitError) {
      logAppError(`Practice submit:${subject?.slug ?? "unknown"}`, submitError);
      setError(
        friendlyErrorMessage(submitError, "We could not submit this batch. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  }, [answers, batchMeta.batchNumber, batchMeta.passMarkPercent, navigate, questions, subject, submitting, timeSpent]);

  useEffect(() => {
    if (questions.length === 0 || submitting) return undefined;

    const timerId = window.setInterval(() => {
      setRemainingSeconds((previous) => {
        if (previous <= 1) {
          window.clearInterval(timerId);
          void submitCurrentSession();
          return 0;
        }
        return previous - 1;
      });

      setTimeSpent((previous) => {
        if (!currentQuestion) return previous;
        return {
          ...previous,
          [currentQuestion.id]: (previous[currentQuestion.id] ?? 0) + 1,
        };
      });
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [currentQuestion, questions.length, submitting, submitCurrentSession]);

  const progressPercent = useMemo(() => {
    if (questions.length === 0) return 0;
    return (answeredCount / questions.length) * 100;
  }, [answeredCount, questions.length]);

  function selectAnswer(option) {
    if (!currentQuestion) return;

    setAnswers((previous) => ({
      ...previous,
      [currentQuestion.id]: option,
    }));
  }

  function toggleFlag() {
    if (!currentQuestion) return;

    setFlagged((previous) =>
      previous.includes(currentQuestion.id)
        ? previous.filter((id) => id !== currentQuestion.id)
        : [...previous, currentQuestion.id],
    );
  }

  if (!loading && !subject) {
    return <Navigate to="/dashboard" replace />;
  }

  if (!profileComplete) {
    return (
      <Navigate
        to="/dashboard"
        replace
        state={{ onboardingTarget: `/practice/${subjectSlug}` }}
      />
    );
  }

  if (loading && questions.length === 0) {
    return <main className="state-shell">Loading your batch...</main>;
  }

  return (
    <AppFrame>
      <section className="practice-page">
        <header className="practice-page-header">
          <div>
            <p className="eyebrow">Practice</p>
            <h1>{subject?.name ?? "Module practice"}</h1>
            <p>
              {`Batch ${batchMeta.batchNumber} · Question ${questions.length > 0 ? currentIndex + 1 : 0} of ${questions.length}`}
            </p>
          </div>
          <div className="practice-page-actions">
            <Link className="secondary-action" to="/dashboard#modules">
              Back to modules
            </Link>
            <div className={`practice-timer ${remainingSeconds <= 300 ? "is-warning" : ""}`}>
              <span>Time left</span>
              <strong>{formatTime(remainingSeconds)}</strong>
            </div>
          </div>
        </header>

        <section className="practice-session-banner">
          <div>
            <span>Batch</span>
            <strong>{batchMeta.batchNumber}</strong>
          </div>
          <div>
            <span>Questions</span>
            <strong>{questions.length}</strong>
          </div>
          <div>
            <span>Pass mark</span>
            <strong>{batchMeta.passMarkPercent}%</strong>
          </div>
          <div>
            <span>Access</span>
            <strong>{summary?.has_paid_access ? "Full access" : batchMeta.isFreeAttempt ? "Free batch" : "Practice"}</strong>
          </div>
        </section>

        {questions.length > 0 && batchMeta.batchSize > 0 && questions.length < batchMeta.batchSize && (
          <section className="practice-note">
            Showing available practice questions for this module.
          </section>
        )}

        {error && <section className="state-card inline-state">{error}</section>}

        {questions.length === 0 ? (
          <section className="empty-panel">
            <h2>{emptyMessage || "Questions for this module are not available yet."}</h2>
            <p>
              {emptyMessage.includes("Confirm your free batch start")
                ? "Return to the dashboard and confirm your free batch before entering this module."
                : emptyMessage.includes("Choose a module")
                  ? "Return to the dashboard and choose a module to continue."
                  : "If this batch has not been started yet, return to the dashboard and begin from the module list."}
            </p>
            <div className="hero-actions">
              <Link className="secondary-action" to="/dashboard#modules">
                Back to dashboard
              </Link>
              {requiresAccess && !summary?.has_paid_access && (
                <Link className="primary-action" to="/access">
                  Unlock full access
                </Link>
              )}
            </div>
          </section>
        ) : (
          <section className="practice-session-layout">
            <aside className="practice-session-sidebar">
              <div className="practice-sidebar-block">
                <p className="eyebrow">Progress</p>
                <h2>{answeredCount} answered</h2>
                <p>{questions.length - answeredCount} still open.</p>
                <div className="progress-track">
                  <span style={{ width: `${progressPercent}%` }} />
                </div>
              </div>

              <div className="practice-sidebar-block">
                <p className="eyebrow">Question map</p>
                <div className="question-map">
                  {questions.map((question, index) => {
                    const isActive = index === currentIndex;
                    const isAnswered = Boolean(answers[question.id]);
                    const isFlagged = flagged.includes(question.id);

                    return (
                      <button
                        key={question.id}
                        className={`question-dot ${isActive ? "active" : ""} ${isAnswered ? "answered" : ""} ${isFlagged ? "flagged" : ""}`}
                        onClick={() => setCurrentIndex(index)}
                        type="button"
                      >
                        {index + 1}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                className="submit-button"
                disabled={submitting || answeredCount === 0}
                onClick={() => void submitCurrentSession()}
                type="button"
              >
                {submitting ? "Submitting..." : "Submit batch"}
              </button>
            </aside>

            <section className="practice-question-card">
              <div className="practice-question-meta">
                <span>{subject?.name}</span>
                <span>{`Batch ${batchMeta.batchNumber}`}</span>
                <span>{`Question ${currentIndex + 1} of ${questions.length}`}</span>
              </div>

              <h2>{currentQuestion?.question_text}</h2>

              <div className="options-list">
                {["A", "B", "C", "D"].map((option) => {
                  const selected = answers[currentQuestion.id] === option;

                  return (
                    <button
                      key={option}
                      className={`option-card ${selected ? "selected" : ""}`}
                      onClick={() => selectAnswer(option)}
                      type="button"
                    >
                      <span className="radio">{option}</span>
                      <span>{currentQuestion[`option_${option.toLowerCase()}`]}</span>
                    </button>
                  );
                })}
              </div>

              <footer className="practice-question-actions">
                <button className="ghost-button" onClick={toggleFlag} type="button">
                  {flagged.includes(currentQuestion.id) ? "Remove flag" : "Flag for review"}
                </button>
                <div className="practice-question-nav">
                  <button
                    className="ghost-button"
                    disabled={currentIndex === 0}
                    onClick={() => setCurrentIndex((value) => value - 1)}
                    type="button"
                  >
                    Previous
                  </button>
                  {currentIndex === questions.length - 1 ? (
                    <button
                      disabled={submitting || answeredCount === 0}
                      onClick={() => void submitCurrentSession()}
                      type="button"
                    >
                      {submitting ? "Submitting..." : "Submit"}
                    </button>
                  ) : (
                    <button
                      onClick={() => setCurrentIndex((value) => value + 1)}
                      type="button"
                    >
                      Next
                    </button>
                  )}
                </div>
              </footer>
            </section>
          </section>
        )}
      </section>
    </AppFrame>
  );
}
