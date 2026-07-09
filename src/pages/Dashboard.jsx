import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import ProfileOnboardingModal from "../components/ProfileOnboardingModal";
import {
  getCandidateSummary,
  getModuleBatchAccess,
  getModuleProgress,
  getRecentAttempts,
  getReviewQueue,
  getSubjects,
  startPracticeBatch,
} from "../lib/appApi";
import { friendlyErrorMessage, isExpectedAbortError, logAppError } from "../lib/errors";
import { storePracticeBatch } from "../lib/practiceSession";
import { formatServiceLevelLabel } from "../lib/serviceLevel";
import { useAuth } from "../lib/useAuth";

function formatDate(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
}

function formatAttemptPercent(attempt) {
  const total = Number(attempt?.total_questions ?? 0);
  const score = Number(attempt?.score ?? 0);

  if (!total) return null;
  return Math.round((score / total) * 100);
}

function getFirstName(fullName) {
  if (!fullName) return "";
  return fullName.trim().split(/\s+/)[0] ?? "";
}

function getSubjectSlugFromPracticeTarget(target) {
  if (typeof target !== "string") return null;

  const match = target.match(/^\/practice\/([^/?#]+)/i);
  return match?.[1] ?? null;
}

function FreeBatchConfirmationModal({ subject, loading, onCancel, onConfirm }) {
  if (!subject) return null;

  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={loading ? undefined : onCancel}>
      <section
        aria-labelledby="free-batch-modal-title"
        aria-modal="true"
        className="auth-modal-card dashboard-confirmation-modal"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="eyebrow">Free access</p>
        <h2 id="free-batch-modal-title">Start your free batch?</h2>
        <p>
          This will use your free module. You&apos;ll be able to practise Batch 1 of{" "}
          {subject.name} for free. To continue to other modules or later batches, unlock
          full access.
        </p>
        <div className="auth-modal-actions">
          <button className="primary-action" disabled={loading} onClick={onConfirm} type="button">
            {loading ? "Starting..." : "Start free batch"}
          </button>
          <button className="ghost-button" disabled={loading} onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}

export default function Dashboard() {
  const { profile, profileComplete } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const mountedRef = useRef(true);
  const [summary, setSummary] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [progress, setProgress] = useState([]);
  const [moduleBatchAccess, setModuleBatchAccess] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subjectsNotice, setSubjectsNotice] = useState("");
  const [attemptsNotice, setAttemptsNotice] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [onboardingTarget, setOnboardingTarget] = useState(null);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);
  const [startConfirmSubject, setStartConfirmSubject] = useState(null);
  const [startingBatch, setStartingBatch] = useState(false);
  const [ctaError, setCtaError] = useState("");

  const loadDashboardData = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading && mountedRef.current) {
      setLoading(true);
    }

    const requests = [
      { key: "summary", promise: getCandidateSummary() },
      { key: "subjects", promise: getSubjects() },
      { key: "progress", promise: getModuleProgress() },
      { key: "batchAccess", promise: getModuleBatchAccess() },
      { key: "attempts", promise: getRecentAttempts() },
      { key: "review", promise: getReviewQueue(6) },
    ];

    const results = await Promise.allSettled(requests.map((item) => item.promise));

    if (!mountedRef.current) return;

    requests.forEach((request, index) => {
      const result = results[index];

      if (result.status === "fulfilled") {
        if (request.key === "summary") setSummary(result.value);
        if (request.key === "subjects") {
          setSubjects(Array.isArray(result.value) ? result.value : []);
          setSubjectsNotice("");
        }
        if (request.key === "progress") {
          setProgress(Array.isArray(result.value) ? result.value : []);
        }
        if (request.key === "batchAccess") {
          setModuleBatchAccess(Array.isArray(result.value) ? result.value : []);
        }
        if (request.key === "attempts") {
          setAttempts(Array.isArray(result.value) ? result.value : []);
          setAttemptsNotice("");
        }
        if (request.key === "review") {
          setReviewQueue(Array.isArray(result.value) ? result.value : []);
          setReviewNotice("");
        }
        return;
      }

      const error = result.reason;
      if (isExpectedAbortError(error)) return;
      logAppError(`Dashboard ${request.key}`, error);

      if (request.key === "summary") setSummary(null);
      if (request.key === "subjects") {
        setSubjects([]);
        setSubjectsNotice("Modules are not available right now.");
      }
      if (request.key === "progress") setProgress([]);
      if (request.key === "batchAccess") setModuleBatchAccess([]);
      if (request.key === "attempts") {
        setAttempts([]);
        setAttemptsNotice("Recent attempts could not be loaded right now.");
      }
      if (request.key === "review") {
        setReviewQueue([]);
        setReviewNotice("Review items are not available right now.");
      }
    });

    if (mountedRef.current) {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadDashboardData();

    return () => {
      mountedRef.current = false;
    };
  }, [loadDashboardData]);

  const firstName = getFirstName(profile?.full_name);
  const serviceLevelLabel = formatServiceLevelLabel(profile?.service_level);
  const progressBySubject = useMemo(
    () => Object.fromEntries(progress.map((item) => [item.subject_id, item])),
    [progress],
  );
  const batchAccessBySubject = useMemo(() => {
    const grouped = {};

    moduleBatchAccess.forEach((row) => {
      if (!row?.subject_slug) return;
      grouped[row.subject_slug] ??= [];
      grouped[row.subject_slug].push(row);
    });

    return grouped;
  }, [moduleBatchAccess]);
  const subjectNameBySlug = useMemo(
    () => Object.fromEntries(subjects.map((item) => [item.slug, item.name])),
    [subjects],
  );

  const freeModuleSlug = summary?.free_module_subject_slug ?? null;
  const hasSelectedFreeModule = Boolean(freeModuleSlug);
  const isPaidUser = Boolean(summary?.has_paid_access);
  const hasAttempts = attempts.length > 0;
  const availableSubjects = subjects.filter((subject) =>
    (batchAccessBySubject[subject.slug] ?? []).some((row) => Number(row.published_question_count ?? 0) > 0),
  );
  const hasAvailableContent = moduleBatchAccess.some((row) => Number(row.published_question_count ?? 0) > 0);
  const noModuleContent =
    profileComplete &&
    subjects.length > 0 &&
    moduleBatchAccess.length > 0 &&
    availableSubjects.length === 0;
  const weakAreaItems = reviewQueue.slice(0, 4);
  const pendingTarget = location.state?.onboardingTarget ?? null;
  const activeOnboardingSubjectSlug = getSubjectSlugFromPracticeTarget(onboardingTarget ?? pendingTarget);
  const onboardingModalOpen = showOnboardingModal || Boolean(pendingTarget);
  const onboardingNextPath =
    onboardingTarget === "/access" || pendingTarget === "/access"
      ? "/access"
      : "/dashboard#modules";

  useEffect(() => {
    if (!pendingTarget) return;
    navigate("/dashboard", { replace: true, state: null });
  }, [navigate, pendingTarget]);

  useEffect(() => {
    if (loading || location.hash !== "#modules") return;

    const target = document.getElementById("modules");
    if (!target) return;

    const frameId = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [loading, location.hash]);

  function openOnboardingForPractice(subjectSlug) {
    setOnboardingTarget(`/practice/${subjectSlug}`);
    setShowOnboardingModal(true);
  }

  function openOnboardingForAccess() {
    setOnboardingTarget("/access");
    setShowOnboardingModal(true);
  }

  function getRecommendedBatchRow(subject) {
    const rows = batchAccessBySubject[subject.slug] ?? [];

    if (rows.length === 0) return null;

    return (
      rows.find((row) => row.is_recommended) ??
      rows.find((row) => row.can_start) ??
      rows.find((row) => Number(row.published_question_count ?? 0) > 0) ??
      rows[0]
    );
  }

  function getModuleCta(subject) {
    const subjectProgress = progressBySubject[subject.id] ?? null;
    const batchRow = getRecommendedBatchRow(subject);
    const batchNumber = Number(batchRow?.batch_number ?? subjectProgress?.current_batch_number ?? 1);
    const hasContent = Number(batchRow?.published_question_count ?? 0) > 0;
    const hasCompletedAttempts = Number(batchRow?.attempt_count ?? subjectProgress?.completed_attempts ?? 0) > 0;
    const lastBatchPassed = batchRow?.passed ?? subjectProgress?.last_batch_passed === true;

    if (!profileComplete) {
      return {
        label: "Set your grade level",
        action: () => openOnboardingForPractice(subject.slug),
      };
    }

    if (!hasContent) {
      return { label: "Coming soon", disabled: true };
    }

    if (!batchRow) {
      return { label: "Coming soon", disabled: true };
    }

    if (batchRow.state === "unavailable_not_published") {
      return { label: "Coming soon", disabled: true };
    }

    if (batchRow.state === "locked_requires_payment") {
      return { label: "Unlock full access", to: "/access" };
    }

    if (!batchRow.can_start) {
      return { label: "Unlock full access", to: "/access" };
    }

    if (!isPaidUser && !hasSelectedFreeModule && batchRow.reason_code === "free_batch_available") {
      return {
        label: `Start Batch ${batchNumber}`,
        action: () => {
          setCtaError("");
          setStartConfirmSubject(subject);
        },
      };
    }

    if (batchRow.state === "completed_failed") {
      return { label: `Retry Batch ${batchNumber}`, to: `/practice/${subject.slug}?batch=${batchNumber}` };
    }

    if (hasCompletedAttempts && lastBatchPassed === false) {
      return { label: `Retry Batch ${batchNumber}`, to: `/practice/${subject.slug}?batch=${batchNumber}` };
    }

    if (hasCompletedAttempts) {
      return { label: `Continue Batch ${batchNumber}`, to: `/practice/${subject.slug}?batch=${batchNumber}` };
    }

    return { label: `Start Batch ${batchNumber}`, to: `/practice/${subject.slug}?batch=${batchNumber}` };
  }

  function getModuleStatus(subject) {
    const batchRow = getRecommendedBatchRow(subject);
    const currentBatchNumber = Number(batchRow?.batch_number ?? 1);

    if (!profileComplete) {
      return "Complete details to start";
    }

    if (!batchRow || Number(batchRow.published_question_count ?? 0) === 0) {
      return "Coming soon";
    }

    if (batchRow.state === "locked_requires_payment") return "Unlock required";
    if (batchRow.state === "completed_passed") return `Passed Batch ${currentBatchNumber}`;
    if (batchRow.state === "completed_failed") return `Retry Batch ${currentBatchNumber}`;
    return `Batch ${currentBatchNumber} available`;
  }

  const dashboardIntro = !profileComplete
    ? "Add your grade level before starting Batch 1."
    : noModuleContent
      ? `Your ${serviceLevelLabel ? `${serviceLevelLabel} ` : ""}practice modules are being prepared. Once questions are uploaded, you’ll be able to practise, review weak areas, and track your progress here.`
      : hasAttempts
        ? "Continue your current batch or review your latest result."
        : "Choose a module to begin practice.";

  const accessTitle = isPaidUser
    ? "Full access active"
    : hasSelectedFreeModule
      ? "Free module selected"
      : "Free access available";
  const accessText = isPaidUser
    ? summary?.access_expires_at
      ? `Active until ${formatDate(summary.access_expires_at)}.`
      : "You can continue with all modules and all available batches."
    : hasSelectedFreeModule
      ? `${subjectNameBySlug[freeModuleSlug] ?? "Your selected module"} is unlocked for Batch 1. One retry is available if the first attempt fails.`
      : "You can start Batch 1 of one selected module for free.";
  const accessHelper = isPaidUser
    ? "Full access includes all modules, later batches, review history, and progress tracking."
    : "Unlock full access to continue to other modules, later batches, and unlimited retries.";

  async function confirmStartFreeBatch() {
    if (!startConfirmSubject) return;

    setStartingBatch(true);
    setCtaError("");

    try {
      const batch = await startPracticeBatch(startConfirmSubject.slug, 1);
      storePracticeBatch(startConfirmSubject.slug, batch);
      setStartConfirmSubject(null);
      navigate(`/practice/${startConfirmSubject.slug}?batch=1`, {
        state: { batchStarted: true },
      });
    } catch (error) {
      logAppError(`Dashboard start batch:${startConfirmSubject.slug}`, error);
      setCtaError(friendlyErrorMessage(error, "We could not start this batch right now."));
      setStartConfirmSubject(null);
    } finally {
      setStartingBatch(false);
    }
  }

  function closeOnboardingModal() {
    setShowOnboardingModal(false);
    setOnboardingTarget(null);
  }

  if (loading) {
    return <main className="state-shell">Loading your dashboard...</main>;
  }

  return (
    <AppFrame>
      <section className="dashboard-page">
        <section className="dashboard-welcome-card">
          <div className="dashboard-welcome-copy">
            <p className="dashboard-welcome-kicker">{firstName ? `Welcome, ${firstName}` : "Welcome"}</p>
            <h1>Dashboard</h1>
            <p>{dashboardIntro}</p>
            {ctaError && <p className="notice error">{ctaError}</p>}
          </div>

          <aside className="dashboard-access-card">
            <p className="eyebrow">Access</p>
            <h2>{accessTitle}</h2>
            <p>{accessText}</p>
            <span>{accessHelper}</span>
            {!isPaidUser && hasAvailableContent && (
              profileComplete ? (
                <Link className="secondary-action" to="/access">
                  Unlock full access
                </Link>
              ) : (
                <button className="secondary-action" onClick={openOnboardingForAccess} type="button">
                  Unlock full access
                </button>
              )
            )}
          </aside>
        </section>

        {noModuleContent ? (
          <>
            <section className="dashboard-module-section" id="modules">
              <div className="dashboard-section-heading">
                <div>
                  <p className="eyebrow">Modules</p>
                  <h2>Module readiness</h2>
                </div>
                {subjectsNotice && <p className="section-note">{subjectsNotice}</p>}
              </div>

              <div className="dashboard-module-list">
                {(subjects.length > 0 ? subjects : [
                  { id: "pfm-preview", name: "Public Financial Management (Financial Regulations)" },
                  { id: "psr-preview", name: "Public Service Rules" },
                  { id: "ca-preview", name: "Current Affairs / General Knowledge" },
                ]).map((subject) => (
                  <article className="dashboard-module-row" key={subject.id}>
                    <div className="dashboard-module-main">
                      <h3>{subject.name}</h3>
                      <p>Questions for this module are not available yet.</p>
                    </div>
                    <div className="dashboard-module-side">
                      <span className="dashboard-module-status">Coming soon</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="dashboard-note-strip">
              <p className="eyebrow">After practice</p>
              <p>Scores, weak areas, and recent attempts will appear here after your first batch.</p>
            </section>
          </>
        ) : (
          <>
            <section className="dashboard-module-section" id="modules">
              <div className="dashboard-section-heading">
                <div>
                  <p className="eyebrow">Modules</p>
                  <h2>Choose where to continue</h2>
                </div>
                {subjectsNotice && <p className="section-note">{subjectsNotice}</p>}
              </div>

              {subjects.length === 0 ? (
                <section className="empty-panel">
                  <h2>No modules are available yet.</h2>
                  <p>Modules will appear here once they are ready.</p>
                </section>
              ) : (
                <div className="dashboard-module-list">
                  {subjects.map((subject) => {
                    const subjectProgress = progressBySubject[subject.id] ?? null;
                    const batchRow = getRecommendedBatchRow(subject);
                    const moduleRows = batchAccessBySubject[subject.slug] ?? [];
                    const hasContent = moduleRows.some((row) => Number(row.published_question_count ?? 0) > 0);
                    const cta = getModuleCta(subject);
                    const status = getModuleStatus(subject);
                    const currentBatchNumber = Number(batchRow?.batch_number ?? subjectProgress?.current_batch_number ?? 1);
                    const completedAttempts = Number(batchRow?.attempt_count ?? subjectProgress?.completed_attempts ?? 0);
                    const lastScorePercent = Number(subjectProgress?.last_score_percent ?? 0);
                    const weakQuestionCount = Number(subjectProgress?.weak_question_count ?? 0);
                    const lastBatchPassed = batchRow?.passed ?? subjectProgress?.last_batch_passed;
                    const publishedBatchList = moduleRows
                      .filter((row) => Number(row.published_question_count ?? 0) > 0)
                      .map((row) => row.batch_number)
                      .sort((left, right) => left - right);

                    return (
                      <article className="dashboard-module-row" key={subject.id}>
                        <div className="dashboard-module-main">
                          <div className="dashboard-module-heading">
                            <h3>{subject.name}</h3>
                            <span className="dashboard-module-status">{status}</span>
                          </div>
                          <p>
                            {!profileComplete
                              ? "Complete your details to begin Batch 1."
                              : hasContent
                                ? subject.description ?? "Practice questions are available for this module."
                                : "Questions for this module are not available yet."}
                          </p>
                          {publishedBatchList.length > 0 && (
                            <p className="section-note">
                              {`Published batches: ${publishedBatchList.map((value) => `Batch ${value}`).join(", ")}`}
                            </p>
                          )}
                          <dl className="dashboard-module-meta">
                            <div>
                              <dt>Current batch</dt>
                              <dd>{`Batch ${currentBatchNumber}`}</dd>
                            </div>
                            <div>
                              <dt>Latest result</dt>
                              <dd>{completedAttempts > 0 ? `${lastScorePercent}%` : "No attempt yet"}</dd>
                            </div>
                            <div>
                              <dt>Status</dt>
                              <dd>
                                {completedAttempts > 0
                                  ? lastBatchPassed
                                    ? "Passed"
                                    : "Retry required"
                                  : "Ready"}
                              </dd>
                            </div>
                            <div>
                              <dt>Weak areas</dt>
                              <dd>{completedAttempts > 0 ? weakQuestionCount : "None yet"}</dd>
                            </div>
                          </dl>
                        </div>

                        <div className="dashboard-module-side">
                          {cta.disabled ? (
                            <button disabled type="button">
                              {cta.label}
                            </button>
                          ) : cta.action ? (
                            <button className="primary-action" onClick={cta.action} type="button">
                              {cta.label}
                            </button>
                          ) : (
                            <Link className="primary-action" to={cta.to}>
                              {cta.label}
                            </Link>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {hasAttempts ? (
              <section className="dashboard-history-grid">
                <article className="dashboard-history-card">
                  <div className="dashboard-section-heading">
                    <div>
                      <p className="eyebrow">Recent attempts</p>
                      <h2>Your latest batches</h2>
                    </div>
                  </div>
                  {attemptsNotice ? (
                    <p className="support-copy">{attemptsNotice}</p>
                  ) : (
                    <div className="dashboard-attempt-list">
                      {attempts.map((attempt) => {
                        const percent = formatAttemptPercent(attempt);

                        return (
                          <article key={attempt.id}>
                            <div>
                              <strong>{attempt.subjects?.name ?? "Module batch"}</strong>
                              <span>
                                {`Batch ${attempt.batch_number ?? 1} · ${attempt.passed ? "Passed" : "Retry required"}${percent !== null ? ` · ${percent}%` : ""}`}
                              </span>
                            </div>
                            <time dateTime={attempt.started_at}>{formatDate(attempt.started_at)}</time>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </article>

                <article className="dashboard-history-card">
                  <div className="dashboard-section-heading">
                    <div>
                      <p className="eyebrow">Review</p>
                      <h2>Questions worth revisiting</h2>
                    </div>
                  </div>
                  {reviewNotice ? (
                    <p className="support-copy">{reviewNotice}</p>
                  ) : weakAreaItems.length === 0 ? (
                    <p className="support-copy">Your review queue will appear after real mistakes are recorded.</p>
                  ) : (
                    <div className="dashboard-attempt-list">
                      {weakAreaItems.map((item) => (
                        <article key={item.question_id}>
                          <div>
                            <strong>{item.subject_name}</strong>
                            <span>{item.question_text}</span>
                          </div>
                          <span className="dashboard-mini-tag">{item.times_missed} misses</span>
                        </article>
                      ))}
                    </div>
                  )}
                </article>
              </section>
            ) : (
              <section className="dashboard-note-strip">
                <p className="eyebrow">After practice</p>
                <p>Your recent attempts and review items will appear here after your first submitted batch.</p>
              </section>
            )}
          </>
        )}
      </section>

      {onboardingModalOpen && (
        <ProfileOnboardingModal
          key={activeOnboardingSubjectSlug ?? "dashboard-onboarding"}
          nextPath={onboardingNextPath}
          onClose={closeOnboardingModal}
          onComplete={async () => {
            await loadDashboardData({ showLoading: false });
            setShowOnboardingModal(false);
            setOnboardingTarget(null);
          }}
        />
      )}

      <FreeBatchConfirmationModal
        loading={startingBatch}
        onCancel={() => setStartConfirmSubject(null)}
        onConfirm={() => void confirmStartFreeBatch()}
        subject={startConfirmSubject}
      />
    </AppFrame>
  );
}
