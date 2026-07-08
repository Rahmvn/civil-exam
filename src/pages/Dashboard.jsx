import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import ProfileOnboardingModal from "../components/ProfileOnboardingModal";
import {
  getCandidateSummary,
  getModuleAvailability,
  getModuleProgress,
  getRecentAttempts,
  getReviewQueue,
  getSubjects,
} from "../lib/appApi";
import {
  FREE_QUESTION_LIMIT,
  getFreeQuestionsRemaining,
  hasReachedFreeLimit,
} from "../lib/accessModel";
import { logAppError } from "../lib/errors";
import { useAuth } from "../lib/useAuth";

function formatExpiryDate(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString();
}

function formatScore(score, totalQuestions) {
  if (!totalQuestions) return null;
  return Math.round((score / totalQuestions) * 100);
}

function getFirstName(fullName) {
  if (!fullName) return "";
  return fullName.trim().split(/\s+/)[0] ?? "";
}

export default function Dashboard() {
  const { profile, profileComplete } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [progress, setProgress] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [availabilityBySubject, setAvailabilityBySubject] = useState({});
  const [loading, setLoading] = useState(true);
  const [subjectsNotice, setSubjectsNotice] = useState("");
  const [, setProgressNotice] = useState("");
  const [attemptsNotice, setAttemptsNotice] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [onboardingTarget, setOnboardingTarget] = useState(null);
  const [showOnboardingModal, setShowOnboardingModal] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      setLoading(true);

      const requests = [
        { key: "summary", promise: getCandidateSummary() },
        { key: "subjects", promise: getSubjects() },
        { key: "attempts", promise: getRecentAttempts() },
        { key: "review", promise: getReviewQueue(6) },
      ];

      requests.push(
        { key: "progress", promise: getModuleProgress() },
        { key: "availability", promise: getModuleAvailability() },
      );

      const results = await Promise.allSettled(requests.map((item) => item.promise));

      if (!active) return;

      requests.forEach((request, index) => {
        const result = results[index];

        if (result.status === "fulfilled") {
          if (request.key === "summary") {
            setSummary(result.value);
          }

          if (request.key === "subjects") {
            setSubjects(Array.isArray(result.value) ? result.value : []);
            setSubjectsNotice("");
          }

          if (request.key === "progress") {
            setProgress(Array.isArray(result.value) ? result.value : []);
            setProgressNotice("");
          }

          if (request.key === "availability") {
            const entries = Array.isArray(result.value)
              ? result.value.map((item) => [
                  item.subject_id,
                  {
                    hasContent: Boolean(item.has_content),
                    isPrepared: Boolean(item.is_prepared),
                  },
                ])
              : [];

            setAvailabilityBySubject(Object.fromEntries(entries));
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
        logAppError(`Dashboard ${request.key}`, error);

        if (request.key === "summary") {
          setSummary(null);
        }

        if (request.key === "subjects") {
          setSubjects([]);
          setSubjectsNotice("Modules are not available right now.");
        }

        if (request.key === "progress") {
          setProgress([]);
          setProgressNotice("Module progress could not be loaded right now.");
        }

        if (request.key === "availability") {
          setAvailabilityBySubject({});
          setProgressNotice((previous) => previous || "Module availability could not be loaded right now.");
        }

        if (request.key === "attempts") {
          setAttempts([]);
          setAttemptsNotice("Your practice history could not be loaded.");
        }

        if (request.key === "review") {
          setReviewQueue([]);
          setReviewNotice("Weak areas are not available right now.");
        }
      });

      setLoading(false);
    }

    void loadDashboard();

    return () => {
      active = false;
    };
  }, []);

  const freeQuestionsRemaining = useMemo(() => getFreeQuestionsRemaining(summary), [summary]);
  const firstName = getFirstName(profile?.full_name);
  const freeLimitReached = hasReachedFreeLimit(summary);
  const progressBySubject = useMemo(
    () => Object.fromEntries(progress.map((item) => [item.subject_id, item])),
    [progress],
  );
  const hasAttempts = attempts.length > 0;
  const availableSubjects = subjects.filter(
    (subject) => availabilityBySubject[subject.id]?.hasContent,
  );
  const firstSubject = subjects[0] ?? null;
  const hasAvailableContent = availableSubjects.length > 0;
  const noModuleContent =
    profileComplete &&
    subjects.length > 0 &&
    Object.keys(availabilityBySubject).length > 0 &&
    availableSubjects.length === 0;
  const firstAvailableSubject = availableSubjects[0] ?? null;
  const totalCompletedSessions = progress.length > 0
    ? progress.reduce((sum, item) => sum + Number(item.completed_attempts ?? 0), 0)
    : attempts.length;
  const attemptedModuleCount = progress.length > 0
    ? progress.filter((item) => Number(item.completed_attempts ?? 0) > 0).length
    : new Set(attempts.map((attempt) => attempt.subjects?.slug ?? attempt.subjects?.name).filter(Boolean)).size;
  const scoreValues = progress
    .filter((item) => Number(item.completed_attempts ?? 0) > 0 && Number.isFinite(Number(item.last_score_percent)))
    .map((item) => Number(item.last_score_percent));
  const averageLastScore = scoreValues.length > 0
    ? Math.round(scoreValues.reduce((sum, value) => sum + value, 0) / scoreValues.length)
    : null;
  const weakQuestionTotal = progress.reduce((sum, item) => sum + Number(item.weak_question_count ?? 0), 0);
  const hasWeakAreas = weakQuestionTotal > 0 || reviewQueue.length > 0;
  const lastAttemptPercent = attempts.length > 0
    ? formatScore(attempts[0].score, attempts[0].total_questions)
    : null;
  const canStartPractice = Boolean(firstAvailableSubject) && !freeLimitReached && profileComplete;
  const shouldShowUnlock = hasAvailableContent && freeLimitReached && !summary?.has_paid_access;
  const dashboardTitle = !profileComplete
    ? "Set your grade level"
    : noModuleContent
      ? (firstName ? `Welcome, ${firstName}` : "Welcome")
      : "Your study desk";
  const dashboardHeading = !profileComplete
    ? "Add your grade level before starting practice."
    : noModuleContent
      ? "Your practice modules are being prepared. Once questions are uploaded, you'll be able to practise, review weak areas, and track your progress here."
      : hasAttempts
        ? "Continue your preparation from where you stopped."
        : "Choose a module to begin your practice.";
  const accessCopy = summary?.has_paid_access
    ? formatExpiryDate(summary?.access_expires_at)
      ? `Unlocked until ${formatExpiryDate(summary.access_expires_at)}.`
      : "Full access is active."
    : `${freeQuestionsRemaining} of ${FREE_QUESTION_LIMIT} free questions remaining.`;
  const recommendation = !profileComplete
    ? {
        title: "Set your grade level to begin.",
        text: "Complete your details before your first practice session.",
        actionLabel: firstSubject ? "Set your grade level" : null,
        onAction: firstSubject ? () => openOnboardingForPractice(firstSubject.slug) : null,
      }
    : !hasAvailableContent
      ? {
          title: "Questions are being prepared.",
          text: "Your modules will become available once questions are uploaded.",
        }
      : shouldShowUnlock
        ? {
            title: "Unlock full access to continue.",
            text: "You have reached your free practice limit for available modules.",
            actionLabel: "View access options",
            to: "/access",
          }
        : hasWeakAreas
          ? {
              title: "Review missed questions before your next session.",
              text: "Your weak-area queue is ready for another pass.",
              actionLabel: "Open review",
              to: "/review",
            }
          : !hasAttempts && firstAvailableSubject
            ? {
                title: `Start with ${firstAvailableSubject.name}.`,
                text: "Begin your first practice session and build up your analytics.",
                actionLabel: profileComplete ? "Start practice" : "Complete details",
                to: profileComplete ? `/practice/${firstAvailableSubject.slug}` : null,
                onAction: !profileComplete ? () => openOnboardingForPractice(firstAvailableSubject.slug) : null,
              }
            : firstAvailableSubject
              ? {
                  title: "Continue practice.",
                  text: `Pick up from ${firstAvailableSubject.name} and keep your preparation moving.`,
                  actionLabel: "Continue practice",
                  to: `/practice/${firstAvailableSubject.slug}`,
                }
              : null;
  const weakAreaItems = reviewQueue.slice(0, 5);
  const readinessSubjects = (subjects.length > 0
    ? subjects.slice(0, 3)
    : [
        { id: "pfm-preview", name: "Public Financial Management" },
        { id: "psr-preview", name: "Public Service Rules" },
        { id: "ca-preview", name: "Current Affairs" },
      ]);

  const pendingTarget = location.state?.onboardingTarget ?? null;
  const activeOnboardingTarget = onboardingTarget ?? pendingTarget;
  const onboardingModalOpen = showOnboardingModal || Boolean(pendingTarget);

  useEffect(() => {
    if (!pendingTarget) return;
    navigate("/dashboard", { replace: true, state: null });
  }, [navigate, pendingTarget]);

  function openOnboardingForPractice(subjectSlug) {
    setOnboardingTarget(`/practice/${subjectSlug}`);
    setShowOnboardingModal(true);
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
      <section className={`dashboard-shell ${noModuleContent ? "is-calm" : ""}`}>
        <section className="dashboard-header dashboard-hero-compact premium-hero">
          <div className="dashboard-header-copy">
            {!noModuleContent && (
              <p className="dashboard-greeting">
                {firstName ? `Welcome, ${firstName}` : "Welcome"}
              </p>
            )}
            <h1>{dashboardTitle}</h1>
            <p className="dashboard-header-summary">{dashboardHeading}</p>
          </div>
          {!noModuleContent && (
            <article className="dashboard-note dashboard-header-card">
              <span className="section-kicker">Recommended next</span>
              <h2>{recommendation?.title ?? "Your dashboard is ready."}</h2>
              <p>{recommendation?.text ?? "Choose a module and continue your preparation."}</p>
              <div className="dashboard-header-actions">
                {recommendation?.to ? (
                  <Link className="primary-action" to={recommendation.to}>
                    {recommendation.actionLabel}
                  </Link>
                ) : recommendation?.onAction ? (
                  <button className="primary-action" onClick={recommendation.onAction} type="button">
                    {recommendation.actionLabel}
                  </button>
                ) : canStartPractice ? (
                  <Link className="primary-action" to={`/practice/${firstAvailableSubject.slug}`}>
                    {hasAttempts ? "Continue practice" : "Start practice"}
                  </Link>
                ) : shouldShowUnlock ? (
                  <Link className="primary-action" to="/access">
                    Unlock full access
                  </Link>
                ) : null}
              </div>
            </article>
          )}
        </section>

        {noModuleContent ? (
          <section className="dashboard-inline-status" aria-label="Free question allowance">
            <span className="status-label">Free questions</span>
            <strong>{`${freeQuestionsRemaining}/${FREE_QUESTION_LIMIT}`}</strong>
          </section>
        ) : (
          <section className="dashboard-overview-grid status-grid">
            <article className="stat-card status-tile">
              <span className="status-label">Free questions</span>
              <strong>{`${freeQuestionsRemaining}/${FREE_QUESTION_LIMIT}`}</strong>
            </article>
            <article className="stat-card status-tile">
              <span className="status-label">Grade level</span>
              <strong>{profile?.service_level ?? "Not set"}</strong>
            </article>
            <article className="stat-card status-tile">
              <span className="status-label">Attempts</span>
              <strong>{totalCompletedSessions || 0}</strong>
              <p>{attemptedModuleCount > 0 ? `${attemptedModuleCount} modules attempted` : "Completed sessions"}</p>
            </article>
            <article className="stat-card status-tile">
              <span className="status-label">Access</span>
              <strong>{summary?.has_paid_access ? "Full" : "Free"}</strong>
              <p>{summary?.has_paid_access ? accessCopy : "Unlock when ready"}</p>
            </article>
          </section>
        )}

        {noModuleContent ? (
          <>
            <section className="dashboard-modules-section dashboard-readiness-section" id="modules">
              <div className="dashboard-section-head">
                <div>
                  <h2>Module readiness</h2>
                </div>
                {subjectsNotice && <p className="section-note">{subjectsNotice}</p>}
              </div>
              <div className="readiness-list-card">
                <div className="readiness-list">
                  {readinessSubjects.map((subject) => (
                    <div className="readiness-row" key={subject.id ?? subject.slug}>
                      <strong className="readiness-name">{subject.name}</strong>
                      <span className="readiness-status">Coming soon</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="dashboard-content-grid">
              <div className="muted-note">
                <span className="section-kicker">After practice</span>
                <p>Scores, weak areas, and recent attempts will appear here after your first session.</p>
              </div>
            </section>
          </>
        ) : (
          <>
            <section className="dashboard-content-grid">
              <article className="analytics-card">
                <div className="analytics-card-head">
                  <div>
                    <p className="eyebrow">Analytics</p>
                    <h2>{hasAttempts ? "Progress overview" : "Progress will appear after practice"}</h2>
                  </div>
                </div>
                {!hasAttempts ? (
                  <div className="analytics-empty-state">
                    <p>Complete a session to see scores, module progress, and weak areas.</p>
                  </div>
                ) : (
                  <>
                    <div className="analytics-summary-grid">
                      <article className="analytics-summary-card">
                        <span className="panel-label">Average score</span>
                        <strong>{averageLastScore !== null ? `${averageLastScore}%` : "N/A"}</strong>
                      </article>
                      <article className="analytics-summary-card">
                        <span className="panel-label">Modules attempted</span>
                        <strong>{attemptedModuleCount}</strong>
                      </article>
                      <article className="analytics-summary-card">
                        <span className="panel-label">Weak questions</span>
                        <strong>{weakQuestionTotal}</strong>
                      </article>
                      <article className="analytics-summary-card">
                        <span className="panel-label">Last session</span>
                        <strong>{lastAttemptPercent !== null ? `${lastAttemptPercent}%` : "N/A"}</strong>
                      </article>
                    </div>
                    <div className="module-progress-list">
                      {subjects.map((subject) => {
                        const subjectProgress = progressBySubject[subject.id] ?? null;
                        const completedAttempts = Number(subjectProgress?.completed_attempts ?? 0);
                        const lastScorePercent = Number(subjectProgress?.last_score_percent ?? 0);
                        const scoreLabel = completedAttempts > 0 ? `${lastScorePercent}%` : "No attempt";

                        return (
                          <div key={subject.id ?? subject.slug} className="module-progress-row">
                            <div className="module-progress-copy">
                              <strong>{subject.name}</strong>
                              <span>{completedAttempts > 0 ? `${completedAttempts} sessions completed` : "No attempt yet"}</span>
                            </div>
                            <div className="module-progress-meter">
                              <span className="progress-bar">
                                <span style={{ width: `${completedAttempts > 0 ? lastScorePercent : 0}%` }} />
                              </span>
                              <em>{scoreLabel}</em>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </article>
            </section>

            <section className="dashboard-modules-section" id="modules">
              <div className="dashboard-section-head">
                <div>
                  <p className="eyebrow">Modules</p>
                  <h2>{subjects.length === 0 ? "No modules available yet." : "Choose where to focus next."}</h2>
                </div>
                {subjectsNotice && <p className="section-note">{subjectsNotice}</p>}
              </div>

              {subjects.length === 0 ? (
                <section className="empty-panel">
                  <h2>No modules are available yet.</h2>
                  <p>Modules will appear here once they are created.</p>
                </section>
              ) : (
                <div className="dashboard-module-grid">
                  {subjects.map((subject) => {
                    const subjectProgress = progressBySubject[subject.id] ?? null;
                    const availability = availabilityBySubject[subject.id];
                    const hasContent = profileComplete ? Boolean(availability?.hasContent) : true;
                    const availabilityKnown = profileComplete ? Boolean(availability) : true;
                    const completedAttempts = Number(subjectProgress?.completed_attempts ?? 0);
                    const hasSubjectAttempts = completedAttempts > 0;
                    const lastScorePercent = Number(subjectProgress?.last_score_percent ?? 0);
                    const weakQuestionCount = Number(subjectProgress?.weak_question_count ?? 0);
                    const mastered = Number(subjectProgress?.mastered_attempts ?? 0) > 0;
                    const shouldShowComingSoon = profileComplete && !hasContent;
                    const shouldShowModuleUnlock = profileComplete && hasContent && freeLimitReached && !summary?.has_paid_access;
                    const moduleCta = !profileComplete
                      ? { label: "Start", action: () => openOnboardingForPractice(subject.slug) }
                      : shouldShowComingSoon
                        ? { label: "Coming soon", disabled: true }
                        : shouldShowModuleUnlock
                          ? { label: "Unlock access", to: "/access" }
                          : { label: hasSubjectAttempts ? "Continue" : "Start", to: `/practice/${subject.slug}` };
                    const moduleStatus = !profileComplete
                      ? "Complete details to start"
                      : !availabilityKnown
                        ? "Availability pending"
                        : hasContent
                          ? summary?.has_paid_access
                            ? "Full access"
                            : "Available"
                          : "Coming soon";

                    return (
                      <article key={subject.id ?? subject.slug} className="module-card dashboard-module-card module-card-compact">
                        <div className="dashboard-module-top">
                          <span className="status-pill">{moduleStatus}</span>
                          <span className={`status-pill ${mastered ? "is-good" : ""}`}>
                            {mastered ? "Mastered" : hasSubjectAttempts ? "In progress" : "No attempts yet"}
                          </span>
                        </div>
                        <div className="dashboard-module-copy">
                          <h3>{subject.name}</h3>
                          <p>
                            {shouldShowComingSoon
                              ? "Questions for this module have not been uploaded yet."
                              : subject.description ?? "Practice content for this module will appear here."}
                          </p>
                        </div>
                        <div className="dashboard-module-meta">
                          <span>
                            <strong>{hasSubjectAttempts ? completedAttempts : "0"}</strong>
                            Sessions
                          </span>
                          <span>
                            <strong>{hasSubjectAttempts ? `${lastScorePercent}%` : "No attempt"}</strong>
                            Last score
                          </span>
                          <span>
                            <strong>{hasSubjectAttempts ? weakQuestionCount : "0"}</strong>
                            Weak areas
                          </span>
                        </div>
                        <div className="dashboard-module-footer">
                          {moduleCta.disabled ? (
                            <button disabled type="button">
                              {moduleCta.label}
                            </button>
                          ) : moduleCta.action ? (
                            <button className="primary-action" onClick={moduleCta.action} type="button">
                              {moduleCta.label}
                            </button>
                          ) : (
                            <Link className="primary-action" to={moduleCta.to}>
                              {moduleCta.label}
                            </Link>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="dashboard-activity-grid">
              <article className="side-panel dashboard-activity-card">
                <div className="dashboard-section-head">
                  <div>
                    <p className="eyebrow">Review</p>
                    <h2>Weak areas</h2>
                  </div>
                </div>
                {!hasAttempts ? (
                  <p className="support-copy">Complete a practice session to see what needs review.</p>
                ) : reviewNotice ? (
                  <p className="support-copy">{reviewNotice}</p>
                ) : weakAreaItems.length === 0 ? (
                  <p className="support-copy">No weak areas found yet.</p>
                ) : (
                  <div className="attempt-list">
                    {weakAreaItems.map((item) => (
                      <article key={item.question_id}>
                        <div>
                          <strong>{item.subject_name}</strong>
                          <span>{item.question_text}</span>
                        </div>
                        <span className="status-pill">{item.times_missed} misses</span>
                      </article>
                    ))}
                  </div>
                )}
              </article>

              <article className="side-panel dashboard-activity-card">
                <div className="dashboard-section-head">
                  <div>
                    <p className="eyebrow">Recent activity</p>
                    <h2>Recent attempts</h2>
                  </div>
                </div>
                {attemptsNotice ? (
                  <p className="support-copy">{attemptsNotice}</p>
                ) : attempts.length === 0 ? (
                  <p className="support-copy">Your attempts will appear after your first practice session.</p>
                ) : (
                  <div className="attempt-list">
                    {attempts.map((attempt) => {
                      const percent = formatScore(attempt.score, attempt.total_questions);

                      return (
                        <article key={attempt.id}>
                          <div>
                            <strong>{attempt.subjects?.name ?? "Module session"}</strong>
                            <span>{percent !== null ? `${percent}% on your last run` : "Attempt completed"}</span>
                          </div>
                          <span>{new Date(attempt.started_at).toLocaleDateString()}</span>
                        </article>
                      );
                    })}
                  </div>
                )}
              </article>
            </section>
          </>
        )}

      </section>
      {onboardingModalOpen && (
        <ProfileOnboardingModal
          key={activeOnboardingTarget ?? "dashboard-onboarding"}
          nextPath={activeOnboardingTarget ?? "/dashboard"}
          onClose={closeOnboardingModal}
          onComplete={() => {
            setShowOnboardingModal(false);
            setOnboardingTarget(null);
          }}
        />
      )}
    </AppFrame>
  );
}
