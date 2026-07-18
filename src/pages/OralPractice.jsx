import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { Link, Navigate, useBlocker, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import {
  advanceOralAttempt,
  getActiveOralAttempt,
  getModuleAccessCatalog,
  getModuleBatchAccess,
  getOralAttemptState,
  getSubjects,
  saveOralResponseDraft,
  startOrResumeOralAttempt,
} from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { getModuleDisplayName, isModulePurchaseUnavailable } from "../lib/moduleDisplay";
import {
  clearOralResponseDraft,
  formatOralTime,
  getOralRemainingSeconds,
  getServerOffset,
  ORAL_DURATION_OPTIONS,
  readOralResponseDraft,
  storeOralResponseDraft,
} from "../lib/oralPractice";

const AUTOSAVE_DELAY_MS = 1000;

function OralExitConfirmModal({ busy, onCancel, onConfirm }) {
  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={busy ? undefined : onCancel}>
      <section
        aria-labelledby="oral-exit-confirm-title"
        aria-modal="true"
        className="auth-modal-card practice-exit-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <p className="eyebrow">Active oral practice</p>
        <h2 id="oral-exit-confirm-title">Leave oral practice?</h2>
        <p>
          Your latest answer will be saved, but the current question timer will continue.
          When time expires, the answer is locked. You must finish this attempt before starting another oral practice set.
        </p>
        <div className="auth-modal-actions">
          <button className="primary-action" disabled={busy} onClick={onCancel} type="button">Continue practice</button>
          <button className="ghost-button practice-confirm-exit" disabled={busy} onClick={onConfirm} type="button">
            {busy ? "Saving..." : "Save and leave"}
          </button>
        </div>
      </section>
    </div>
  );
}

function OralStart({ accessRow, canPurchase, duration, error, onDurationChange, onStart, starting, subject }) {
  const questionCount = Number(accessRow?.published_question_count ?? 0);
  const hasAccess = Boolean(accessRow?.can_start);
  const purchaseUnavailable = isModulePurchaseUnavailable({
    hasModuleAccess: Boolean(accessRow?.is_paid),
    canPurchase,
    rows: accessRow ? [accessRow] : [],
  });

  return (
    <AppFrame showBottomNav={false}>
      <section className="oral-start-page">
        <Link className="oral-back-link" to={`/modules/${subject.slug}`}>Back to practice sets</Link>
        <article className="oral-start-card">
          <p className="oral-start-module-name">{getModuleDisplayName(subject.name)}</p>
          <p className="oral-start-intro">
            Answer each prompt in your own words. Once you continue, that answer is locked.
          </p>

          <div className="oral-start-facts" aria-label="Practice details">
            <span><strong>{questionCount}</strong> questions in this set</span>
            <span><strong>Timed response</strong> per question</span>
            <span><strong>Guided review</strong> with model answers</span>
          </div>

          {hasAccess ? (
            <fieldset className="oral-duration-picker">
              <legend>Time for each question</legend>
              {ORAL_DURATION_OPTIONS.map((option) => (
                <label className={duration === option.seconds ? "is-selected" : ""} key={option.seconds}>
                  <input
                    checked={duration === option.seconds}
                    name="oral-duration"
                    onChange={() => onDurationChange(option.seconds)}
                    type="radio"
                    value={option.seconds}
                  />
                  <span><strong>{option.label}</strong><small>{option.note}</small></span>
                </label>
              ))}
            </fieldset>
          ) : (
            <div className="oral-access-note">
              <strong>This practice set is locked.</strong>
              <p>{accessRow?.message || "Unlock this module to begin oral practice."}</p>
            </div>
          )}

          {error && <p className="action-error" role="alert">{error}</p>}

          <div className="oral-start-actions">
            {hasAccess ? (
              <button className="primary-action" disabled={starting} onClick={onStart} type="button">
                {starting ? "Preparing practice..." : "Begin oral practice"}
              </button>
            ) : purchaseUnavailable ? (
              <button className="primary-action" disabled type="button">
                Not available yet
              </button>
            ) : (
              <Link className="primary-action" to={`/access?module=${encodeURIComponent(subject.slug)}`}>
                Unlock module
              </Link>
            )}
          </div>
          <p className="oral-no-pause-note">Choose your time once. The timer cannot be paused after you begin.</p>
        </article>
      </section>
    </AppFrame>
  );
}

export default function OralPractice() {
  const { subjectSlug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const setNumber = Math.max(1, Number(searchParams.get("batch")) || 1);
  const [subject, setSubject] = useState(null);
  const [canPurchase, setCanPurchase] = useState(false);
  const [accessRow, setAccessRow] = useState(null);
  const [session, setSession] = useState(null);
  const [duration, setDuration] = useState(180);
  const [answer, setAnswer] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [saveState, setSaveState] = useState("Saved");
  const [error, setError] = useState("");
  const serverOffsetRef = useRef(0);
  const answerRef = useRef("");
  const sessionRef = useRef(null);
  const autosaveTimerRef = useRef(null);
  const autosavePromiseRef = useRef(null);
  const advanceRetryAtRef = useRef(0);
  const advancingRef = useRef(false);
  const allowExitRef = useRef(false);
  const questionHeadingRef = useRef(null);
  const hasActiveSession = session?.status === "active";
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    hasActiveSession
    && !allowExitRef.current
    && `${currentLocation.pathname}${currentLocation.search}` !== `${nextLocation.pathname}${nextLocation.search}`
  ));

  const applySession = useCallback((nextSession, { preserveAnswer = false } = {}) => {
    if (!nextSession) return;
    const previousAttemptId = sessionRef.current?.attempt_id;
    const previousQuestionId = sessionRef.current?.current_question?.id;
    sessionRef.current = nextSession;
    setSession(nextSession);
    serverOffsetRef.current = getServerOffset(nextSession.server_now);

    if (nextSession.status === "completed") {
      clearOralResponseDraft(previousAttemptId ?? nextSession.attempt_id, previousQuestionId);
      allowExitRef.current = true;
      navigate(`/oral-review?attempt=${nextSession.attempt_id}`, { replace: true });
      return;
    }

    const nextQuestionId = nextSession.current_question?.id;
    if (!preserveAnswer || nextQuestionId !== previousQuestionId) {
      if (previousQuestionId && previousQuestionId !== nextQuestionId) {
        clearOralResponseDraft(previousAttemptId, previousQuestionId);
      }
      const localDraft = readOralResponseDraft(nextSession.attempt_id, nextQuestionId);
      const nextAnswer = localDraft ?? nextSession.current_question?.response_text ?? "";
      answerRef.current = nextAnswer;
      setAnswer(nextAnswer);
      if (localDraft !== null) setSaveState("Not saved");
    }
    setRemainingSeconds(getOralRemainingSeconds(
      nextSession.current_question?.deadline_at,
      serverOffsetRef.current,
    ));
  }, [navigate]);

  useEffect(() => {
    let active = true;

    async function loadOralPractice() {
      try {
        const [subjects, catalog, rows, activeAttempt] = await Promise.all([
          getSubjects(),
          getModuleAccessCatalog(),
          getModuleBatchAccess(subjectSlug),
          getActiveOralAttempt(subjectSlug, setNumber),
        ]);
        if (!active) return;

        const nextSubject = subjects.find((item) => item.slug === subjectSlug) ?? null;
        setSubject(nextSubject);
        const accessEntry = catalog.find((item) => item?.subject_slug === subjectSlug);
        setCanPurchase(accessEntry ? Boolean(accessEntry.can_purchase) : true);
        setAccessRow(rows.find((row) => Number(row.batch_number ?? 1) === setNumber) ?? null);
        if (activeAttempt) applySession(activeAttempt);
      } catch (loadError) {
        if (!active) return;
        logAppError("Oral practice load", loadError);
        setError(friendlyErrorMessage(loadError, "We could not prepare this oral practice right now."));
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadOralPractice();
    return () => {
      active = false;
      window.clearTimeout(autosaveTimerRef.current);
    };
  }, [applySession, setNumber, subjectSlug]);

  useEffect(() => {
    if (!session?.current_question?.id) return;
    const focusTimer = window.setTimeout(() => questionHeadingRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [session?.current_question?.id]);

  const advanceAfterTimeout = useEffectEvent(() => {
    void advance("timeout");
  });

  useEffect(() => {
    if (session?.status !== "active" || !session.current_question?.deadline_at) return undefined;

    const timer = window.setInterval(() => {
      const nextRemaining = getOralRemainingSeconds(
        sessionRef.current?.current_question?.deadline_at,
        serverOffsetRef.current,
      );
      setRemainingSeconds(nextRemaining);

      if (nextRemaining === 0 && !advancingRef.current && Date.now() >= advanceRetryAtRef.current) {
        advanceRetryAtRef.current = Date.now() + 3000;
        advanceAfterTimeout();
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [session?.current_question?.deadline_at, session?.status]);

  useEffect(() => {
    function reconcileSession() {
      if (document.visibilityState === "hidden") return;
      const currentSession = sessionRef.current;
      if (!currentSession?.attempt_id || advancingRef.current) return;

      void getOralAttemptState(currentSession.attempt_id)
        .then((nextSession) => {
          setError("");
          applySession(nextSession);
        })
        .catch((stateError) => {
          logAppError("Oral practice reconcile", stateError);
          setError("We could not reconnect to the session yet. Your saved answer remains on this device.");
        });
    }

    window.addEventListener("online", reconcileSession);
    window.addEventListener("pageshow", reconcileSession);
    document.addEventListener("visibilitychange", reconcileSession);
    return () => {
      window.removeEventListener("online", reconcileSession);
      window.removeEventListener("pageshow", reconcileSession);
      document.removeEventListener("visibilitychange", reconcileSession);
    };
  }, [applySession]);

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

  function changeAnswer(event) {
    const nextAnswer = event.target.value;
    answerRef.current = nextAnswer;
    setAnswer(nextAnswer);
    setSaveState("Saving...");
    window.clearTimeout(autosaveTimerRef.current);

    const activeSession = sessionRef.current;
    const questionId = activeSession?.current_question?.id;
    if (!activeSession?.attempt_id || !questionId) return;
    storeOralResponseDraft(activeSession.attempt_id, questionId, nextAnswer);

    autosaveTimerRef.current = window.setTimeout(async () => {
      const savePromise = saveOralResponseDraft({
        attemptId: activeSession.attempt_id,
        questionId,
        responseText: nextAnswer,
      });
      autosavePromiseRef.current = savePromise;

      try {
        const nextSession = await savePromise;
        if (sessionRef.current?.current_question?.id !== questionId) return;
        if (nextSession?.current_question?.id !== questionId || nextSession?.status === "completed") {
          applySession(nextSession);
          return;
        }
        clearOralResponseDraft(activeSession.attempt_id, questionId);
        setSaveState("Saved");
      } catch (saveError) {
        logAppError("Oral answer autosave", saveError);
        setSaveState("Not saved");
      } finally {
        if (autosavePromiseRef.current === savePromise) autosavePromiseRef.current = null;
      }
    }, AUTOSAVE_DELAY_MS);
  }

  function cancelExit() {
    if (leaving) return;
    if (blocker.state === "blocked") blocker.reset();
    setExitConfirmOpen(false);
  }

  async function confirmExit() {
    const activeSession = sessionRef.current;
    const questionId = activeSession?.current_question?.id;
    if (!activeSession?.attempt_id || !questionId || leaving) return;

    window.clearTimeout(autosaveTimerRef.current);
    storeOralResponseDraft(activeSession.attempt_id, questionId, answerRef.current);
    setLeaving(true);
    setSaveState("Saving...");
    setError("");

    try {
      if (autosavePromiseRef.current) {
        try {
          await autosavePromiseRef.current;
        } catch {
          // The final save below retries with the newest answer.
        }
      }

      const nextSession = await saveOralResponseDraft({
        attemptId: activeSession.attempt_id,
        questionId,
        responseText: answerRef.current,
      });

      clearOralResponseDraft(activeSession.attempt_id, questionId);
      setSaveState("Saved");
      setExitConfirmOpen(false);

      if (nextSession.status === "completed") {
        if (blocker.state === "blocked") blocker.reset();
        applySession(nextSession);
        return;
      }

      allowExitRef.current = true;
      if (blocker.state === "blocked") {
        blocker.proceed();
      } else {
        navigate("/dashboard#modules", { replace: true });
      }
    } catch (saveError) {
      logAppError("Oral practice exit save", saveError);
      setSaveState("Not saved");
      setError(friendlyErrorMessage(
        saveError,
        "We could not save your latest answer, so the practice is still open. Please try again.",
      ));
    } finally {
      setLeaving(false);
    }
  }

  async function beginPractice() {
    setStarting(true);
    setError("");
    try {
      const nextSession = await startOrResumeOralAttempt({
        subjectSlug,
        setNumber,
        secondsPerQuestion: duration,
      });
      applySession(nextSession);
    } catch (startError) {
      logAppError("Oral practice start", startError);
      setError(friendlyErrorMessage(startError, "We could not start this oral practice right now."));
    } finally {
      setStarting(false);
    }
  }

  async function advance(reason = "manual") {
    const activeSession = sessionRef.current;
    const questionId = activeSession?.current_question?.id;
    if (!activeSession?.attempt_id || !questionId || advancingRef.current) return;

    window.clearTimeout(autosaveTimerRef.current);
    advancingRef.current = true;
    setAdvancing(true);
    setError("");
    setSaveState(reason === "timeout" ? "Time ended" : "Locking answer...");

    try {
      const nextSession = await advanceOralAttempt({
        attemptId: activeSession.attempt_id,
        questionId,
        responseText: answerRef.current,
        reason,
      });
      clearOralResponseDraft(activeSession.attempt_id, questionId);
      setSaveState("Saved");
      applySession(nextSession);
    } catch (advanceError) {
      logAppError("Oral practice advance", advanceError);
      advanceRetryAtRef.current = Date.now() + 3000;
      setError(friendlyErrorMessage(
        advanceError,
        reason === "timeout"
          ? "Time has ended. Reconnect to continue to the next question."
          : "We could not lock this answer yet. Please try again.",
      ));
      setSaveState("Not saved");
    } finally {
      advancingRef.current = false;
      setAdvancing(false);
    }
  }

  if (loading) return <LoadingState fullPage />;
  if (!subject) return <Navigate to="/dashboard#modules" replace />;
  if (subject.practice_type !== "oral") {
    return <Navigate to={`/practice/${subject.slug}?batch=${setNumber}`} replace />;
  }

  if (!session) {
    return (
      <OralStart
        accessRow={accessRow}
        canPurchase={canPurchase}
        duration={duration}
        error={error}
        onDurationChange={setDuration}
        onStart={() => void beginPractice()}
        starting={starting}
        subject={subject}
      />
    );
  }

  const question = session.current_question;
  const isFinalQuestion = session.current_position === session.total_questions;
  const answerIsBlank = answer.trim().length === 0;

  return (
    <AppFrame showBottomNav={false} showFooter={false} showHeader={false}>
      <main className="oral-session-page">
        <div className="oral-session-topbar">
          <header className="oral-session-header">
            <div>
              <p>{getModuleDisplayName(session.subject_name)}</p>
              <span>{`Practice set ${session.set_number} - Question ${session.current_position} of ${session.total_questions}`}</span>
            </div>
            <div className="oral-session-controls">
              <div
                aria-label={`${formatOralTime(remainingSeconds)} remaining`}
                className={`oral-session-timer ${remainingSeconds <= 30 ? "is-warning" : ""}`}
                role="timer"
              >
                <span>Time left</span>
                <strong>{formatOralTime(remainingSeconds)}</strong>
              </div>
              <button
                className="oral-session-exit-button"
                disabled={advancing || leaving}
                onClick={() => setExitConfirmOpen(true)}
                type="button"
              >
                Exit
              </button>
            </div>
          </header>

          <section className="oral-session-progress" aria-label="Question progress">
            <div className="oral-session-progress-track" aria-hidden="true">
              <span style={{ width: `${(session.current_position / session.total_questions) * 100}%` }} />
            </div>
          </section>
        </div>

        <div className="oral-session-layout">
          <article className="oral-question-panel">
            <p className="eyebrow">Speak through your reasoning, then write your answer</p>
            <h1 ref={questionHeadingRef} tabIndex="-1">{question?.question_text}</h1>

            <label className="oral-answer-field">
              <span>Your answer</span>
              <textarea
                autoFocus
                disabled={advancing || remainingSeconds === 0}
                maxLength={20000}
                onChange={changeAnswer}
                placeholder="Type the answer you would give in the oral exam..."
                rows="10"
                value={answer}
              />
            </label>

            <footer className="oral-answer-actions">
              <div aria-live="polite" className={`oral-save-state ${saveState === "Not saved" ? "is-error" : ""}`}>
                {saveState}
              </div>
              <div className="oral-answer-submit">
                <p>Once you continue, this answer is locked.</p>
                <button
                  className="primary-action"
                  disabled={advancing || remainingSeconds === 0}
                  onClick={() => void advance("manual")}
                  type="button"
                >
                  {advancing
                    ? "Moving on..."
                    : isFinalQuestion
                      ? answerIsBlank ? "Finish without an answer" : "Lock answer and finish"
                      : answerIsBlank ? "Continue without an answer" : "Lock answer and continue"}
                </button>
              </div>
            </footer>
          </article>
        </div>

        {error && <p className="action-error oral-session-error" role="alert">{error}</p>}
      </main>
      {(exitConfirmOpen || blocker.state === "blocked") && (
        <OralExitConfirmModal
          busy={leaving}
          onCancel={cancelExit}
          onConfirm={() => void confirmExit()}
        />
      )}
    </AppFrame>
  );
}
