import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import {
  AnimatedProgressBar,
  DashboardActionButton,
  FreeBatchConfirmationModal,
  ScoreRing,
} from "../components/DashboardUi";
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
import {
  FALLBACK_SUBJECTS,
  buildModuleStatusLine,
  formatAccessDate,
  formatAttemptPercent,
  formatDate,
  formatPercent,
  getFirstName,
  getModuleShortName,
  getModuleStatusTone,
  getSubjectSlugFromPracticeTarget,
} from "../lib/moduleDisplay";
import { storePracticeBatch } from "../lib/practiceSession";
import { useAuth } from "../lib/useAuth";

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
  const subjectsForDisplay = subjects.length > 0 ? subjects : FALLBACK_SUBJECTS;
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

    Object.values(grouped).forEach((rows) => {
      rows.sort((left, right) => Number(left.batch_number ?? 0) - Number(right.batch_number ?? 0));
    });

    return grouped;
  }, [moduleBatchAccess]);
  const latestAttemptBySubject = useMemo(() => {
    const map = new Map();

    attempts.forEach((attempt) => {
      const slug = attempt?.subjects?.slug;
      if (!slug) return;

      if (!map.has(slug)) {
        map.set(slug, attempt);
      }
    });

    return map;
  }, [attempts]);

  const freeModuleSlug = summary?.free_module_subject_slug ?? null;
  const hasSelectedFreeModule = Boolean(freeModuleSlug);
  const isPaidUser = Boolean(summary?.has_paid_access);
  const hasAvailableContent = moduleBatchAccess.some((row) => Number(row.published_question_count ?? 0) > 0);
  const latestAttempt = attempts[0] ?? null;
  const averageScore = attempts.length > 0
    ? Math.round(
        attempts.reduce((sum, attempt) => sum + Number(attempt.score_percent ?? formatAttemptPercent(attempt) ?? 0), 0)
        / attempts.length,
      )
    : null;
  const reviewQueueCount = reviewQueue.length;
  const previewAttempts = attempts.slice(0, 2);
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
    setOnboardingTarget(subjectSlug ? `/practice/${subjectSlug}` : "/dashboard#modules");
    setShowOnboardingModal(true);
  }

  function openOnboardingForDashboard() {
    setOnboardingTarget("/dashboard#modules");
    setShowOnboardingModal(true);
  }

  function getRecommendedBatchRow(subjectSlug) {
    const rows = batchAccessBySubject[subjectSlug] ?? [];

    if (rows.length === 0) return null;

    return (
      rows.find((row) => row.is_recommended) ??
      rows.find((row) => row.can_start) ??
      rows.find((row) => Number(row.published_question_count ?? 0) > 0) ??
      rows[0]
    );
  }

  function getBatchPrimaryAction(subject, row) {
    const batchNumber = Number(row?.batch_number ?? 1);

    if (!profileComplete) {
      return {
        label: "Complete account",
        action: () => openOnboardingForPractice(subject.slug),
      };
    }

    if (!row || row.state === "unavailable_not_published" || Number(row.published_question_count ?? 0) === 0) {
      return { label: "Coming soon", disabled: true };
    }

    if (row.state === "locked_requires_payment" || !row.can_start) {
      return { label: "Unlock Full Access", to: "/access" };
    }

    if (!isPaidUser && !hasSelectedFreeModule && batchNumber === 1 && row.reason_code === "free_batch_available") {
      return {
        label: "Start free batch",
        action: () => {
          setCtaError("");
          setStartConfirmSubject(subject);
        },
      };
    }

    if (row.state === "completed_failed") {
      return { label: `Retry Batch ${batchNumber}`, to: `/practice/${subject.slug}?batch=${batchNumber}` };
    }

    if (row.state === "completed_passed") {
      return isPaidUser
        ? { label: `Retry Batch ${batchNumber}`, to: `/practice/${subject.slug}?batch=${batchNumber}` }
        : { label: "Unlock Full Access", to: "/access" };
    }

    if (Number(row.attempt_count ?? 0) > 0) {
      return { label: `Continue Batch ${batchNumber}`, to: `/practice/${subject.slug}?batch=${batchNumber}` };
    }

    return { label: `Start Batch ${batchNumber}`, to: `/practice/${subject.slug}?batch=${batchNumber}` };
  }

  const moduleCards = subjectsForDisplay.map((subject) => {
      const subjectProgress = progressBySubject[subject.id] ?? null;
      const rows = batchAccessBySubject[subject.slug] ?? [];
      const liveRows = rows.filter((row) => Number(row.published_question_count ?? 0) > 0);
      const comingSoonRows = rows.filter((row) => row.state === "unavailable_not_published");
      const batchOneRow = rows.find((row) => Number(row.batch_number ?? 0) === 1) ?? null;
      const recommendedRow = getRecommendedBatchRow(subject.slug);
      const latestSubjectAttempt = latestAttemptBySubject.get(subject.slug) ?? null;
      const attemptTotal = rows.reduce((sum, row) => sum + Number(row.attempt_count ?? 0), 0);
      const bestScoreValue = rows.reduce((best, row) => {
        const value = Number(row.best_score ?? 0);
        return value > best ? value : best;
      }, 0);
      const latestScoreValue = Number(subjectProgress?.last_score_percent ?? 0) || null;
      const passedCount = liveRows.filter((row) => row.state === "completed_passed").length;
      const progressPercent = liveRows.length > 0 ? Math.round((passedCount / liveRows.length) * 100) : 0;
      const statusLine = buildModuleStatusLine(subject.slug, liveRows.length, comingSoonRows.length);
      const statusTone = getModuleStatusTone(subject.slug, liveRows.length, comingSoonRows.length);
      const isCurrentAffairs = subject.slug === "current-affairs";
      const isSelectedFreeModule = hasSelectedFreeModule && freeModuleSlug === subject.slug;

      let emphasisText = "Not attempted yet";

      if (bestScoreValue > 0) {
        emphasisText = `Best score ${formatPercent(bestScoreValue)}`;
      } else if (latestScoreValue !== null) {
        emphasisText = `Latest score ${formatPercent(latestScoreValue)}`;
      } else if (liveRows.length > 0 && passedCount > 0) {
        emphasisText = `${passedCount} of ${liveRows.length} live batches passed`;
      } else if (isCurrentAffairs) {
        emphasisText = "Fact-check hold";
      }

      let supportText = null;

      if (!isPaidUser && isSelectedFreeModule) {
        supportText = "Selected free module";
      } else if (!isPaidUser && hasSelectedFreeModule && liveRows.length > 0) {
        supportText = "Full access required";
      } else if (latestSubjectAttempt) {
        supportText = `Last attempt ${formatDate(latestSubjectAttempt.completed_at ?? latestSubjectAttempt.started_at)}`;
      }

      let primaryAction;

      if (!profileComplete) {
        primaryAction = {
          label: "Complete account",
          action: openOnboardingForDashboard,
        };
      } else if (isCurrentAffairs || (rows.length === 0 && subject.slug !== "public-service-rules" && subject.slug !== "public-financial-management")) {
        primaryAction = { label: "Coming soon", disabled: true };
      } else if (isPaidUser) {
        primaryAction = {
          label: "View batches",
          to: `/modules/${subject.slug}`,
        };
      } else if (!hasSelectedFreeModule) {
        if (batchOneRow?.reason_code === "free_batch_available") {
          primaryAction = {
            label: "Choose this module",
            action: () => {
              setCtaError("");
              setStartConfirmSubject(subject);
            },
          };
        } else if (liveRows.length > 0) {
          primaryAction = {
            label: "View batches",
            to: `/modules/${subject.slug}`,
          };
        } else {
          primaryAction = { label: "Coming soon", disabled: true };
        }
      } else if (isSelectedFreeModule) {
        primaryAction = getBatchPrimaryAction(subject, batchOneRow ?? recommendedRow);
      } else if (liveRows.length > 0) {
        primaryAction = { label: "Unlock Full Access", to: "/access" };
      } else {
        primaryAction = { label: "Coming soon", disabled: true };
      }

      return {
        subject,
        rows,
        batchOneRow,
        latestSubjectAttempt,
        attemptTotal,
        bestScoreValue: bestScoreValue > 0 ? bestScoreValue : null,
        progressPercent,
        statusLine,
        statusTone,
        emphasisText,
        supportText,
        primaryAction,
        selectedModuleName: freeModuleSlug === subject.slug ? subject.name : null,
      };
    });

  const selectedModuleCard = moduleCards.find((card) => card.subject.slug === freeModuleSlug) ?? null;

  const accessCard = (() => {
    if (!profileComplete) {
      return {
        title: isPaidUser ? "Full access" : "Free access",
        body: "Complete your account",
        detail: null,
        action: {
          label: "Complete account",
          action: openOnboardingForDashboard,
        },
      };
    }

    if (isPaidUser) {
      return {
        title: "Full access",
        body: "Published batches available",
        detail: summary?.access_expires_at ? `Access through ${formatAccessDate(summary.access_expires_at)}` : null,
        action: null,
      };
    }

    if (!hasSelectedFreeModule) {
      return {
        title: "Free access",
        body: "One free Batch 1 available",
        detail: "Choose a module to begin.",
        action: {
          label: "View modules",
          to: "/dashboard#modules",
        },
      };
    }

    const selectedModuleName = selectedModuleCard?.subject.name ?? "your selected module";
    const selectedRow = selectedModuleCard?.batchOneRow ?? null;

    if (selectedRow?.state === "completed_passed") {
      return {
        title: "Free access",
        body: "Free Batch 1 complete",
        detail: `Unlock more batches beyond ${selectedModuleName}.`,
        action: {
          label: "Unlock Full Access",
          to: "/access",
        },
      };
    }

    if (selectedRow?.state === "completed_failed" && selectedRow.reason_code === "free_retry_available") {
      return {
        title: "Free access",
        body: "One retry available",
        detail: `${selectedModuleName} Batch 1 is ready again.`,
        action: getBatchPrimaryAction(selectedModuleCard.subject, selectedRow),
      };
    }

    if (selectedRow?.state === "completed_failed") {
      return {
        title: "Free access",
        body: "Free attempts complete",
        detail: `Unlock more batches beyond ${selectedModuleName}.`,
        action: {
          label: "Unlock Full Access",
          to: "/access",
        },
      };
    }

    if (selectedRow?.state === "locked_requires_payment") {
      return {
        title: "Free access",
        body: "Free Batch 1 used",
        detail: `Unlock access to continue beyond ${selectedModuleName}.`,
        action: {
          label: "Unlock Full Access",
          to: "/access",
        },
      };
    }

    return {
      title: "Free access",
      body: `${selectedModuleName} ready`,
      detail: "Batch 1 is available now.",
      action: selectedModuleCard
        ? getBatchPrimaryAction(selectedModuleCard.subject, selectedRow)
        : {
            label: "View modules",
            to: "/dashboard#modules",
          },
    };
  })();

  const heroStatusLine = (() => {
    if (!profileComplete) {
      return "Complete your account to start practice.";
    }

    if (isPaidUser) {
      return "Continue from your latest progress.";
    }

    if (!isPaidUser && !hasSelectedFreeModule) {
      return "Choose one module and start Batch 1 for free.";
    }

    if (!isPaidUser && hasSelectedFreeModule) {
      return "Your free batch path is ready below.";
    }

    return "";
  })();
  const heroGreetingLabel = "Welcome";
  const totalAttempts = attempts.length;
  const averageScoreRounded = averageScore !== null ? Math.round(averageScore) : 0;

  const recommendedAction = (() => {
    if (!profileComplete) {
      return {
        label: "Recommended next step",
        title: "Complete your account",
        body: "Add the details we need before you begin Batch 1 or open protected sections.",
        primaryAction: {
          label: "Complete account",
          action: openOnboardingForDashboard,
        },
        secondaryAction: null,
        preview: null,
      };
    }

    if (!hasAvailableContent) {
      return {
        label: "Recommended next step",
        title: "Explore modules",
        body: "Published batches will appear here as soon as they are ready.",
        primaryAction: {
          label: "View modules",
          to: "/dashboard#modules",
        },
        secondaryAction: null,
        preview: null,
      };
    }

    if (!isPaidUser && !hasSelectedFreeModule) {
      return {
        label: "Recommended next step",
        title: "Choose your free module",
        body: "Public Financial Management and Public Service Rules are the current free entry points when published.",
        primaryAction: {
          label: "Choose free module",
          to: "/dashboard#modules",
        },
        secondaryAction: null,
        preview: null,
      };
    }

    if (!isPaidUser && selectedModuleCard) {
      const selectedRow = selectedModuleCard.batchOneRow ?? null;
      const latestSelectedAttempt = selectedModuleCard.latestSubjectAttempt ?? null;

      if (selectedRow?.state === "available") {
        return {
          label: "Recommended next step",
          title: "Start your free batch",
          body: `Your free module is ${selectedModuleCard.subject.name}. Start when you are ready.`,
          primaryAction: getBatchPrimaryAction(selectedModuleCard.subject, selectedRow),
          secondaryAction: null,
          preview: `${getModuleShortName(selectedModuleCard.subject.slug, selectedModuleCard.subject.name)} Batch 1`,
        };
    }

      if (selectedRow?.state === "completed_failed" && selectedRow.reason_code === "free_retry_available") {
        return {
          label: "Recommended next step",
          title: "Retry your free batch",
          body: "You have one retry available.",
          primaryAction: getBatchPrimaryAction(selectedModuleCard.subject, selectedRow),
          secondaryAction: latestSelectedAttempt
            ? { label: "Review latest attempt", to: `/review?attempt=${latestSelectedAttempt.id}` }
            : null,
          preview: `${getModuleShortName(selectedModuleCard.subject.slug, selectedModuleCard.subject.name)} Batch 1`,
        };
      }

      if (selectedRow?.state === "completed_passed" || selectedRow?.state === "completed_failed") {
        return {
          label: "Recommended next step",
          title: "Unlock Full Access",
          body: "Your free path is complete. Unlock to continue.",
          primaryAction: { label: "Unlock Full Access", to: "/access" },
          secondaryAction: latestSelectedAttempt
            ? { label: "Review latest attempt", to: `/review?attempt=${latestSelectedAttempt.id}` }
            : null,
          preview: `${getModuleShortName(selectedModuleCard.subject.slug, selectedModuleCard.subject.name)} Batch 1`,
        };
      }
    }

    const paidRecommendedModule = moduleCards.find((card) => {
      const row = getRecommendedBatchRow(card.subject.slug);
      return Boolean(row?.can_start && Number(row.published_question_count ?? 0) > 0);
    });
    const paidRecommendedRow = paidRecommendedModule
      ? getRecommendedBatchRow(paidRecommendedModule.subject.slug)
      : null;

    if (isPaidUser && paidRecommendedModule && paidRecommendedRow) {
      const batchNumber = Number(paidRecommendedRow.batch_number ?? 1);
      const shortName = getModuleShortName(
        paidRecommendedModule.subject.slug,
        paidRecommendedModule.subject.name,
      );

      return {
        label: "Recommended next step",
        title: paidRecommendedRow.attempt_count > 0
          ? paidRecommendedModule.subject.name
          : paidRecommendedModule.subject.name,
        body: paidRecommendedRow.attempt_count > 0
          ? "Best next step based on your recent progress."
          : null,
        primaryAction: getBatchPrimaryAction(paidRecommendedModule.subject, paidRecommendedRow),
        secondaryAction: latestAttempt
          ? { label: "Review latest attempt", to: `/review?attempt=${latestAttempt.id}` }
          : null,
        preview: `${shortName} Batch ${batchNumber}`,
      };
    }

    if (latestAttempt) {
      return {
        label: "Recommended next step",
        title: "Review latest attempt",
        body: "Open your most recent submitted batch and decide what to do next from there.",
        primaryAction: { label: "Review latest attempt", to: `/review?attempt=${latestAttempt.id}` },
        secondaryAction: {
          label: "View modules",
          to: "/dashboard#modules",
        },
        preview: null,
      };
    }

    return {
      label: "Recommended next step",
      title: "Explore modules",
      body: "Open the module list to start with any currently published batch you can access.",
      primaryAction: { label: "View modules", to: "/dashboard#modules" },
      secondaryAction: null,
      preview: null,
    };
  })();

  const recommendedSummary = (() => {
    if (!profileComplete) {
      return {
        title: "Complete your account",
        meta: "Required before you can start practice.",
        action: recommendedAction.primaryAction,
      };
    }

    if (!hasAvailableContent) {
      return {
        title: "Modules coming soon",
        meta: "Published batches will appear here when ready.",
        action: recommendedAction.primaryAction,
      };
    }

    if (!isPaidUser && !hasSelectedFreeModule) {
      return {
        title: "Choose your free module",
        meta: "Start Batch 1 in one module for free.",
        action: recommendedAction.primaryAction,
      };
    }

    if (!isPaidUser && selectedModuleCard) {
      const selectedRow = selectedModuleCard.batchOneRow ?? null;
      const selectedTitle = selectedModuleCard.subject.name;

      if (selectedRow?.state === "available") {
        return {
          title: selectedTitle,
          meta: "Free entry batch available now.",
          action: recommendedAction.primaryAction,
        };
      }

      if (selectedRow?.state === "completed_failed" && selectedRow.reason_code === "free_retry_available") {
        return {
          title: selectedTitle,
          meta: "One retry is available.",
          action: recommendedAction.primaryAction,
        };
      }

      if (selectedRow?.state === "completed_passed" || selectedRow?.state === "completed_failed") {
        return {
          title: "Unlock Full Access",
          meta: `${selectedModuleCard.subject.name} Batch 1 is complete.`,
          action: recommendedAction.primaryAction,
        };
      }
    }

    const paidRecommendedModule = moduleCards.find((card) => {
      const row = getRecommendedBatchRow(card.subject.slug);
      return Boolean(row?.can_start && Number(row.published_question_count ?? 0) > 0);
    });
    const paidRecommendedRow = paidRecommendedModule
      ? getRecommendedBatchRow(paidRecommendedModule.subject.slug)
      : null;

    if (isPaidUser && paidRecommendedModule && paidRecommendedRow) {
      const bestScore = paidRecommendedRow.best_score ?? paidRecommendedRow.last_score ?? null;

      return {
        title: paidRecommendedModule.subject.name,
        meta: bestScore !== null && bestScore !== undefined
          ? `Best score: ${bestScore}%`
          : "Ready to continue.",
        action: recommendedAction.primaryAction,
      };
    }

    if (latestAttempt) {
      return {
        title: "Review latest attempt",
        meta: "Open your most recent submitted batch.",
        action: recommendedAction.primaryAction,
      };
    }

    return {
      title: recommendedAction.title,
      meta: recommendedAction.body ?? "",
      action: recommendedAction.primaryAction,
    };
  })();

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
      <section className="dashboard-hub dashboard-hub-compact">
        <section className="dashboard-hero-grid dashboard-hero-grid-compact">
          <section className="dashboard-hero-copy dashboard-hero-copy-compact">
            <div className="dashboard-welcome-panel">
              <div className="dashboard-welcome-copy dashboard-welcome-copy-intro">
                {firstName ? <p className="dashboard-welcome-kicker">{heroGreetingLabel}</p> : null}
                <h1>{firstName || "Welcome"}</h1>
                <div className="dashboard-welcome-meta dashboard-welcome-meta-under">
                  <span className={`dashboard-access-chip ${isPaidUser ? "is-full" : "is-free"}`}>
                    {accessCard.title}
                  </span>
                </div>
                {heroStatusLine ? <p className="dashboard-welcome-status">{heroStatusLine}</p> : null}
              </div>

              <div className="dashboard-hero-summary-panel">
                <div className="dashboard-hero-summary-metric">
                  <ScoreRing
                    value={averageScoreRounded}
                    label="Average score"
                    sublabel={totalAttempts > 0 ? `${totalAttempts} attempt${totalAttempts === 1 ? "" : "s"}` : "No attempts yet"}
                    className="dashboard-hero-ring"
                  />
                </div>

                <div className="dashboard-hero-summary-copy">
                  <p className="dashboard-hero-summary-title">{accessCard.body}</p>
                  {accessCard.detail ? <p className="dashboard-hero-summary-detail">{accessCard.detail}</p> : null}
                </div>
              </div>
            </div>
            {ctaError && <p className="notice error">{ctaError}</p>}
          </section>

          <aside className="dashboard-summary-stack dashboard-summary-stack-compact">
            <article className="dashboard-summary-card dashboard-next-card dashboard-next-card-v4">
              <div className="dashboard-next-header">
                <span className="dashboard-recommended-pill">Recommended</span>
              </div>
              <div className="dashboard-next-body">
                <h2>{recommendedSummary.title}</h2>
              </div>
              <div className="dashboard-action-row dashboard-action-row-compact">
                <DashboardActionButton action={recommendedSummary.action} />
                <DashboardActionButton action={recommendedAction.secondaryAction} className="ghost-button dashboard-soft-button" />
              </div>
            </article>
          </aside>
        </section>

        <section className="dashboard-section-block" id="modules">
          <div className="dashboard-section-heading">
            <div className="dashboard-section-heading-copy">
              <p className="dashboard-section-kicker">Study areas</p>
              <h2>Modules</h2>
            </div>
            {subjectsNotice && <p className="section-note">{subjectsNotice}</p>}
          </div>

          <div className="dashboard-module-grid-v3">
            {moduleCards.map((card) => {
              return (
                <article className="module-card-v3" key={card.subject.id}>
                  <div className="module-card-v3-head">
                    <div className="module-card-v3-copy">
                      <h3>{card.subject.name}</h3>
                      <p className="module-card-description">{card.subject.description}</p>
                    </div>
                  </div>

                  <div className="module-card-status-row">
                    <span className={`module-status-pill is-${card.statusTone}`}>{card.statusLine}</span>
                    <span className="module-status-copy">{card.emphasisText}</span>
                    {card.supportText && <span className="module-status-copy">{card.supportText}</span>}
                  </div>

                  {card.progressPercent > 0 && (
                    <div className="module-inline-progress module-inline-progress-plain">
                      <span className="module-inline-progress-label">
                        {`${card.progressPercent}% complete`}
                      </span>
                      <AnimatedProgressBar value={card.progressPercent} />
                    </div>
                  )}

                  <div className="module-card-actions module-card-actions-compact">
                    <DashboardActionButton action={card.primaryAction} className="dashboard-module-toggle" />
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="dashboard-section-block">
          <div className="dashboard-section-heading">
            <div className="dashboard-section-heading-copy">
              <p className="dashboard-section-kicker">Submitted tests</p>
              <h2>Recent attempts</h2>
            </div>
          </div>

          <article className="dashboard-panel-card recent-attempts-card">
            {attemptsNotice ? (
              <p className="support-copy">{attemptsNotice}</p>
            ) : previewAttempts.length === 0 ? (
              <div className="dashboard-empty-card">
                <p>Submit a practice batch to see your review history.</p>
                <Link className="secondary-action" to="/dashboard#modules">
                  View modules
                </Link>
              </div>
            ) : (
              <div className="recent-attempts-list">
                {previewAttempts.map((attempt) => {
                  const attemptScore = formatPercent(attempt.score_percent ?? formatAttemptPercent(attempt));

                  return (
                    <article className="recent-attempt-row" key={attempt.id}>
                      <div className="recent-attempt-copy">
                        <strong>{`${attempt.subjects?.name ?? "Module"} - Batch ${attempt.batch_number ?? 1}`}</strong>
                        <p>
                          {[
                            attemptScore ?? "Score unavailable",
                            attempt.passed ? "Passed" : "Failed",
                            formatDate(attempt.completed_at ?? attempt.started_at),
                          ].join(" - ")}
                        </p>
                      </div>
                      <Link className="ghost-button" to={`/review?attempt=${attempt.id}`}>
                        Review
                      </Link>
                    </article>
                  );
                })}
              </div>
            )}

            <div className="dashboard-review-handoff">
              {previewAttempts.length > 0 && (
                <Link className="text-link dashboard-inline-link" to={latestAttempt ? `/review?attempt=${latestAttempt.id}` : "/review"}>
                  View all reviews
                </Link>
              )}
              {!reviewNotice && reviewQueueCount > 0 && (
                <p>{`${reviewQueueCount} review item${reviewQueueCount === 1 ? "" : "s"} waiting in Review.`}</p>
              )}
              {reviewNotice && <p>{reviewNotice}</p>}
            </div>
          </article>
        </section>
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
