import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useBlocker, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import {
  getCandidateSummary,
  getPracticeQuestions,
  getSubjects,
  submitAttempt,
} from "../lib/appApi";
import { friendlyErrorMessage, isExpectedAbortError, logAppError } from "../lib/errors";
import {
  clearActivePractice,
  clearPracticeDraft,
  clearPracticeBatch,
  consumePracticeBatch,
  markActivePractice,
  preparePracticeQuestions,
  readActivePractice,
  readPracticeDraft,
  storePracticeDraft,
} from "../lib/practiceSession";
import { getModuleDisplayName } from "../lib/moduleDisplay";

const EXAM_DURATION_MINUTES = 30;
const OPTION_KEYS = ["A", "B", "C", "D"];

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

function PracticeExitConfirmModal({ busy, onCancel, onConfirm }) {
  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={onCancel}>
      <section
        aria-labelledby="practice-exit-confirm-title"
        aria-modal="true"
        className="auth-modal-card practice-exit-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <p className="eyebrow">Active practice</p>
        <h2 id="practice-exit-confirm-title">Exit this practice?</h2>
        <p>Your answers will be cleared. Opening this practice set again will start it from the beginning.</p>
        <div className="auth-modal-actions">
          <button className="primary-action" onClick={onCancel} type="button">Continue practice</button>
          <button className="ghost-button practice-confirm-exit" disabled={busy} onClick={onConfirm} type="button">
            {busy ? "Submitting..." : "Exit practice"}
          </button>
        </div>
      </section>
    </div>
  );
}

function PracticeRestartNotice({ onLeave, onResume }) {
  return (
    <section className="practice-restart-card" aria-labelledby="practice-restart-title">
      <p className="eyebrow">Practice paused</p>
      <h1 id="practice-restart-title">Continue your practice?</h1>
      <p>Your answers and remaining time were saved on this device.</p>
      <div className="practice-restart-actions">
        <button className="primary-action" onClick={onResume} type="button">Resume practice</button>
        <button className="ghost-button" onClick={onLeave} type="button">Back to modules</button>
      </div>
    </section>
  );
}

export default function Practice() {
  const location = useLocation();
  const navigate = useNavigate();
  const { subjectSlug } = useParams();
  const [searchParams] = useSearchParams();
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
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [deadlineAt, setDeadlineAt] = useState(null);
  const [restartPending, setRestartPending] = useState(() => Boolean(readPracticeDraft(subjectSlug) || readActivePractice(subjectSlug)));
  const allowExitRef = useRef(false);
  const submissionTokenRef = useRef(crypto.randomUUID());

  useLayoutEffect(() => {
    window.scrollTo({ left: 0, top: 0, behavior: "instant" });
  }, [subjectSlug]);

  const currentQuestion = questions[currentIndex];
  const currentOptionOrder = Array.isArray(currentQuestion?.option_order)
    ? currentQuestion.option_order
    : OPTION_KEYS;
  const isCurrentFlagged = Boolean(currentQuestion && flagged.includes(currentQuestion.id));
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
    error.includes("Unlock this module") ||
    error.includes("Batch 2 requires full access") ||
    emptyMessage.includes("Unlock full access") ||
    emptyMessage.includes("Unlock this module");
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    questions.length > 0
    && !allowExitRef.current
    && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`
  ));

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
      setExitConfirmOpen(false);
      setDeadlineAt(null);
      allowExitRef.current = false;
      submissionTokenRef.current = crypto.randomUUID();

      try {
        const [nextSummary, nextSubjects] = await Promise.all([
          getCandidateSummary(),
          getSubjects(),
        ]);

        if (!active) return;

        const nextSubject = nextSubjects.find((item) => item.slug === subjectSlug) ?? null;
        setSubject(nextSubject);

        if (!nextSubject) {
          return;
        }

        if (restartPending) {
          setLoading(false);
          return;
        }

        const savedDraft = readPracticeDraft(nextSubject.slug);
        const savedBatchNumber = Number(savedDraft?.questions?.[0]?.batch_number ?? 0) || null;
        if (
          savedDraft &&
          (!requestedBatchNumber || savedBatchNumber === requestedBatchNumber)
        ) {
          setQuestions(savedDraft.questions);
          setAnswers(savedDraft.answers && typeof savedDraft.answers === "object" ? savedDraft.answers : {});
          setTimeSpent(savedDraft.time_spent && typeof savedDraft.time_spent === "object" ? savedDraft.time_spent : {});
          setFlagged(Array.isArray(savedDraft.flagged) ? savedDraft.flagged : []);
          setCurrentIndex(Math.min(Math.max(Number(savedDraft.current_index) || 0, 0), savedDraft.questions.length - 1));
          setDeadlineAt(Number(savedDraft.deadline_at));
          if (savedDraft.submission_token) submissionTokenRef.current = savedDraft.submission_token;
          markActivePractice(nextSubject.slug, { batch_number: savedBatchNumber });
          return;
        }

        const launchedBatch = consumePracticeBatch(nextSubject.slug);
        const launchedBatchNumber = Number(launchedBatch?.[0]?.batch_number ?? 0) || null;

        if (
          launchedBatch?.length > 0 &&
          (!requestedBatchNumber || launchedBatchNumber === requestedBatchNumber)
        ) {
          const preparedQuestions = preparePracticeQuestions(launchedBatch, launchedBatchNumber);
          setQuestions(preparedQuestions);
          markActivePractice(nextSubject.slug, { batch_number: launchedBatchNumber });
          setDeadlineAt(Date.now() + EXAM_DURATION_MINUTES * 60 * 1000);
          return;
        }

        if (!nextSummary.has_paid_access && !nextSummary.free_module_subject_slug) {
          setEmptyMessage("Start your free practice from the dashboard to continue.");
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

        const activeBatchNumber = requestedBatchNumber ?? nextQuestions[0]?.batch_number;
        setQuestions(preparePracticeQuestions(nextQuestions, activeBatchNumber));
        markActivePractice(nextSubject.slug, { batch_number: activeBatchNumber });
        setDeadlineAt(Date.now() + EXAM_DURATION_MINUTES * 60 * 1000);
      } catch (loadError) {
        if (!active || isExpectedAbortError(loadError)) return;
        logAppError(`Practice load:${subjectSlug}`, loadError);
        setQuestions([]);
        setError(
          friendlyErrorMessage(loadError, "We could not prepare this practice set right now. Please try again."),
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
  }, [requestedBatchNumber, restartPending, subjectSlug]);

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
          option_order: Array.isArray(question.option_order) ? question.option_order : OPTION_KEYS,
          batch_number: question.batch_number ?? batchMeta.batchNumber,
        }));

      const nextResult = await submitAttempt({
        mode: "timed_mock",
        subjectId: subject.id,
        answers: submittedAnswers,
        batchNumber: batchMeta.batchNumber,
        submissionToken: submissionTokenRef.current,
      });

      clearPracticeBatch(subject.slug);
      clearActivePractice(subject.slug);
      clearPracticeDraft(subject.slug);
      allowExitRef.current = true;
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
        friendlyErrorMessage(submitError, "We could not submit this practice set. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  }, [answers, batchMeta.batchNumber, batchMeta.passMarkPercent, navigate, questions, subject, submitting, timeSpent]);

  useEffect(() => {
    if (!subject?.slug || questions.length === 0 || !deadlineAt || allowExitRef.current) return;
    storePracticeDraft(subject.slug, {
      questions,
      answers,
      time_spent: timeSpent,
      flagged,
      current_index: currentIndex,
      deadline_at: deadlineAt,
      submission_token: submissionTokenRef.current,
    });
  }, [answers, currentIndex, deadlineAt, flagged, questions, subject?.slug, timeSpent]);

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

  const hasActiveSession = questions.length > 0;

  useEffect(() => {
    if (!hasActiveSession) return undefined;

    const handleBeforeUnload = (event) => {
      if (allowExitRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasActiveSession]);

  useEffect(() => {
    const handlePageShow = (event) => {
      if (!event.persisted || questions.length === 0) return;
      allowExitRef.current = true;
      window.location.reload();
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [questions.length]);

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

  function requestExit() {
    if (!hasActiveSession || submitting) return;
    setQuestionMapOpen(false);
    setSubmitConfirmOpen(false);
    setExitConfirmOpen(true);
  }

  function confirmExit() {
    if (submitting) return;
    allowExitRef.current = true;
    if (subject?.slug) {
      clearPracticeBatch(subject.slug);
      clearActivePractice(subject.slug);
      clearPracticeDraft(subject.slug);
    }
    setExitConfirmOpen(false);
    if (blocker.state === "blocked") {
      blocker.proceed();
      return;
    }
    navigate("/dashboard#modules", { replace: true });
  }

  function cancelExit() {
    if (blocker.state === "blocked") blocker.reset();
    setExitConfirmOpen(false);
  }

  function resumePractice() {
    setRestartPending(false);
  }

  function leaveRestartNotice() {
    clearPracticeBatch(subjectSlug);
    clearActivePractice(subjectSlug);
    clearPracticeDraft(subjectSlug);
    allowExitRef.current = true;
    navigate("/dashboard#modules", { replace: true });
  }

  if (!loading && !subject) {
    return <Navigate to="/dashboard" replace />;
  }

  if (loading) {
    return <LoadingState fullPage />;
  }

  return (
    <AppFrame showBottomNav={false} showFooter={false} showHeader={false}>
      <section className="practice-page practice-page-focused">
        <span className="practice-sr-only">{`Time left ${formatTime(remainingSeconds)}`}</span>
        {error && <p className="action-error practice-action-error" role="alert">{error}</p>}

        {restartPending ? (
          <PracticeRestartNotice onLeave={leaveRestartNotice} onResume={resumePractice} />
        ) : questions.length === 0 ? (
          <section className="empty-panel">
            <h2>{emptyMessage || "Questions for this module are not available yet."}</h2>
            <p>
              {emptyMessage.includes("Confirm your free practice start")
                ? "Return to the dashboard and confirm your free practice before entering this module."
                : emptyMessage.includes("Choose a module")
                  ? "Return to the dashboard and choose a module to continue."
                  : "Return to the dashboard and begin again from the module list."}
            </p>
            <div className="hero-actions">
              <Link className="secondary-action" to="/dashboard#modules">
                Back to dashboard
              </Link>
              {requiresAccess && (
                <Link className="primary-action" to={`/access?module=${encodeURIComponent(subjectSlug)}`}>
                  Unlock module
                </Link>
              )}
            </div>
          </section>
        ) : (
          <>
            <header className="practice-exam-header">
              <button className="practice-exit-button" disabled={submitting} onClick={requestExit} type="button">Exit</button>
              <h1 title={getModuleDisplayName(subject?.name)}>{getModuleDisplayName(subject?.name)}</h1>
              <div className={`practice-header-timer ${remainingSeconds <= 300 ? "is-warning" : ""}`}>
                <span>Time left</span>
                <strong>{formatTime(remainingSeconds)}</strong>
              </div>
            </header>
            <section className="practice-desktop-layout">
              <div className="practice-session-shell">
                <header className="practice-exam-strip">
                  <div className="practice-exam-strip-top">
                    <div className="practice-exam-progress-copy">
                      <p>{`Question ${currentIndex + 1} of ${questions.length}`}</p>
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
                      {currentOptionOrder.map((canonicalOption, optionIndex) => {
                        const displayOption = OPTION_KEYS[optionIndex];
                        const selected = answers[currentQuestion.id] === canonicalOption;

                        return (
                          <button
                            key={canonicalOption}
                            aria-pressed={selected}
                            className={`option-card practice-option-card ${selected ? "selected" : ""}`}
                            onClick={() => selectAnswer(canonicalOption)}
                            type="button"
                          >
                            <span className="practice-option-badge">
                              <span className="practice-option-radio" aria-hidden="true" />
                              <strong>{displayOption}</strong>
                            </span>
                            <span>{currentQuestion[`option_${canonicalOption.toLowerCase()}`]}</span>
                          </button>
                        );
                      })}
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
                  </article>

                  <div className="practice-utility-row practice-utility-row-single">
                    <button className="ghost-button practice-utility-button" onClick={() => setQuestionMapOpen(true)} type="button">
                      Question Map
                    </button>
                    <button
                      className={`practice-flag-button ${isCurrentFlagged ? "is-active" : ""}`}
                      aria-label={isCurrentFlagged ? "Remove review flag" : "Mark for review"}
                      onClick={toggleFlag}
                      title={isCurrentFlagged ? "Flagged for review" : "Mark for review"}
                      type="button"
                    >
                      <span className="practice-flag-icon" aria-hidden="true" />
                      <span className="practice-flag-label">{isCurrentFlagged ? "Flagged" : "Flag"}</span>
                    </button>
                  </div>
                </section>
              </div>

              <aside className="practice-desktop-sidebar">
                <section className="practice-desktop-panel practice-desktop-panel-session">
                  <div className="practice-desktop-session-top">
                    <span className="practice-desktop-label">Progress</span>
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
                    className={`practice-flag-button practice-flag-button-desktop ${isCurrentFlagged ? "is-active" : ""}`}
                    aria-label={isCurrentFlagged ? "Remove review flag" : "Mark for review"}
                    onClick={toggleFlag}
                    title={isCurrentFlagged ? "Flagged for review" : "Mark for review"}
                    type="button"
                  >
                    <span className="practice-flag-icon" aria-hidden="true" />
                    <span>{isCurrentFlagged ? "Flagged" : "Mark for review"}</span>
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

            {(exitConfirmOpen || blocker.state === "blocked") && (
              <PracticeExitConfirmModal
                busy={submitting}
                onCancel={cancelExit}
                onConfirm={confirmExit}
              />
            )}
          </>
        )}
      </section>
    </AppFrame>
  );
}
