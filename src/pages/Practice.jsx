import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import {
  getCandidateSummary,
  getPracticeQuestions,
  getSubjects,
  submitAttempt,
} from "../lib/appApi";
import { friendlyErrorMessage, isExpectedAbortError, logAppError } from "../lib/errors";
import {
  clearPracticeBatch,
  readPracticeSession,
  updatePracticeSession,
} from "../lib/practiceSession";
import { getModuleDisplayName } from "../lib/moduleDisplay";
import { useAuth } from "../lib/useAuth";

const EXAM_DURATION_MINUTES = 30;

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function PracticeQuestionMapModal({
  answers,
  currentIndex,
  flagged,
  onClose,
  onSelectQuestion,
  questions,
}) {
  if (!questions.length) return null;

  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="practice-question-map-title"
        aria-modal="true"
        className="auth-modal-card practice-map-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="practice-map-modal-head">
          <h2 id="practice-question-map-title">Question Map</h2>
        </div>

        <div className="practice-map-legend">
          <span><i className="is-answered" />Answered</span>
          <span><i className="is-unanswered" />Unanswered</span>
          <span><i className="is-marked" />Marked</span>
        </div>

        <div className="practice-map-grid">
          {questions.map((question, index) => {
            const isAnswered = Boolean(answers[question.id]);
            const isMarked = flagged.includes(question.id);
            const isCurrent = index === currentIndex;

            return (
              <button
                key={question.id}
                className={`question-dot ${isAnswered ? "answered" : ""} ${isMarked ? "flagged" : ""} ${isCurrent ? "active" : ""}`.trim()}
                onClick={() => onSelectQuestion(index)}
                type="button"
              >
                {index + 1}
              </button>
            );
          })}
        </div>

        <div className="auth-modal-actions practice-map-actions">
          <button className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
        </div>
      </section>
    </div>
  );
}

function PracticeSubmitConfirmModal({
  answeredCount,
  onCancel,
  onConfirm,
  questionsCount,
  submitting,
}) {
  if (!questionsCount) return null;

  const unansweredCount = Math.max(questionsCount - answeredCount, 0);

  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={submitting ? undefined : onCancel}>
      <section
        aria-labelledby="practice-submit-confirm-title"
        aria-modal="true"
        className="auth-modal-card practice-submit-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="practice-submit-illustration" aria-hidden="true">
          <span />
        </div>
        <h2 id="practice-submit-confirm-title">Submit Test?</h2>
        <p>{`You have answered ${answeredCount} out of ${questionsCount} questions.`}</p>
        {unansweredCount > 0 && (
          <p className="practice-submit-secondary-copy">
            {`${unansweredCount} question${unansweredCount === 1 ? "" : "s"} still unanswered.`}
          </p>
        )}
        <div className="auth-modal-actions practice-submit-actions">
          <button className="primary-action" disabled={submitting || answeredCount === 0} onClick={onConfirm} type="button">
            {submitting ? "Submitting..." : "Submit Test"}
          </button>
          <button className="ghost-button" disabled={submitting} onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

export default function Practice() {
  const { profileComplete } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { subjectSlug } = useParams();
  const [searchParams] = useSearchParams();
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
  const [questionMapOpen, setQuestionMapOpen] = useState(false);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [deadlineAt, setDeadlineAt] = useState(null);

  const currentQuestion = questions[currentIndex];
  const requestedBatchNumber = Number(searchParams.get("batch") ?? location.state?.batchNumber ?? 0) || null;
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

    async function loadPracticePage() {
      setLoading(true);
      setError("");
      setEmptyMessage("");
      setQuestions([]);
      setAnswers({});
      setTimeSpent({});
      setFlagged([]);
      setCurrentIndex(0);
      setRemainingSeconds(EXAM_DURATION_MINUTES * 60);
      setQuestionMapOpen(false);
      setSubmitConfirmOpen(false);
      setDeadlineAt(null);

      try {
        const [nextSummary, nextSubjects] = await Promise.all([
          getCandidateSummary(),
          getSubjects(),
        ]);

        if (!active) return;

        const nextSubject = nextSubjects.find((item) => item.slug === subjectSlug) ?? null;
        setSummary(nextSummary);
        setSubject(nextSubject);

        if (!nextSubject) {
          return;
        }

        const storedSession = readPracticeSession(nextSubject.slug);
        const storedBatch = storedSession?.questions ?? null;
        const storedBatchNumber = Number(storedBatch?.[0]?.batch_number ?? 0) || null;

        if (
          storedBatch?.length > 0 &&
          (!requestedBatchNumber || storedBatchNumber === requestedBatchNumber)
        ) {
          setQuestions(storedBatch);
          setAnswers(storedSession?.answers && typeof storedSession.answers === "object" ? storedSession.answers : {});
          setTimeSpent(storedSession?.timeSpent && typeof storedSession.timeSpent === "object" ? storedSession.timeSpent : {});
          setFlagged(Array.isArray(storedSession?.flagged) ? storedSession.flagged : []);
          setCurrentIndex(
            Number.isInteger(storedSession?.currentIndex)
              ? Math.max(0, Math.min(storedSession.currentIndex, storedBatch.length - 1))
              : 0,
          );
          setDeadlineAt(
            Number.isFinite(Number(storedSession?.deadlineAt))
              ? Number(storedSession.deadlineAt)
              : Date.now() + EXAM_DURATION_MINUTES * 60 * 1000,
          );
          return;
        }

        if (!nextSummary.has_paid_access && !nextSummary.free_module_subject_slug) {
          setEmptyMessage("Start your free batch from the dashboard to continue.");
          return;
        }

        const nextQuestions = await getPracticeQuestions({
          subjectId: nextSubject.id,
          batchNumber: requestedBatchNumber,
          limit: undefined,
        });

        if (!active) return;

        if (nextQuestions.length === 0) {
          setEmptyMessage("Questions for this module are not available yet.");
          return;
        }

        setQuestions(nextQuestions);
        setDeadlineAt(Date.now() + EXAM_DURATION_MINUTES * 60 * 1000);
      } catch (loadError) {
        if (!active || isExpectedAbortError(loadError)) return;
        logAppError(`Practice load:${subjectSlug}`, loadError);
        setQuestions([]);
        setError(
          friendlyErrorMessage(loadError, "We could not prepare this batch right now. Please try again."),
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadPracticePage();

    return () => {
      active = false;
    };
  }, [location.key, requestedBatchNumber, subjectSlug]);

  useEffect(() => {
    if (!subject?.slug || questions.length === 0 || !deadlineAt) return;

    updatePracticeSession(subject.slug, {
      questions,
      answers,
      timeSpent,
      flagged,
      currentIndex,
      deadlineAt,
    });
  }, [answers, currentIndex, deadlineAt, flagged, questions, subject?.slug, timeSpent]);

  const submitCurrentSession = useCallback(async () => {
    if (submitting || !subject || questions.length === 0) return;

    setSubmitting(true);
    setSubmitConfirmOpen(false);
    setError("");

    try {
      const submittedAnswers = questions
        .map((question) => ({
          question_id: question.id,
          selected_option: answers[question.id] ?? null,
          time_spent_seconds: timeSpent[question.id] ?? 0,
          display_order: question.display_order ?? 0,
          batch_number: question.batch_number ?? batchMeta.batchNumber,
        }));

      const nextResult = await submitAttempt({
        mode: "timed_mock",
        subjectId: subject.id,
        answers: submittedAnswers,
        batchNumber: batchMeta.batchNumber,
      });

      clearPracticeBatch(subject.slug);
      setSummary(await getCandidateSummary());
      navigate(`/result?attempt=${nextResult.attempt_id}`, {
        state: {
          result: nextResult,
          subject: {
            ...subject,
            slug: subject.slug,
          },
          batchNumber: batchMeta.batchNumber,
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
    if (questions.length === 0 || submitting || !deadlineAt) return undefined;

    const syncRemaining = () => {
      const nextRemaining = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
      setRemainingSeconds(nextRemaining);
      return nextRemaining;
    };

    const initialRemaining = syncRemaining();
    if (initialRemaining <= 0) {
      const submitTimeoutId = window.setTimeout(() => {
        void submitCurrentSession();
      }, 0);

      return () => window.clearTimeout(submitTimeoutId);
    }

    const timerId = window.setInterval(() => {
      const nextRemaining = syncRemaining();
      if (nextRemaining <= 0) {
        window.clearInterval(timerId);
        window.setTimeout(() => {
          void submitCurrentSession();
        }, 0);
        return;
      }

      setTimeSpent((previous) => {
        if (!currentQuestion) return previous;
        return {
          ...previous,
          [currentQuestion.id]: (previous[currentQuestion.id] ?? 0) + 1,
        };
      });
    }, 1000);

    return () => window.clearInterval(timerId);
  }, [currentQuestion, deadlineAt, questions.length, submitting, submitCurrentSession]);

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

  function openSubmitConfirm() {
    if (submitting || questions.length === 0 || answeredCount === 0) return;
    setSubmitConfirmOpen(true);
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

  if (loading) {
    return (
      <main className="state-shell">
        <section className="state-card page-loading-card">
          <p>Loading your batch...</p>
        </section>
      </main>
    );
  }

  return (
    <AppFrame showBottomNav={false} showFooter={false} showHeader={false}>
      <section className="practice-page practice-page-focused">
        <span className="practice-sr-only">{`Time left ${formatTime(remainingSeconds)}`}</span>
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
          <>
            <header className="practice-module-context">
              <h1 title={getModuleDisplayName(subject?.name)}>{getModuleDisplayName(subject?.name)}</h1>
            </header>
            <section className="practice-desktop-layout">
              <div className="practice-session-shell">
                <header className="practice-exam-strip">
                  <div className="practice-exam-strip-top">
                    <div className="practice-exam-progress-copy">
                      <p>{`Question ${currentIndex + 1} of ${questions.length}`}</p>
                    </div>
                    <div className={`practice-timer practice-timer-compact ${remainingSeconds <= 300 ? "is-warning" : ""}`}>
                      <strong>{formatTime(remainingSeconds)}</strong>
                    </div>
                  </div>
                  <div className="practice-progress-track" aria-hidden="true">
                    <span style={{ width: `${progressPercent}%` }} />
                  </div>
                </header>

                <section className="practice-question-stage">
                  <article className="practice-question-card practice-question-card-focused">
                    <h2>{currentQuestion?.question_text}</h2>

                    <div className="options-list practice-options-list">
                      {["A", "B", "C", "D"].map((option) => {
                        const selected = answers[currentQuestion.id] === option;

                        return (
                          <button
                            key={option}
                            className={`option-card practice-option-card ${selected ? "selected" : ""}`}
                            onClick={() => selectAnswer(option)}
                            type="button"
                          >
                            <span className="practice-option-badge">
                              <span className="practice-option-radio" aria-hidden="true" />
                              <strong>{option}</strong>
                            </span>
                            <span>{currentQuestion[`option_${option.toLowerCase()}`]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </article>

                  <div className="practice-utility-row practice-utility-row-single">
                    <button className="ghost-button practice-utility-button" onClick={() => setQuestionMapOpen(true)} type="button">
                      Question Map
                    </button>
                    <button
                      className={`practice-flag-button ${flagged.includes(currentQuestion.id) ? "is-active" : ""}`}
                      aria-label={flagged.includes(currentQuestion.id) ? "Remove review flag" : "Mark for review"}
                      onClick={toggleFlag}
                      title={flagged.includes(currentQuestion.id) ? "Flagged for review" : "Mark for review"}
                      type="button"
                    >
                      <span className="practice-flag-icon" aria-hidden="true" />
                      <span className="practice-sr-only">
                        {flagged.includes(currentQuestion.id) ? "Flagged" : "Flag"}
                      </span>
                    </button>
                  </div>

                  <footer className="practice-bottom-bar">
                    <button
                      className="ghost-button practice-nav-button"
                      disabled={currentIndex === 0}
                      onClick={() => setCurrentIndex((value) => value - 1)}
                      type="button"
                    >
                      Previous
                    </button>
                    {currentIndex === questions.length - 1 ? (
                      <button
                        className="practice-nav-button"
                        disabled={submitting || answeredCount === 0}
                        onClick={openSubmitConfirm}
                        type="button"
                      >
                        {submitting ? "Submitting..." : "Submit Test"}
                      </button>
                    ) : (
                      <button
                        className="practice-nav-button"
                        onClick={() => setCurrentIndex((value) => value + 1)}
                        type="button"
                      >
                        Next
                      </button>
                    )}
                  </footer>
                </section>
              </div>

              <aside className="practice-desktop-sidebar">
                <section className="practice-desktop-panel practice-desktop-panel-session">
                  <div className="practice-desktop-session-top">
                    <div className="practice-desktop-session-copy">
                      <span className="practice-desktop-label">Session</span>
                      <strong className={`practice-desktop-timer ${remainingSeconds <= 300 ? "is-warning" : ""}`}>
                        {formatTime(remainingSeconds)}
                      </strong>
                    </div>
                    <div className="practice-desktop-session-stats">
                      <span>{`${answeredCount}/${questions.length} answered`}</span>
                      {flagged.length > 0 && <span>{`${flagged.length} flagged`}</span>}
                    </div>
                  </div>

                  <div className="practice-desktop-panel-head">
                    <span className="practice-desktop-label">Question map</span>
                    <span className="practice-desktop-meta">{`${questions.length - answeredCount} open`}</span>
                  </div>
                  <div className="practice-map-grid practice-map-grid-desktop">
                    {questions.map((question, index) => {
                      const isAnswered = Boolean(answers[question.id]);
                      const isMarked = flagged.includes(question.id);
                      const isCurrent = index === currentIndex;

                      return (
                        <button
                          key={question.id}
                          className={`question-dot ${isAnswered ? "answered" : ""} ${isMarked ? "flagged" : ""} ${isCurrent ? "active" : ""}`.trim()}
                          onClick={() => setCurrentIndex(index)}
                          type="button"
                        >
                          {index + 1}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    className={`practice-flag-button practice-flag-button-desktop ${flagged.includes(currentQuestion.id) ? "is-active" : ""}`}
                    aria-label={flagged.includes(currentQuestion.id) ? "Remove review flag" : "Mark for review"}
                    onClick={toggleFlag}
                    title={flagged.includes(currentQuestion.id) ? "Flagged for review" : "Mark for review"}
                    type="button"
                  >
                    <span className="practice-flag-icon" aria-hidden="true" />
                    <span>{flagged.includes(currentQuestion.id) ? "Flagged" : "Mark for review"}</span>
                  </button>
                </section>
              </aside>
            </section>

            {questionMapOpen && (
              <PracticeQuestionMapModal
                answers={answers}
                currentIndex={currentIndex}
                flagged={flagged}
                onClose={() => setQuestionMapOpen(false)}
                onSelectQuestion={(index) => {
                  setCurrentIndex(index);
                  setQuestionMapOpen(false);
                }}
                questions={questions}
              />
            )}

            {submitConfirmOpen && (
              <PracticeSubmitConfirmModal
                answeredCount={answeredCount}
                onCancel={() => setSubmitConfirmOpen(false)}
                onConfirm={() => void submitCurrentSession()}
                questionsCount={questions.length}
                submitting={submitting}
              />
            )}
          </>
        )}
      </section>
    </AppFrame>
  );
}
