import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import {
  AnimatedProgressBar,
  DashboardActionButton,
  FreeBatchConfirmationModal,
  ScoreRing,
} from "../components/DashboardUi";
import { UnlockModuleModal } from "../components/UnlockModuleModal";
import {
  getCandidateSummary,
  initializePayment,
  getModuleAccessCatalog,
  getModuleBatchAccess,
  getRecentAttempts,
  getReviewQueue,
  getSubjects,
  startPracticeBatch,
} from "../lib/appApi";
import { friendlyErrorMessage, isExpectedAbortError, logAppError } from "../lib/errors";
import {
  formatAttemptPercent,
  formatDate,
  formatPercent,
  getFirstName,
  hasStartablePublishedBatch,
  hasUsableCandidateModuleAccess,
  isModulePurchaseUnavailable,
  isCandidateModuleComingSoon,
  getModuleDisplayName,
  getProgressionRecommendation,
  isPublishedBatchRow,
  shouldShowCandidateModule,
} from "../lib/moduleDisplay";
import { storePracticeBatch } from "../lib/practiceSession";
import { getPracticeRoute } from "../lib/oralPractice";
import { useAuth } from "../lib/useAuth";

export default function Dashboard() {
  const { profile, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const mountedRef = useRef(true);
  const [summary, setSummary] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [moduleAccessCatalog, setModuleAccessCatalog] = useState([]);
  const [moduleBatchAccess, setModuleBatchAccess] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [subjectsNotice, setSubjectsNotice] = useState("");
  const [attemptsNotice, setAttemptsNotice] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [moduleDataError, setModuleDataError] = useState("");
  const [startConfirmSubject, setStartConfirmSubject] = useState(null);
  const [startingBatch, setStartingBatch] = useState(false);
  const [unlockModule, setUnlockModule] = useState(null);
  const [payingModule, setPayingModule] = useState("");
  const [ctaError, setCtaError] = useState("");
  const [paymentError, setPaymentError] = useState(null);

  const loadDashboardData = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading && mountedRef.current) setLoading(true);
    if (mountedRef.current) setModuleDataError("");

    const requests = [
      { key: "summary", promise: getCandidateSummary() },
      { key: "subjects", promise: getSubjects() },
      { key: "catalog", promise: getModuleAccessCatalog() },
      { key: "batchAccess", promise: getModuleBatchAccess() },
      { key: "attempts", promise: getRecentAttempts(12) },
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
        if (request.key === "catalog") setModuleAccessCatalog(Array.isArray(result.value) ? result.value : []);
        if (request.key === "batchAccess") setModuleBatchAccess(Array.isArray(result.value) ? result.value : []);
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
      if (request.key === "catalog") setModuleAccessCatalog([]);
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

    const criticalModuleKeys = new Set(["summary", "subjects", "catalog", "batchAccess"]);
    const hasModuleFailure = requests.some((request, index) => (
      criticalModuleKeys.has(request.key) && results[index].status === "rejected"
    ));
    setModuleDataError(hasModuleFailure
      ? "Your module access could not be loaded. No access changes have been made."
      : "");

    if (mountedRef.current) setLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadDashboardData();
    return () => {
      mountedRef.current = false;
    };
  }, [loadDashboardData]);

  const subjectsForDisplay = subjects;
  const batchAccessBySubject = useMemo(() => {
    const grouped = {};

    moduleBatchAccess.forEach((row) => {
      if (!row?.subject_slug) return;
      grouped[row.subject_slug] ??= [];
      grouped[row.subject_slug].push(row);
    });

    Object.values(grouped).forEach((rows) => {
      rows.sort((left, right) => Number(left.batch_number ?? 0) - Number(right.batch_number ?? 0));
    });

    return grouped;
  }, [moduleBatchAccess]);
  const catalogBySubject = useMemo(() => {
    const entries = new Map();

    moduleAccessCatalog.forEach((row) => {
      if (!row?.subject_slug) return;
      entries.set(row.subject_slug, row);
    });

    return entries;
  }, [moduleAccessCatalog]);

  const freeModuleSlug = summary?.free_module_subject_slug ?? null;
  const hasSelectedFreeModule = Boolean(freeModuleSlug);
  const firstName = getFirstName(profile?.full_name);
  const averageScore = attempts.length > 0
    ? Math.round(
        attempts.reduce(
          (sum, attempt) => sum + Number(attempt.score_percent ?? formatAttemptPercent(attempt) ?? 0),
          0,
        ) / attempts.length,
      )
    : 0;
  const previewAttempts = attempts.slice(0, 2);
  const reviewQueueCount = reviewQueue.length;
  useEffect(() => {
    if (loading || location.hash !== "#modules") return;
    const target = document.getElementById("modules");
    if (!target) return;
    const frameId = window.requestAnimationFrame(() => target.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frameId);
  }, [loading, location.hash]);

  function openUnlockModule(subject) {
    const catalogEntry = catalogBySubject.get(subject.slug);
    setCtaError("");
    setPaymentError(null);

    if (!catalogEntry?.can_purchase || !Number.isFinite(Number(catalogEntry.price_kobo))) {
      setCtaError("We could not prepare this module payment right now.");
      return;
    }

    setUnlockModule({
      ...subject,
      subject_slug: subject.slug,
      subject_name: subject.name,
      price_kobo: catalogEntry?.price_kobo,
      currency: catalogEntry?.currency,
    });
  }

  function closeUnlockModule() {
    setPaymentError(null);
    setUnlockModule(null);
  }

  async function startPayment(subjectSlug) {
    if (payingModule) return;
    setPayingModule(subjectSlug);
    setPaymentError(null);

    try {
      const payment = await initializePayment(subjectSlug);
      if (payment.already_paid) {
        await loadDashboardData({ showLoading: false });
        closeUnlockModule();
        return;
      }
      window.location.assign(payment.authorization_url);
    } catch (paymentRequestError) {
      logAppError("Dashboard payment start", paymentRequestError);
      setPaymentError({
        subjectSlug,
        message: friendlyErrorMessage(paymentRequestError, "We could not start payment right now. Please try again."),
      });
    } finally {
      setPayingModule("");
    }
  }

  function buildModuleAction(subject, rows, progression, completedCount, publishedCount, hasModuleAccess, canPurchase) {
    const recommendedRow = progression.recommendedRow;
    const batchOneRow = rows.find((row) => Number(row.batch_number ?? 0) === 1) ?? recommendedRow;
    const targetRow = !hasModuleAccess ? batchOneRow : recommendedRow;
    const batchNumber = Number(targetRow?.batch_number ?? 1);
    const purchaseUnavailable = isModulePurchaseUnavailable({ hasModuleAccess, canPurchase, rows });

    if (publishedCount === 0 || !targetRow) {
      return { label: "Coming soon", disabled: true };
    }

    if (purchaseUnavailable) {
      return { label: "Not currently for sale", disabled: true };
    }

    if (hasModuleAccess && completedCount === publishedCount) {
      return { label: "Practice again", to: `/modules/${subject.slug}` };
    }

    if (!hasModuleAccess && !hasSelectedFreeModule && targetRow.reason_code === "free_batch_available") {
      return {
        label: "Try free",
        action: () => {
          setCtaError("");
          setStartConfirmSubject(subject);
        },
      };
    }

    if (targetRow.state === "locked_requires_payment" || !targetRow.can_start) {
      return { label: "Unlock module", action: () => openUnlockModule(subject) };
    }

    if (targetRow.state === "completed_failed") {
      return { label: "Retry practice", to: getPracticeRoute(subject, batchNumber) };
    }

    if (!hasModuleAccess && targetRow.state === "completed_passed") {
      return { label: "Unlock module", action: () => openUnlockModule(subject) };
    }

    if (Number(targetRow.attempt_count ?? 0) > 0) {
      return { label: "Continue practice", to: getPracticeRoute(subject, batchNumber) };
    }

    return {
      label: subject.slug === freeModuleSlug ? "Continue practice" : "Start practice",
      to: getPracticeRoute(subject, batchNumber),
    };
  }

  const moduleCards = subjectsForDisplay.map((subject) => {
    const rows = batchAccessBySubject[subject.slug] ?? [];
    const catalogEntry = catalogBySubject.get(subject.slug) ?? null;
    const publishedRows = rows.filter(isPublishedBatchRow);
    const batchOneRow = rows.find((row) => Number(row.batch_number ?? 0) === 1) ?? null;
    const hasModuleAccess =
      Boolean(catalogEntry?.has_module_access) ||
      rows.some((row) => Boolean(row?.is_paid));
    const canPurchase = Boolean(catalogEntry?.can_purchase);
    const candidateAvailability = catalogEntry?.candidate_availability ?? subject.candidate_availability;
    const isPaused = candidateAvailability === "paused";
    const completedCount = publishedRows.filter((row) => row.state === "completed_passed").length;
    const progression = getProgressionRecommendation(rows, { isPaidUser: hasModuleAccess });
    const progressPercent = publishedRows.length > 0
      ? Math.round((completedCount / publishedRows.length) * 100)
      : 0;
    const isComingSoon = isCandidateModuleComingSoon(subject, publishedRows.length);
    const hasUsableModuleAccess = hasUsableCandidateModuleAccess(
      subject,
      publishedRows.length,
      hasModuleAccess,
    );
    const purchaseUnavailable = isModulePurchaseUnavailable({ hasModuleAccess, canPurchase, rows });
    const hasStartableAccess = !isPaused && hasStartablePublishedBatch(rows);
    const hasModuleActivity = hasUsableModuleAccess || (!isComingSoon && publishedRows.some((row) =>
      Number(row?.attempt_count ?? 0) > 0
      || row?.state === "completed_passed"
      || row?.state === "completed_failed"
    ));
    const primaryAction = isPaused
      ? { label: "Temporarily paused", disabled: true }
      : isComingSoon
      ? { label: "Coming soon", disabled: true }
      : buildModuleAction(subject, rows, progression, completedCount, publishedRows.length, hasModuleAccess, canPurchase);
    const shouldEmphasizeUnlock = !purchaseUnavailable && !hasModuleAccess && primaryAction.label === "Try free" && !isComingSoon;
    const secondaryAction = hasUsableModuleAccess && completedCount < publishedRows.length
      ? { label: "Choose another practice set", to: `/modules/${subject.slug}` }
      : !purchaseUnavailable && !hasModuleAccess && primaryAction.label !== "Unlock module" && !isComingSoon
        ? { label: "Unlock module", action: () => openUnlockModule(subject) }
        : null;

    return {
      subject,
      displayName: getModuleDisplayName(subject.name),
      completedCount,
      publishedCount: publishedRows.length,
      progressPercent,
      isComingSoon,
      isPaused,
      isComplete: !isComingSoon && publishedRows.length > 0 && completedCount === publishedRows.length,
      canPurchase,
      hasModuleAccess,
      hasUsableModuleAccess,
      hasStartableAccess,
      isVisibleToCandidate: shouldShowCandidateModule({
        subject,
        publishedCount: publishedRows.length,
        hasModuleAccess,
        canPurchase,
        rows,
      }),
      showProgress: hasModuleActivity,
      freePracticeComplete: Boolean(
        batchOneRow?.state === "completed_passed"
        || (batchOneRow?.state === "completed_failed" && !batchOneRow?.can_start)
        || batchOneRow?.reason_code === "free_retry_used_requires_payment"
        || batchOneRow?.reason_code === "free_batch_passed_requires_payment"
      ),
      primaryAction,
      primaryActionClassName: shouldEmphasizeUnlock ? "module-free-action" : "primary-action",
      secondaryAction,
      secondaryActionClassName: shouldEmphasizeUnlock
        ? "primary-action"
        : hasUsableModuleAccess ? "module-chooser-link" : "secondary-action module-unlock-action",
    };
  }).filter((card) => card.isVisibleToCandidate);
  const unlockedModuleCount = moduleCards.filter((card) => card.hasUsableModuleAccess).length;

  const accessCopy = (() => {
    if (unlockedModuleCount > 0) {
      return `${unlockedModuleCount} module${unlockedModuleCount === 1 ? "" : "s"} unlocked.`;
    }
    if (!hasSelectedFreeModule) return "Begin free or unlock any module.";

    const selectedCard = moduleCards.find((card) => card.subject.slug === freeModuleSlug);
    if (selectedCard?.freePracticeComplete) return "Your free practice is complete.";
    return `${selectedCard?.displayName ?? "One module"} selected for free practice.`;
  })();
  const moduleChoiceCopy = !hasSelectedFreeModule
    ? "Try one module free, or unlock any module now."
    : unlockedModuleCount > 0
      ? "Continue practising or unlock another module."
      : "Continue your free module or unlock any module.";

  async function confirmStartFreeBatch() {
    if (!startConfirmSubject) return;
    setStartingBatch(true);
    setCtaError("");

    try {
      if (startConfirmSubject.practice_type === "oral") {
        const nextPath = getPracticeRoute(startConfirmSubject, 1);
        setStartConfirmSubject(null);
        navigate(nextPath);
        return;
      }

      const batch = await startPracticeBatch(startConfirmSubject.slug, 1);
      storePracticeBatch(startConfirmSubject.slug, batch, user?.id);
      setStartConfirmSubject(null);
      navigate(`/practice/${startConfirmSubject.slug}?batch=1`, { state: { batchStarted: true } });
    } catch (error) {
      logAppError(`Dashboard start practice:${startConfirmSubject.slug}`, error);
      setCtaError(friendlyErrorMessage(error, "We could not start this practice right now."));
      setStartConfirmSubject(null);
    } finally {
      setStartingBatch(false);
    }
  }

  if (loading) {
    return (
      <AppFrame>
        <LoadingState />
      </AppFrame>
    );
  }

  return (
    <AppFrame>
      <section className="dashboard-hub dashboard-hub-compact dashboard-module-first">
        <section className={`dashboard-welcome-panel dashboard-welcome-panel-compact ${attempts.length === 0 ? "without-score" : ""}`.trim()}>
          <div className="dashboard-welcome-copy dashboard-welcome-copy-intro">
            <h1>{firstName ? `Welcome, ${firstName}` : "Welcome"}</h1>
            {!moduleDataError ? <div className="dashboard-welcome-access-line">
              <span className={`dashboard-access-chip ${unlockedModuleCount > 0 ? "is-full" : "is-free"}`}>
                {unlockedModuleCount > 0 ? "Module access" : "Free practice available"}
              </span>
              <p>{accessCopy}</p>
            </div> : <p className="dashboard-authority-note">Module access is temporarily unavailable.</p>}
          </div>
          {attempts.length > 0 && (
            <ScoreRing
              className="dashboard-welcome-score"
              label="Average score"
              sublabel={`Based on last ${attempts.length} attempt${attempts.length === 1 ? "" : "s"}`}
              value={averageScore}
            />
          )}
        </section>

        {ctaError && <p className="action-error" role="alert">{ctaError}</p>}

        <section className="dashboard-section-block" id="modules">
          <div className="dashboard-section-heading">
            <div className="dashboard-section-heading-copy">
              <h2>Modules</h2>
              <p className="dashboard-module-choice-copy">{moduleChoiceCopy}</p>
            </div>
            {subjectsNotice && <p className="section-note">{subjectsNotice}</p>}
          </div>

          {moduleDataError ? (
            <div className="dashboard-module-load-error" role="alert">
              <p>{moduleDataError}</p>
              <button className="text-action" onClick={() => void loadDashboardData({ showLoading: false })} type="button">Try again</button>
            </div>
          ) : moduleCards.length === 0 ? (
            <div className="dashboard-module-load-error">
              <p>No modules are currently visible. Please check again later.</p>
            </div>
          ) : <div className="dashboard-module-grid-v3">
            {moduleCards.map((card) => (
              <article className={`module-card-v3 module-card-progressive ${card.hasUsableModuleAccess ? "is-unlocked" : ""} ${card.isComplete ? "is-complete" : ""}`.trim()} key={card.subject.id}>
                <div className="module-card-v3-head">
                  <h3>{card.displayName}</h3>
                  {card.hasUsableModuleAccess && !card.isComplete && (
                    <span className="module-access-state">Unlocked</span>
                  )}
                </div>

                <div className={`module-card-progressive-body ${card.showProgress ? "has-progress" : ""}`.trim()}>
                  {card.isPaused ? (
                    <p className="module-card-availability">Practice is temporarily paused. Your access and previous results are safe.</p>
                  ) : card.isComingSoon ? (
                    <p className="module-card-availability">Practice for this module is coming soon.</p>
                  ) : card.showProgress ? (
                    <div className="module-progress-summary">
                      <div className="module-progress-summary-copy">
                        <span>{card.isComplete ? "Completed" : "Module progress"}</span>
                        <strong>{`${card.completedCount} of ${card.publishedCount} practice sets completed`}</strong>
                      </div>
                      <AnimatedProgressBar value={card.progressPercent} />
                    </div>
                  ) : null}

                  <div className="module-card-actions module-card-actions-progressive">
                    <DashboardActionButton action={card.primaryAction} className={card.primaryActionClassName} />
                    <DashboardActionButton
                      action={card.secondaryAction}
                      className={card.secondaryActionClassName}
                    />
                  </div>
                </div>
              </article>
            ))}
          </div>}
        </section>

        {(previewAttempts.length > 0 || attemptsNotice) && <section className="dashboard-section-block">
          <div className="dashboard-section-heading">
            <div className="dashboard-section-heading-copy"><h2>Recent attempts</h2></div>
          </div>

          <article className="dashboard-panel-card recent-attempts-card">
            {attemptsNotice ? (
              <p className="support-copy">{attemptsNotice}</p>
            ) : (
              <div className="recent-attempts-list">
                {previewAttempts.map((attempt) => {
                  const attemptScore = formatPercent(attempt.score_percent ?? formatAttemptPercent(attempt));
                  return (
                    <article className="recent-attempt-row" key={attempt.id}>
                      <div className="recent-attempt-copy">
                        <strong>{getModuleDisplayName(attempt.subjects?.name) ?? "Module"}</strong>
                        <p>{[
                          `Practice set ${attempt.batch_number ?? 1}`,
                          attemptScore ?? "Score unavailable",
                          attempt.passed ? "Passed" : "Not passed",
                          formatDate(attempt.completed_at ?? attempt.started_at),
                        ].join(" - ")}</p>
                      </div>
                      <Link className="ghost-button" to={`/review?attempt=${attempt.id}`}>Review</Link>
                    </article>
                  );
                })}
              </div>
            )}

            <div className="dashboard-review-handoff">
              {previewAttempts.length > 0 && <Link className="text-link dashboard-inline-link" to="/review">View all reviews</Link>}
              {!reviewNotice && reviewQueueCount > 0 && <p>{`${reviewQueueCount} review item${reviewQueueCount === 1 ? "" : "s"} waiting in Review.`}</p>}
              {reviewNotice && <p>{reviewNotice}</p>}
            </div>
          </article>
        </section>}
      </section>

      <FreeBatchConfirmationModal
        loading={startingBatch}
        onCancel={() => setStartConfirmSubject(null)}
        onConfirm={() => void confirmStartFreeBatch()}
        subject={startConfirmSubject}
      />
      <UnlockModuleModal
        error={paymentError && unlockModule && paymentError.subjectSlug === unlockModule.subject_slug ? paymentError.message : ""}
        module={unlockModule}
        onClose={closeUnlockModule}
        onStartPayment={startPayment}
        paying={payingModule === unlockModule?.subject_slug}
      />
    </AppFrame>
  );
}
