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

  return (
    <AppFrame>
      <section className="dashboard-hub dashboard-hub-compact module-detail-page">
        <section className="dashboard-section-block">
          <article className="dashboard-panel-card module-detail-hero module-chooser-hero">
            <div className="module-detail-copy">
              <p className="dashboard-section-kicker">{getModuleDisplayName(subject.name)}</p>
              <h1 className="module-detail-title">
                {isPaused ? "Practice is temporarily paused" : isComingSoon ? "Practice is coming soon" : "Choose a practice set"}
              </h1>
              {isPaused && <p>Your access and previous results are safe while new attempts are paused.</p>}
            </div>

            {!isComingSoon && liveRows.length > 0 && (
              <div className="module-progress-summary module-progress-summary-detail">
                <div className="module-progress-summary-copy">
                  <span>Module progress</span>
                  <strong>{`${passedCount} of ${liveRows.length} practice sets completed`}</strong>
                </div>
                <AnimatedProgressBar value={progressPercent} />
              </div>
            )}

            {ctaError && <p className="action-error" role="alert">{ctaError}</p>}
            {moduleNotice && <p className="support-copy">{moduleNotice}</p>}
          </article>
        </section>

        <section className="dashboard-section-block">
          <article className="dashboard-panel-card module-detail-batches-card">
            <div className="module-preview-panel module-preview-panel-detail">
              {rowsToShow.map((row) => {
                const primaryAction = getBatchPrimaryAction(row);
                const secondaryAction = getBatchSecondaryAction(row);
                const guidance = getBatchProgressionGuidance(row, progression, { isPaidUser: hasModuleAccess });
                const supportCopy = guidance.note || getLockReason(row, selectedModuleName);
                const attemptCount = Number(row.attempt_count ?? 0);
                let stateLabel = null;
                let stateTone = "muted";

                if (guidance.isRecommended) {
                  stateLabel = "Next for you";
                  stateTone = "recommended";
                } else if (row.state === "completed_passed") {
                  stateLabel = "Completed";
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
                }

                const scoreCopy = attemptCount > 0 && row.last_score !== null && row.last_score !== undefined
                  ? `Last score ${row.last_score}%`
                  : null;

                return (
                  <article
                    className={`module-preview-row practice-set-row ${guidance.isRecommended ? "is-recommended" : ""} ${guidance.isSkipAhead ? "is-skip-ahead" : ""}`}
                    key={`${subject.slug}-${row.batch_number ?? 1}`}
                  >
                    <div className="module-preview-copy">
                      <div className="module-preview-top">
                        <strong>{`Practice set ${row.batch_number ?? 1}`}</strong>
                        {stateLabel && <span className={`batch-status-badge is-${stateTone}`}>{stateLabel}</span>}
                      </div>
                      {scoreCopy && <p className="module-preview-meta">{scoreCopy}</p>}
                      {supportCopy && (
                        <p className={`module-preview-note ${guidance.note ? "is-guidance" : ""}`}>{supportCopy}</p>
                      )}
                    </div>

                    <div className="module-preview-actions">
                      <DashboardActionButton action={primaryAction} />
                      <DashboardActionButton action={secondaryAction} className="ghost-button dashboard-soft-button" />
                    </div>
                  </article>
                );
              })}
            </div>
          </article>
        </section>
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
