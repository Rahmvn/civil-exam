import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import {
  getCandidateSummary,
  getPracticeQuestions,
  getSubjects,
  submitAttempt,
} from "../lib/appApi";
import {
  FREE_QUESTION_LIMIT,
  getAnsweredQuestionCount,
  getFreeQuestionsRemaining,
  hasReachedFreeLimit,
} from "../lib/accessModel";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { useAuth } from "../lib/useAuth";

const QUESTION_LIMIT = 30;
const EXAM_DURATION_MINUTES = 30;

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function UpgradePrompt({ open, onClose }) {
  if (!open) return null;

  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="upgrade-modal-title"
        aria-modal="true"
        className="auth-modal-card"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="upgrade-modal-title">Unlock full practice</h2>
        <p>
          You have completed your free practice questions. Activate full access to continue
          practising all available modules in the active pack.
        </p>
        <div className="auth-modal-actions">
          <Link className="primary-action" to="/access">
            Unlock full access
          </Link>
          <button className="ghost-button" onClick={onClose} type="button">
            Not now
          </button>
        </div>
      </section>
    </div>
  );
}

export default function Practice() {
  const { profileComplete } = useAuth();
  const navigate = useNavigate();
  const { subjectSlug } = useParams();
  const [summary, setSummary] = useState(null);
  const [subjects, setSubjects] = useState([]);
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
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);

  const currentQuestion = questions[currentIndex];
  const answeredCount = Object.keys(answers).length;
  const freeQuestionsRemaining = getFreeQuestionsRemaining(summary);
  const answeredQuestionCount = getAnsweredQuestionCount(summary);
  const freeLimitReached = hasReachedFreeLimit(summary);

  useEffect(() => {
    async function bootstrap() {
      try {
        const [nextSummary, nextSubjects] = await Promise.all([
          getCandidateSummary(),
          getSubjects(),
        ]);
        const nextSubject = nextSubjects.find((item) => item.slug === subjectSlug) ?? null;

        setSummary(nextSummary);
        setSubjects(nextSubjects);
        setSubject(nextSubject);
      } catch (loadError) {
        logAppError("Practice bootstrap", loadError);
        setError(
          friendlyErrorMessage(loadError, "We could not prepare this module. Please try again."),
        );
      } finally {
        setLoading(false);
      }
    }

    bootstrap();
  }, [subjectSlug]);

  useEffect(() => {
    if (!subject) return undefined;

    async function run() {
      if (freeLimitReached) {
        setQuestions([]);
        setEmptyMessage("");
        setShowUpgradePrompt(true);
        return;
      }

      if (!subject.id) {
        setQuestions([]);
        setAnswers({});
        setTimeSpent({});
        setFlagged([]);
        setCurrentIndex(0);
        setRemainingSeconds(EXAM_DURATION_MINUTES * 60);
        setEmptyMessage("Questions for this batch are not available yet.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      setQuestions([]);
      setAnswers({});
      setTimeSpent({});
      setFlagged([]);
      setCurrentIndex(0);
      setRemainingSeconds(EXAM_DURATION_MINUTES * 60);
      setEmptyMessage("");

      try {
        const nextQuestions = await getPracticeQuestions({
          subjectId: subject.id,
          limit: QUESTION_LIMIT,
        });
        setQuestions(nextQuestions);

        if (nextQuestions.length === 0) {
          setEmptyMessage("Questions for this batch are not available yet.");
        }
      } catch (loadError) {
        logAppError(`Practice questions:${subject.slug}`, loadError);
        const message = friendlyErrorMessage(
          loadError,
          "We could not load questions for this module. Please try again.",
        );

        if (message === "Free trial limit reached") {
          setShowUpgradePrompt(true);
        } else {
          setError(
            message,
          );
        }
      } finally {
        setLoading(false);
      }
    }

    void run();
  }, [freeLimitReached, subject, summary?.has_paid_access]);

  const submitCurrentSession = useCallback(async () => {
    if (submitting || !subject || questions.length === 0) return;

    setSubmitting(true);
    setError("");

    try {
      const submittedAnswers = Object.entries(answers).map(([questionId, selectedOption]) => ({
        question_id: questionId,
        selected_option: selectedOption,
        time_spent_seconds: timeSpent[questionId] ?? 0,
      }));

      const nextResult = await submitAttempt({
        mode: "timed_mock",
        subjectId: subject.id,
        answers: submittedAnswers,
      });

      setSummary(await getCandidateSummary());
      navigate(`/review?attempt=${nextResult.attempt_id}`, {
        state: {
          result: nextResult,
          subject,
          questionBank: questions,
        },
      });
    } catch (submitError) {
      logAppError(`Practice submit:${subject?.slug ?? "unknown"}`, submitError);
      setError(
        friendlyErrorMessage(submitError, "We could not submit this session. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  }, [answers, navigate, questions, subject, submitting, timeSpent]);

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
    return <main className="state-shell">Loading your module...</main>;
  }

  return (
    <AppFrame>
      <section className="practice-shell">
        <header className="practice-topbar">
          <div>
            <p className="eyebrow">Practice module</p>
            <h1 className="page-title">{subject?.name}</h1>
          </div>
          <div className="practice-topbar-actions">
            <Link className="text-link" to="/dashboard">
              Dashboard
            </Link>
            <div
              className={`timer ${remainingSeconds <= 300 ? "timer-warning" : ""}`}
              aria-label="Time remaining"
            >
              <span className="timer-label">Time left</span>
              <span className="timer-value">{formatTime(remainingSeconds)}</span>
            </div>
          </div>
        </header>

        <section className="filter-panel">
          <div>
            <strong>{questions.length > 0 ? `${questions.length} questions` : "Questions will appear here"}</strong>
            <p className="filter-status">
              {summary?.has_paid_access
                ? "Full pack active"
                : `${freeQuestionsRemaining} of ${FREE_QUESTION_LIMIT} free questions remaining`}
            </p>
            {questions.length > 0 && questions.length < QUESTION_LIMIT && (
              <p className="filter-status">Showing available practice questions for this module.</p>
            )}
            {!summary?.has_paid_access && <p className="filter-status">{answeredQuestionCount} answered so far</p>}
          </div>
          <div className="subject-switcher">
            {subjects.map((item) => (
              <Link
                key={item.id}
                className={`nav-chip ${item.slug === subjectSlug ? "active" : ""}`}
                to={`/practice/${item.slug}`}
              >
                {item.name}
              </Link>
            ))}
          </div>
        </section>

        {error && <section className="state-card inline-state">{error}</section>}

        {questions.length === 0 ? (
          <section className="empty-panel">
            <p className="eyebrow">Module practice</p>
            <h2>
              {freeLimitReached
                ? "Your free practice limit has been reached."
                : emptyMessage || "Questions for this batch are not available yet."}
            </h2>
            <p>
              {freeLimitReached
                ? "Unlock full access to continue practising all available modules in the active pack."
                : !subject?.id
                ? "This module is available in your dashboard, but questions have not been uploaded yet."
                : summary?.has_paid_access
                ? "Return later or try another module when content is uploaded."
                : "Free preview questions will appear here when they are available for this module."}
            </p>
            <div className="hero-actions">
              <Link className="secondary-action" to="/dashboard">
                Back to dashboard
              </Link>
              {(!summary?.has_paid_access || freeLimitReached) && (
                <Link className="primary-action" to="/access">
                  View access
                </Link>
              )}
            </div>
          </section>
        ) : (
          <section className="exam-layout">
            <aside className="exam-sidebar">
              <p className="eyebrow">Session progress</p>
              <h2>{answeredCount} answered</h2>
              <div className="progress-track">
                <span style={{ width: `${progressPercent}%` }} />
              </div>
              <p>{questions.length - answeredCount} questions still open.</p>

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

              <button
                className="submit-button"
                disabled={submitting || answeredCount === 0}
                onClick={() => void submitCurrentSession()}
                type="button"
              >
                {submitting ? "Submitting..." : "Submit session"}
              </button>
            </aside>

            <section className="question-panel">
              <div className="question-meta">
                <span>{subject?.name}</span>
                <span>
                  Question {currentIndex + 1} of {questions.length}
                </span>
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

              <footer className="question-actions">
                <button className="ghost-button" onClick={toggleFlag} type="button">
                  {flagged.includes(currentQuestion.id) ? "Remove flag" : "Flag for review"}
                </button>
                <div>
                  <button
                    className="ghost-button"
                    disabled={currentIndex === 0}
                    onClick={() => setCurrentIndex((value) => value - 1)}
                    type="button"
                  >
                    Previous
                  </button>
                  <button
                    disabled={currentIndex === questions.length - 1}
                    onClick={() => setCurrentIndex((value) => value + 1)}
                    type="button"
                  >
                    Next
                  </button>
                </div>
              </footer>
            </section>
          </section>
        )}
      </section>
      <UpgradePrompt onClose={() => setShowUpgradePrompt(false)} open={showUpgradePrompt} />
    </AppFrame>
  );
}
