import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
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
} from "../lib/accessModel";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
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

  const currentQuestion = questions[currentIndex];
  const answeredCount = Object.keys(answers).length;
  const freeQuestionsRemaining = getFreeQuestionsRemaining(summary);
  const answeredQuestionCount = getAnsweredQuestionCount(summary);
  const batchMeta = questions[0]
    ? {
        batchNumber: Number(questions[0].batch_number ?? 1),
        passMarkPercent: Number(questions[0].pass_mark_percent ?? 70),
      }
    : {
        batchNumber: Number(location.state?.batchNumber ?? 1),
        passMarkPercent: Number(location.state?.passMarkPercent ?? 70),
      };
  const requiresAccess =
    error.includes("Unlock full access") ||
    error.includes("Batch 2 requires full access") ||
    emptyMessage.includes("Unlock full access");

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

    void bootstrap();
  }, [subjectSlug]);

  useEffect(() => {
    if (!subject) return undefined;

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
        setQuestions(storedBatch);
        setLoading(false);
        return;
      }

      try {
        const nextQuestions = await getPracticeQuestions({
          subjectId: subject.id,
          limit: undefined,
        });

        if (nextQuestions.length === 0) {
          setQuestions([]);
          setEmptyMessage("Questions for this module are not available yet.");
          return;
        }

        setQuestions(nextQuestions);
      } catch (loadError) {
        logAppError(`Practice questions:${subject.slug}`, loadError);
        setQuestions([]);
        setEmptyMessage(
          friendlyErrorMessage(
            loadError,
            "We could not load this batch right now. Start again from the dashboard.",
          ),
        );
      } finally {
        setLoading(false);
      }
    }

    void loadBatch();
  }, [location.key, subject]);

  const submitCurrentSession = useCallback(async () => {
    if (submitting || !subject || questions.length === 0) return;

    setSubmitting(true);
    setError("");

    try {
      const submittedAnswers = questions.map((question) => ({
        question_id: question.id,
        selected_option: answers[question.id] ?? "",
        time_spent_seconds: timeSpent[question.id] ?? 0,
        display_order: question.display_order ?? 0,
        batch_number: question.batch_number ?? batchMeta.batchNumber,
      })).filter((item) => item.selected_option);

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
            <p className="filter-status">Batch {batchMeta.batchNumber}</p>
            <p className="filter-status">Pass mark: {batchMeta.passMarkPercent}%</p>
            {!summary?.has_paid_access && (
              <>
                <p className="filter-status">{`${freeQuestionsRemaining} of ${FREE_QUESTION_LIMIT} free questions remaining`}</p>
                <p className="filter-status">{answeredQuestionCount} answered so far</p>
              </>
            )}
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
            <h2>{emptyMessage || "Questions for this module are not available yet."}</h2>
            <p>
              {emptyMessage.includes("Start your free batch")
                ? "Return to the dashboard and confirm your free batch before entering this module."
                : emptyMessage.includes("Choose a module")
                  ? "Return to the dashboard and choose a module to continue."
                  : "If this batch has not been started yet, return to the dashboard and begin from the module list."}
            </p>
            <div className="hero-actions">
              <Link className="secondary-action" to="/dashboard">
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
          <section className="exam-layout">
            <aside className="exam-sidebar">
              <p className="eyebrow">Batch progress</p>
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
                {submitting ? "Submitting..." : "Submit batch"}
              </button>
            </aside>

            <section className="question-panel">
              <div className="question-meta">
                <span>{subject?.name}</span>
                <span>{`Batch ${batchMeta.batchNumber}`}</span>
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
    </AppFrame>
  );
}
