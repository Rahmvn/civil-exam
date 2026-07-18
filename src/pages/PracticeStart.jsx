import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import {
  AnimatedProgressBar,
  DashboardActionButton,
  FreeBatchConfirmationModal,
} from "../components/DashboardUi";
import { LoadingState } from "../components/LoadingState";
import {
  getCandidateSummary,
  getModuleAccessCatalog,
  getModuleBatchAccess,
  getRecentAttempts,
  getSubjects,
  startPracticeBatch,
} from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import {
  FALLBACK_SUBJECTS,
  getModuleDisplayName,
  getProgressionRecommendation,
  hasStartablePublishedBatch,
  isModulePurchaseUnavailable,
  isCandidateModuleComingSoon,
  isPublishedBatchRow,
  shouldShowPracticeHubModule,
} from "../lib/moduleDisplay";
import { storePracticeBatch } from "../lib/practiceSession";
import { getPracticeRoute } from "../lib/oralPractice";

function getPracticeAction(module, { hasSelectedFreeModule, onSelectFreeModule }) {
  const targetRow = module.progression.recommendedRow;
  const batchNumber = Number(targetRow?.batch_number ?? 1);

  if (!targetRow) return null;

  if (module.isPaused) {
    return { label: "Temporarily paused", disabled: true };
  }

  if (module.isPurchaseUnavailable) {
    return { label: "Not available yet", disabled: true };
  }

  if (module.isComplete && module.hasModuleAccess) {
    return { label: "Practice again", to: `/modules/${module.subject.slug}` };
  }

  if (
    !module.hasModuleAccess
    && !hasSelectedFreeModule
    && batchNumber === 1
    && targetRow.reason_code === "free_batch_available"
  ) {
    return {
      label: "Try free",
      action: () => onSelectFreeModule(module.subject),
    };
  }

  if (targetRow.state === "locked_requires_payment" || !targetRow.can_start) {
    return {
      label: "Unlock module",
      to: `/access?module=${encodeURIComponent(module.subject.slug)}`,
    };
  }

  if (!module.hasModuleAccess && targetRow.state === "completed_passed") {
    return {
      label: "Unlock module",
      to: `/access?module=${encodeURIComponent(module.subject.slug)}`,
    };
  }

  if (targetRow.state === "completed_failed") {
    return {
      label: "Retry practice",
      to: getPracticeRoute(module.subject, batchNumber),
    };
  }

  if (Number(targetRow.attempt_count ?? 0) > 0) {
    return {
      label: "Continue practice",
      to: getPracticeRoute(module.subject, batchNumber),
    };
  }

  return {
    label: "Start practice",
    to: getPracticeRoute(module.subject, batchNumber),
  };
}

function PracticeLaunchCard({ module, primaryAction, secondaryAction, showProgress = true }) {
  return (
    <article className={`practice-hub-launch-card ${showProgress ? "" : "is-module-choice"}`.trim()}>
      <div className="practice-hub-launch-copy">
        <h2>{module.displayName}</h2>
        {module.isPaused && <p>This practice set is temporarily unavailable while its content is being updated. Your access and previous results are safe.</p>}
      </div>

      {showProgress && (
        <div className="practice-hub-card-progress">
          <div>
            <span>Progress</span>
            <strong>{`${module.progressPercent}% complete`}</strong>
          </div>
          <AnimatedProgressBar value={module.progressPercent} />
        </div>
      )}

      <div className="practice-hub-card-actions">
        <DashboardActionButton action={primaryAction} />
        {secondaryAction && (
          <DashboardActionButton action={secondaryAction} className="practice-hub-card-secondary" />
        )}
      </div>
    </article>
  );
}

function LockedModuleRow({ module }) {
  return (
    <article className="practice-hub-locked-row">
      <h3>{module.displayName}</h3>
      <DashboardActionButton
        action={{
          label: "Unlock module",
          to: `/access?module=${encodeURIComponent(module.subject.slug)}`,
        }}
        className="practice-hub-row-action"
      />
    </article>
  );
}

export default function PracticeStart() {
  const navigate = useNavigate();
  const mountedRef = useRef(true);
  const [summary, setSummary] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [moduleAccessCatalog, setModuleAccessCatalog] = useState([]);
  const [batchRows, setBatchRows] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [startConfirmSubject, setStartConfirmSubject] = useState(null);
  const [startingPractice, setStartingPractice] = useState(false);

  const loadPracticeHub = useCallback(async () => {
    try {
      const [candidateSummary, nextSubjects, accessCatalog, rows, recentAttempts] = await Promise.all([
        getCandidateSummary(),
        getSubjects(),
        getModuleAccessCatalog(),
        getModuleBatchAccess(),
        getRecentAttempts(12),
      ]);

      if (!mountedRef.current) return;
      setSummary(candidateSummary);
      setSubjects(Array.isArray(nextSubjects) ? nextSubjects : []);
      setModuleAccessCatalog(Array.isArray(accessCatalog) ? accessCatalog : []);
      setBatchRows(Array.isArray(rows) ? rows : []);
      setAttempts(Array.isArray(recentAttempts) ? recentAttempts : []);
    } catch (loadError) {
      if (!mountedRef.current) return;
      logAppError("Practice hub", loadError);
      setError(friendlyErrorMessage(loadError, "We could not prepare your practice options right now."));
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const loadTimer = window.setTimeout(() => {
      void loadPracticeHub();
    }, 0);
    return () => {
      window.clearTimeout(loadTimer);
      mountedRef.current = false;
    };
  }, [loadPracticeHub]);

  const freeModuleSlug = summary?.free_module_subject_slug ?? null;
  const hasSelectedFreeModule = Boolean(freeModuleSlug);
  const subjectsForDisplay = subjects.length > 0 ? subjects : FALLBACK_SUBJECTS;
  const catalogBySubject = useMemo(() => {
    const entries = new Map();

    moduleAccessCatalog.forEach((row) => {
      if (!row?.subject_slug) return;
      entries.set(row.subject_slug, row);
    });

    return entries;
  }, [moduleAccessCatalog]);

  const modules = useMemo(() => {
    const rowsBySubject = new Map();

    batchRows.forEach((row) => {
      if (!row?.subject_slug) return;
      const rows = rowsBySubject.get(row.subject_slug) ?? [];
      rows.push(row);
      rowsBySubject.set(row.subject_slug, rows);
    });

    return subjectsForDisplay.map((subject) => {
      const rows = rowsBySubject.get(subject.slug) ?? [];
      const catalogEntry = catalogBySubject.get(subject.slug) ?? null;
      const publishedRows = rows.filter(isPublishedBatchRow);
      const hasModuleAccess =
        Boolean(catalogEntry?.has_module_access) ||
        rows.some((row) => Boolean(row?.is_paid));
      const canPurchase = catalogEntry ? Boolean(catalogEntry.can_purchase) : true;
      const isPaused = catalogEntry?.candidate_availability === "paused";
      const completedCount = publishedRows.filter((row) => row.state === "completed_passed").length;
      const progression = getProgressionRecommendation(rows, { isPaidUser: hasModuleAccess });
      const hasStartableAccess = !isPaused && hasStartablePublishedBatch(rows);

      return {
        subject,
        displayName: getModuleDisplayName(subject.name),
        rows,
        publishedCount: publishedRows.length,
        completedCount,
        progressPercent: publishedRows.length > 0
          ? Math.round((completedCount / publishedRows.length) * 100)
          : 0,
        progression,
        canPurchase,
        hasModuleAccess,
        hasStartableAccess,
        isPaused,
        isPurchaseUnavailable: isModulePurchaseUnavailable({ hasModuleAccess, canPurchase, rows }),
        isVisibleInPracticeHub: shouldShowPracticeHubModule({ hasModuleAccess, canPurchase, rows }),
        isComingSoon: isCandidateModuleComingSoon(subject, publishedRows.length),
        isComplete: publishedRows.length > 0 && completedCount === publishedRows.length,
      };
    });
  }, [batchRows, catalogBySubject, subjectsForDisplay]);

  const publishedModules = modules.filter((module) => !module.isComingSoon && module.isVisibleInPracticeHub);
  const practiceModules = publishedModules.filter(
    (module) => module.hasModuleAccess || module.hasStartableAccess,
  );
  const isChoosingFirstModule = practiceModules.length === 0;
  const lockedModules = isChoosingFirstModule
    ? []
    : publishedModules.filter(
      (module) => !module.hasModuleAccess && !module.hasStartableAccess,
    );

  function selectFreeModule(subject) {
    setActionError("");
    setStartConfirmSubject(subject);
  }

  function retryPracticeHub() {
    setLoading(true);
    setError("");
    void loadPracticeHub();
  }

  function buildAction(module) {
    return getPracticeAction(module, {
      hasSelectedFreeModule,
      onSelectFreeModule: selectFreeModule,
    });
  }

  function getSecondaryAction(module, { firstChoice = false } = {}) {
    if (module.isPurchaseUnavailable) {
      return null;
    }

    if (firstChoice) {
      return {
        label: "Unlock module",
        to: `/access?module=${encodeURIComponent(module.subject.slug)}`,
      };
    }

    if (module.hasModuleAccess && !module.isComplete) {
      return {
        label: "Choose practice set",
        to: `/modules/${module.subject.slug}`,
      };
    }

    const latestAttempt = attempts.find(
      (attempt) => attempt?.subjects?.slug === module.subject.slug,
    );

    if (!module.hasModuleAccess && latestAttempt?.id) {
      return {
        label: "Review answers",
        to: `/review?attempt=${latestAttempt.id}`,
      };
    }

    return null;
  }

  async function confirmStartFreePractice() {
    if (!startConfirmSubject) return;
    setStartingPractice(true);
    setActionError("");

    try {
      if (startConfirmSubject.practice_type === "oral") {
        const nextPath = getPracticeRoute(startConfirmSubject, 1);
        setStartConfirmSubject(null);
        navigate(nextPath);
        return;
      }

      const practiceQuestions = await startPracticeBatch(startConfirmSubject.slug, 1);
      storePracticeBatch(startConfirmSubject.slug, practiceQuestions);
      const subjectSlug = startConfirmSubject.slug;
      setStartConfirmSubject(null);
      navigate(`/practice/${subjectSlug}?batch=1`, { state: { batchStarted: true } });
    } catch (startError) {
      logAppError(`Practice hub start:${startConfirmSubject.slug}`, startError);
      setActionError(friendlyErrorMessage(startError, "We could not start this practice right now."));
      setStartConfirmSubject(null);
    } finally {
      setStartingPractice(false);
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
      <section className="practice-hub">
        {(isChoosingFirstModule || error) && (
          <header className="practice-hub-heading">
            {isChoosingFirstModule && <h1>Choose a module</h1>}
            {isChoosingFirstModule && !error && (
              <p>Try one module free, or unlock the module you need.</p>
            )}
          </header>
        )}

        {error ? (
          <article className="practice-hub-error">
            <h2>Practice is unavailable</h2>
            <p>{error}</p>
            <div className="practice-hub-error-actions">
              <button className="primary-action" onClick={retryPracticeHub} type="button">Try again</button>
              <Link className="secondary-action" to="/dashboard#modules">View modules</Link>
            </div>
          </article>
        ) : isChoosingFirstModule ? (
          <div className="practice-hub-choice-grid">
            {publishedModules.map((module) => (
              <PracticeLaunchCard
                key={module.subject.id}
                module={module}
                primaryAction={buildAction(module)}
                secondaryAction={getSecondaryAction(module, { firstChoice: true })}
                showProgress={false}
              />
            ))}
          </div>
        ) : (
          <div className="practice-hub-content">
            <section className="practice-hub-ready-section" aria-labelledby="your-practice-modules">
              <h2 id="your-practice-modules">Your modules</h2>
              <div className="practice-hub-ready-grid">
                {practiceModules.map((module) => (
                  <PracticeLaunchCard
                    key={module.subject.id}
                    module={module}
                    primaryAction={buildAction(module)}
                    secondaryAction={getSecondaryAction(module)}
                  />
                ))}
              </div>
            </section>

            {lockedModules.length > 0 && (
              <section className="practice-hub-more-section" aria-labelledby="more-practice-modules">
                <h2 id="more-practice-modules">More modules</h2>
                <div className="practice-hub-locked-list">
                  {lockedModules.map((module) => (
                    <LockedModuleRow key={module.subject.id} module={module} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {actionError && <p className="action-error" role="alert">{actionError}</p>}
      </section>

      <FreeBatchConfirmationModal
        loading={startingPractice}
        onCancel={() => setStartConfirmSubject(null)}
        onConfirm={() => void confirmStartFreePractice()}
        subject={startConfirmSubject}
      />
    </AppFrame>
  );
}
