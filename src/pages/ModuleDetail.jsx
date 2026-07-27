import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import {
  AnimatedProgressBar,
  DashboardActionButton,
  FreeBatchConfirmationModal,
  SkipAheadConfirmationModal,
} from "../components/DashboardUi";
import {
  getCandidateSummary,
  getModuleAccessCatalog,
  getModuleBatchAccess,
  getRecentAttempts,
  getSubjects,
  startPracticeBatch,
} from "../lib/appApi";
import { friendlyErrorMessage, isExpectedAbortError, logAppError } from "../lib/errors";
import {
  getBatchProgressionGuidance,
  getLockReason,
  getModuleDisplayName,
  getProgressionRecommendation,
  isModulePurchaseUnavailable,
  isCandidateModuleComingSoon,
  isPublishedBatchRow,
} from "../lib/moduleDisplay";
import { storePracticeBatch } from "../lib/practiceSession";
import { getPracticeRoute } from "../lib/oralPractice";
import { useAuth } from "../lib/useAuth";

export default function ModuleDetail() {
  const { user } = useAuth();
  const { subjectSlug = "" } = useParams();
  const navigate = useNavigate();
  const mountedRef = useRef(true);
  const [summary, setSummary] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [moduleAccessCatalog, setModuleAccessCatalog] = useState([]);
  const [rows, setRows] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [moduleNotice, setModuleNotice] = useState("");
  const [ctaError, setCtaError] = useState("");
  const [startConfirmSubject, setStartConfirmSubject] = useState(null);
  const [startingBatch, setStartingBatch] = useState(false);
  const [skipAheadConfirm, setSkipAheadConfirm] = useState(null);

  const loadModuleData = useCallback(async ({ showLoading = true } = {}) => {
    if (!subjectSlug) return;

    if (showLoading && mountedRef.current) {
      setLoading(true);
    }

    if (mountedRef.current) {
      setModuleNotice("");
    }

    const requests = [
      { key: "summary", promise: getCandidateSummary() },
      { key: "subjects", promise: getSubjects() },
      { key: "catalog", promise: getModuleAccessCatalog() },
      { key: "batchAccess", promise: getModuleBatchAccess(subjectSlug) },
      { key: "attempts", promise: getRecentAttempts() },
    ];

    const results = await Promise.allSettled(requests.map((item) => item.promise));

    if (!mountedRef.current) {
      return;
    }

    const next = {};

    results.forEach((result, index) => {
      const { key } = requests[index];

      if (result.status === "fulfilled") {
        next[key] = result.value;
      } else if (!isExpectedAbortError(result.reason)) {
        logAppError(`Module detail load ${key}`, result.reason);
        if (key === "batchAccess") {
          setModuleNotice("We could not load this module's practice sets right now.");
        }
      }
    });

    setSummary(next.summary ?? null);
    setSubjects(Array.isArray(next.subjects) ? next.subjects : []);
    setModuleAccessCatalog(Array.isArray(next.catalog) ? next.catalog : []);
    setRows(Array.isArray(next.batchAccess) ? next.batchAccess : []);
    setAttempts(Array.isArray(next.attempts) ? next.attempts : []);
    setLoading(false);
  }, [subjectSlug]);

  useEffect(() => {
    mountedRef.current = true;
    void loadModuleData();

    return () => {
      mountedRef.current = false;
    };
  }, [loadModuleData]);

  const subject = subjects.find((item) => item.slug === subjectSlug) ?? null;
  const catalogEntry = moduleAccessCatalog.find((item) => item?.subject_slug === subjectSlug) ?? null;
  const freeModuleSlug = summary?.free_module_subject_slug ?? null;
  const hasSelectedFreeModule = Boolean(freeModuleSlug);
  const hasModuleAccess =
    Boolean(catalogEntry?.has_module_access) ||
    rows.some((row) => Boolean(row?.is_paid));
  const canPurchase = Boolean(catalogEntry?.can_purchase);
  const candidateAvailability = catalogEntry?.candidate_availability ?? subject?.candidate_availability;
  const isPaused = candidateAvailability === "paused";
  const selectedModuleName = getModuleDisplayName(
    subjects.find((item) => item.slug === freeModuleSlug)?.name ?? "",
  );
  const liveRows = rows.filter(isPublishedBatchRow);
  const isComingSoon = isCandidateModuleComingSoon(subject, liveRows.length);
  const latestAttemptByBatch = useMemo(() => {
    const map = new Map();

    attempts.forEach((attempt) => {
      const slug = attempt?.subjects?.slug;
      if (!slug || slug !== subjectSlug) return;

      const key = `${slug}:${Number(attempt.batch_number ?? 1)}`;
      if (!map.has(key)) {
        map.set(key, attempt);
      }
    });

    return map;
  }, [attempts, subjectSlug]);
  const progression = getProgressionRecommendation(
    isComingSoon ? [] : rows,
    { isPaidUser: hasModuleAccess },
  );

  const passedCount = liveRows.filter((row) => row.state === "completed_passed").length;
  const progressPercent = liveRows.length > 0 ? Math.round((passedCount / liveRows.length) * 100) : 0;

  function getBatchPrimaryAction(row) {
    const batchNumber = Number(row?.batch_number ?? 1);
    const purchaseUnavailable = isModulePurchaseUnavailable({ hasModuleAccess, canPurchase, rows });

    if (isPaused) {
      return { label: "Temporarily paused", disabled: true };
    }

    if (isComingSoon || !row || row.state === "unavailable_not_published" || Number(row.published_question_count ?? 0) === 0) {
      return { label: "Coming soon", disabled: true };
    }

    if (purchaseUnavailable) {
      return { label: "Not currently for sale", disabled: true };
    }

    if (row.state === "locked_requires_payment" || !row.can_start) {
      return { label: "Unlock module", to: `/access?module=${encodeURIComponent(subjectSlug)}` };
    }

    if (!hasModuleAccess && !hasSelectedFreeModule && batchNumber === 1 && row.reason_code === "free_batch_available") {
      return {
        label: "Start practice",
        action: () => {
          if (!subject) return;
          setCtaError("");
          setStartConfirmSubject(subject);
        },
      };
    }

    if (row.state === "completed_failed") {
      if (hasModuleAccess) {
        const guidance = getBatchProgressionGuidance(row, progression, { isPaidUser: hasModuleAccess });

        if (guidance.isSkipAhead) {
          return {
            label: "Retry",
            action: () => {
              setSkipAheadConfirm({
                batchNumber,
                recommendedBatchNumber: progression.recommendedBatchNumber,
              });
            },
          };
        }
      }

      return { label: "Retry", to: getPracticeRoute(subject, batchNumber) };
    }

    if (row.state === "completed_passed") {
      if (hasModuleAccess) {
        const guidance = getBatchProgressionGuidance(row, progression, { isPaidUser: hasModuleAccess });

        if (guidance.isSkipAhead) {
          return {
            label: "Practice again",
            action: () => {
              setSkipAheadConfirm({
                batchNumber,
                recommendedBatchNumber: progression.recommendedBatchNumber,
              });
            },
          };
        }

        return { label: "Practice again", to: getPracticeRoute(subject, batchNumber) };
      }

      return { label: "Unlock module", to: `/access?module=${encodeURIComponent(subjectSlug)}` };
    }

    if (Number(row.attempt_count ?? 0) > 0) {
      if (hasModuleAccess) {
        const guidance = getBatchProgressionGuidance(row, progression, { isPaidUser: hasModuleAccess });

        if (guidance.isSkipAhead) {
          return {
            label: "Continue",
            action: () => {
              setSkipAheadConfirm({
                batchNumber,
                recommendedBatchNumber: progression.recommendedBatchNumber,
              });
            },
          };
        }
      }

      return { label: "Continue", to: getPracticeRoute(subject, batchNumber) };
    }

    if (hasModuleAccess) {
      const guidance = getBatchProgressionGuidance(row, progression, { isPaidUser: hasModuleAccess });

      if (guidance.isSkipAhead) {
        return {
          label: "Start",
          action: () => {
            setSkipAheadConfirm({
              batchNumber,
              recommendedBatchNumber: progression.recommendedBatchNumber,
            });
          },
        };
      }
    }

    return { label: "Start", to: getPracticeRoute(subject, batchNumber) };
  }

  function getBatchSecondaryAction(row) {
    if (isComingSoon || !row || Number(row.attempt_count ?? 0) <= 0) return null;

    const batchNumber = Number(row.batch_number ?? 1);
    if (subject?.practice_type === "oral" && row.latest_completed_attempt_id) {
      return {
        label: "Review",
        to: `/oral-review?attempt=${row.latest_completed_attempt_id}`,
      };
    }

    const latestAttemptForBatch = latestAttemptByBatch.get(`${subjectSlug}:${batchNumber}`) ?? null;

    if (!latestAttemptForBatch) return null;

    return {
      label: "Review",
      to: `/review?attempt=${latestAttemptForBatch.id}`,
    };
  }

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
      navigate(`/practice/${startConfirmSubject.slug}?batch=1`, {
        state: { batchStarted: true },
      });
    } catch (error) {
      logAppError(`Module detail start practice:${startConfirmSubject.slug}`, error);
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

  if (!subject) {
    return (
      <AppFrame>
        <section className="dashboard-section-block">
          <article className="dashboard-panel-card module-detail-empty">
            <h1>Module not found</h1>
            <p className="support-copy">We could not find that module.</p>
            <Link className="ghost-button" to="/dashboard#modules">
              Back to modules
            </Link>
          </article>
        </section>
      </AppFrame>
    );
  }

  const rowsToShow = isComingSoon
    ? [{ batch_number: 1, state: "unavailable_not_published", reason_code: "no_questions" }]
    : rows.length > 0
    ? rows
    : [{ batch_number: 1, state: "unavailable_not_published", reason_code: "no_questions" }];
  const recommendedBatchNumber = progression?.hasOpenRecommendation
    ? Number(progression.recommendedBatchNumber ?? 0)
    : 0;
  const recommendedRow = recommendedBatchNumber
    ? rowsToShow.find((row) => Number(row.batch_number ?? 1) === recommendedBatchNumber) ?? null
    : null;
  const orderedRows = recommendedRow
    ? [
        recommendedRow,
        ...rowsToShow.filter((row) => Number(row.batch_number ?? 1) !== recommendedBatchNumber),
      ]
    : rowsToShow;

  function renderPracticeSetRow(row) {
    const primaryAction = getBatchPrimaryAction(row);
    const secondaryAction = getBatchSecondaryAction(row);
    const guidance = getBatchProgressionGuidance(row, progression, { isPaidUser: hasModuleAccess });
    const supportCopy = guidance.isSkipAhead
      ? ""
      : getLockReason(row, selectedModuleName);
    const attemptCount = Number(row.attempt_count ?? 0);
    const isRecommended = recommendedBatchNumber
      && Number(row.batch_number ?? 1) === recommendedBatchNumber;
    let stateLabel = "";
    let stateTone = "muted";

    if (isRecommended) {
      stateLabel = "Recommended";
      stateTone = "recommended";
    } else if (row.state === "completed_passed") {
      stateLabel = "Passed";
      stateTone = "passed";
    } else if (row.state === "completed_failed") {
      stateLabel = "Retry";
      stateTone = "failed";
    } else if (row.state === "unavailable_not_published") {
      stateLabel = "Coming soon";
      stateTone = "soon";
    } else if (row.state === "locked_requires_payment" || !row.can_start) {
      stateLabel = "Locked";
      stateTone = "locked";
    } else if (attemptCount > 0) {
      stateLabel = "In progress";
      stateTone = "available";
    }

    const scoreCopy = attemptCount > 0 && row.last_score !== null && row.last_score !== undefined
      ? `Last score: ${row.last_score}%`
      : null;

    return (
      <article
        className={`practice-set-choice ${isRecommended ? "is-recommended" : ""}`}
        key={`${subject.slug}-${row.batch_number ?? 1}`}
      >
        <div className="practice-set-choice-copy">
          <div className="practice-set-choice-title">
            <h3>{`Practice set ${row.batch_number ?? 1}`}</h3>
            {stateLabel && <span className={`batch-status-badge is-${stateTone}`}>{stateLabel}</span>}
          </div>
          {scoreCopy && <p className="practice-set-choice-score">{scoreCopy}</p>}
          {supportCopy && <p className="practice-set-choice-note">{supportCopy}</p>}
        </div>

        <div className="practice-set-choice-actions">
          <DashboardActionButton action={primaryAction} />
          <DashboardActionButton action={secondaryAction} className="ghost-button dashboard-soft-button" />
        </div>
      </article>
    );
  }

  return (
    <AppFrame>
      <section className="dashboard-hub dashboard-hub-compact module-detail-page">
        <div className="module-chooser-shell">
          <header className="module-chooser-header">
            <Link className="module-detail-back" to="/dashboard#modules">
              <span aria-hidden="true">&larr;</span> Back to modules
            </Link>

            <div className="module-chooser-heading">
            <div className="module-detail-copy">
              <h1 className="module-detail-title">
                {isPaused ? "Practice is temporarily paused" : isComingSoon ? "Practice is coming soon" : getModuleDisplayName(subject.name)}
              </h1>
              {isPaused && <p>Your access and previous results are safe while new attempts are paused.</p>}
            </div>

            {!isComingSoon && liveRows.length > 0 && (
              <div className="module-chooser-progress">
                <div className="module-progress-summary-copy">
                  <span>Module progress</span>
                  <strong>{`${passedCount} of ${liveRows.length} passed`}</strong>
                </div>
                <AnimatedProgressBar value={progressPercent} />
              </div>
            )}
            </div>
          </header>

          {ctaError && <p className="action-error" role="alert">{ctaError}</p>}
          {moduleNotice && <p className="support-copy">{moduleNotice}</p>}

          {orderedRows.length > 0 && (
            <section className="module-set-section" aria-label="Practice sets">
              <div className="practice-set-choice-list">
                {orderedRows.map((row) => renderPracticeSetRow(row))}
              </div>
            </section>
          )}
        </div>
      </section>

      <FreeBatchConfirmationModal
        loading={startingBatch}
        onCancel={() => setStartConfirmSubject(null)}
        onConfirm={() => void confirmStartFreeBatch()}
        subject={startConfirmSubject}
      />
      <SkipAheadConfirmationModal
        batchNumber={skipAheadConfirm?.batchNumber}
        recommendedBatchNumber={skipAheadConfirm?.recommendedBatchNumber}
        onClose={() => setSkipAheadConfirm(null)}
        onContinue={() => {
          if (!skipAheadConfirm?.batchNumber) return;
          navigate(getPracticeRoute(subject, skipAheadConfirm.batchNumber));
          setSkipAheadConfirm(null);
        }}
        onGoRecommended={() => {
          if (!skipAheadConfirm?.recommendedBatchNumber) return;
          navigate(getPracticeRoute(subject, skipAheadConfirm.recommendedBatchNumber));
          setSkipAheadConfirm(null);
        }}
      />
    </AppFrame>
  );
}
