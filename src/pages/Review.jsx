import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import { getAttemptReview, getQueueAttemptMatches, getRecentAttempts, getReviewQueue } from "../lib/appApi";
import { friendlyErrorMessage, isExpectedAbortError, logAppError } from "../lib/errors";
import { getModuleDisplayName } from "../lib/moduleDisplay";
import { getSafeReturnTo } from "../lib/navigation";

const HISTORY_FILTERS = [
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
  { value: "recent", label: "Recent" },
];

function getPercent(score, total) {
  if (!total) return 0;
  return Math.round((Number(score) / Number(total)) * 100);
}

function formatDate(value, options = { month: "short", day: "numeric", year: "numeric" }) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, options);
}

function getAttemptLabel(retryNumber) {
  const safeRetry = Math.max(0, Number(retryNumber ?? 0));
  return `Attempt ${safeRetry + 1}`;
}

function getModuleShortLabel(name) {
  const compact = getModuleDisplayName(name);
  return compact.length > 28 ? compact.slice(0, 28).trimEnd() : compact;
}

function getQuestionState(row) {
  if (row?.is_correct) return "correct";
  if (!row?.selected_option) return "unanswered";
  return "wrong";
}

function getAnswerText(row, optionKey) {
  if (!optionKey) return "";
  return row?.[`option_${String(optionKey).toLowerCase()}`] ?? "";
}

function getDisplayedOptionLabel(row, optionKey) {
  if (!optionKey) return "";

  const optionOrder = Array.isArray(row?.option_order)
    ? row.option_order.map((value) => String(value).toUpperCase())
    : ["A", "B", "C", "D"];
  const displayIndex = optionOrder.indexOf(String(optionKey).toUpperCase());

  return displayIndex >= 0 ? ["A", "B", "C", "D"][displayIndex] : String(optionKey).toUpperCase();
}

function getAttemptCounts(rows, totalQuestions = 0) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const safeTotal = Math.max(Number(totalQuestions ?? safeRows.length ?? 0), safeRows.length);
  const correctCount = safeRows.reduce((sum, row) => sum + (row?.is_correct ? 1 : 0), 0);
  const answeredCount = safeRows.reduce((sum, row) => sum + (row?.selected_option ? 1 : 0), 0);
  const unansweredCount = Math.max(safeTotal - answeredCount, 0);
  const wrongCount = Math.max(answeredCount - correctCount, 0);

  return {
    totalQuestions: safeTotal,
    correctCount,
    wrongCount,
    unansweredCount,
  };
}

function buildAttemptSummaryFromRows(rows, fallbackSummary = null) {
  if ((!Array.isArray(rows) || rows.length === 0) && !fallbackSummary) {
    return null;
  }

  const first = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  const totalQuestions = Number(first?.total_questions ?? fallbackSummary?.totalQuestions ?? rows?.length ?? 0);
  const counts = getAttemptCounts(rows, totalQuestions);
  const score = Number(first?.score ?? fallbackSummary?.score ?? counts.correctCount ?? 0);
  const scorePercent = Number(
    first?.score_percent
      ?? fallbackSummary?.scorePercent
      ?? getPercent(score, counts.totalQuestions),
  );
  const retryNumber = Number(first?.retry_number ?? fallbackSummary?.retryNumber ?? 0);

  return {
    attemptId: first?.attempt_id ?? fallbackSummary?.attemptId ?? null,
    completedAt: first?.completed_at ?? fallbackSummary?.completedAt ?? null,
    score,
    totalQuestions: counts.totalQuestions,
    subjectId: first?.subject_id ?? fallbackSummary?.subjectId ?? null,
    subjectName: getModuleDisplayName(first?.subject_name ?? fallbackSummary?.subjectName ?? "Module batch"),
    subjectSlug: first?.subject_slug ?? fallbackSummary?.subjectSlug ?? null,
    batchNumber: Number(first?.batch_number ?? fallbackSummary?.batchNumber ?? 1),
    scorePercent,
    passed: Boolean(first?.passed ?? fallbackSummary?.passed),
    retryNumber,
    attemptLabel: getAttemptLabel(retryNumber),
    nextAction: first?.next_action ?? fallbackSummary?.nextAction ?? "review_only",
    passMarkPercent: Number(first?.pass_mark_percent ?? fallbackSummary?.passMarkPercent ?? 70),
    nextBatchNumber: Number(first?.next_batch_number ?? fallbackSummary?.nextBatchNumber ?? 0) || null,
    canRetry: Boolean(first?.can_retry ?? fallbackSummary?.canRetry ?? true),
    correctCount: counts.correctCount,
    wrongCount: counts.wrongCount,
    unansweredCount: counts.unansweredCount,
    hasFullCounts: Array.isArray(rows) && rows.length > 0,
  };
}

function buildHistoryAttemptSummary(attempt, reviewRows = []) {
  const fallbackSummary = {
    attemptId: attempt?.id ?? null,
    completedAt: attempt?.completed_at ?? attempt?.started_at ?? null,
    score: Number(attempt?.score ?? 0),
    totalQuestions: Number(attempt?.total_questions ?? 0),
    subjectName: getModuleDisplayName(attempt?.subjects?.name ?? "Module batch"),
    subjectSlug: attempt?.subjects?.slug ?? null,
    batchNumber: Number(attempt?.batch_number ?? 1),
    scorePercent: Number(attempt?.score_percent ?? getPercent(attempt?.score ?? 0, attempt?.total_questions ?? 0)),
    passed: Boolean(attempt?.passed),
    retryNumber: Number(attempt?.retry_number ?? 0),
    nextAction: "review_only",
    passMarkPercent: 70,
    canRetry: true,
  };

  const summary = buildAttemptSummaryFromRows(reviewRows, fallbackSummary);

  if (summary) {
    return summary;
  }

  const totalQuestions = Number(attempt?.total_questions ?? 0);
  const correctCount = Number(attempt?.score ?? 0);

  return {
    ...fallbackSummary,
    correctCount,
    wrongCount: Math.max(totalQuestions - correctCount, 0),
    unansweredCount: 0,
    attemptLabel: getAttemptLabel(attempt?.retry_number ?? 0),
    hasFullCounts: false,
  };
}

function getHistoryFilterCount(items, filterValue) {
  switch (filterValue) {
    case "passed":
      return items.filter((item) => item.passed).length;
    case "failed":
      return items.filter((item) => !item.passed).length;
    case "recent":
      return Math.min(items.length, 3);
    default:
      return items.length;
  }
}

function filterAttemptSummaries(items, filterValue) {
  switch (filterValue) {
    case "passed":
      return items.filter((item) => item.passed);
    case "failed":
      return items.filter((item) => !item.passed);
    case "recent":
      return items.slice(0, 3);
    default:
      return items;
  }
}

function getHistoryContextAction(summary) {
  if (!summary) return null;

  const subjectSlug = summary.subjectSlug ?? null;
  const currentBatchNumber = Number(summary.batchNumber ?? 1);
  const nextBatchNumber = Number(summary.nextBatchNumber ?? 0) || null;

  if (
    (summary.nextAction === "retry_or_next"
      || summary.nextAction === "retry_free_batch"
      || summary.nextAction === "review_only"
      || summary.nextAction === "module_complete")
    && subjectSlug
    && summary.canRetry
  ) {
    return { label: "Retry", to: `/practice/${subjectSlug}?batch=${currentBatchNumber}` };
  }

  if ((summary.nextAction === "next_batch" || summary.nextAction === "retry_or_next") && subjectSlug && nextBatchNumber) {
    return { label: `Start Batch ${nextBatchNumber}`, to: `/practice/${subjectSlug}?batch=${nextBatchNumber}` };
  }

  return null;
}

function buildTrendGeometry(values, { minValue = 0, maxValue = 100 } = {}) {
  if (!Array.isArray(values) || values.length === 0) {
    return {
      points: [],
      linePath: "",
      areaPath: "",
      lastPoint: null,
    };
  }

  const width = 220;
  const height = 88;
  const insetX = 6;
  const insetY = 8;
  const safeValues = values.map((value) => Math.max(0, Math.min(100, Number(value) || 0)));
  const safeMinValue = Math.max(0, Math.min(100, Number(minValue) || 0));
  const safeMaxValue = Math.max(safeMinValue + 1, Math.min(100, Number(maxValue) || 100));
  const range = safeMaxValue - safeMinValue || 1;

  const points = safeValues.map((value, index) => {
    const x = insetX + ((width - insetX * 2) / Math.max(safeValues.length - 1, 1)) * index;
    const y = height - insetY - (((value - safeMinValue) / range) * (height - insetY * 2));
    return { x, y };
  });

  const linePath = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const areaPath = [
    linePath,
    `L ${lastPoint.x} ${height - insetY}`,
    `L ${firstPoint.x} ${height - insetY}`,
    "Z",
  ].join(" ");

  return {
    points,
    linePath,
    areaPath,
    lastPoint,
  };
}

function getPassMarkY(passMark, minValue, maxValue, height = 88, insetY = 8) {
  const safePassMark = Math.max(0, Math.min(100, Number(passMark) || 0));
  const range = maxValue - minValue || 1;
  return height - insetY - (((safePassMark - minValue) / range) * (height - insetY * 2));
}

function averageValues(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  return values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
}

function getTrendDirection(values) {
  if (!Array.isArray(values) || values.length < 3) return "insufficient";

  const ordered = [...values]
    .reverse()
    .map((value) => Math.max(0, Math.min(100, Number(value) || 0)));
  const windowSize = Math.max(2, Math.floor(ordered.length / 2));
  const earlierAverage = averageValues(ordered.slice(0, windowSize));
  const laterAverage = averageValues(ordered.slice(-windowSize));
  const delta = laterAverage - earlierAverage;

  if (delta >= 7) return "rising";
  if (delta <= -7) return "falling";
  return "steady";
}

function getScoreSpread(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const normalized = values.map((value) => Math.max(0, Math.min(100, Number(value) || 0)));
  return Math.max(...normalized) - Math.min(...normalized);
}

function countPassMarkCrossings(values, passMark = 70) {
  if (!Array.isArray(values) || values.length < 2) return 0;

  let crossings = 0;
  for (let index = 1; index < values.length; index += 1) {
    const previousAbove = Number(values[index - 1] || 0) >= passMark;
    const currentAbove = Number(values[index] || 0) >= passMark;
    if (previousAbove !== currentAbove) crossings += 1;
  }

  return crossings;
}

function getPerformanceGuidance({ attemptsCount, passRate, recentScores }) {
  if (!attemptsCount) {
    return "Complete a few more batches and your recent performance will become clearer here.";
  }

  if (attemptsCount < 3) {
    return "A few more attempts will give a clearer view of how your performance is settling.";
  }

  const ordered = [...recentScores]
    .reverse()
    .map((value) => Math.max(0, Math.min(100, Number(value) || 0)));
  const direction = getTrendDirection(recentScores);
  const spread = getScoreSpread(ordered);
  const crossingCount = countPassMarkCrossings(ordered, 70);
  const latestScore = ordered.at(-1) ?? 0;
  const previousScore = ordered.at(-2) ?? latestScore;
  const startScore = ordered[0] ?? 0;
  const lowCount = ordered.filter((value) => value < 70).length;
  const aboveCount = ordered.length - lowCount;
  const stableAbovePass = aboveCount >= Math.ceil(ordered.length * 0.65);
  const mostlyBelowPass = lowCount >= Math.ceil(ordered.length * 0.65);
  const lastTwoAbovePass =
    ordered.length >= 2 && ordered.at(-1) >= 70 && ordered.at(-2) >= 70;
  const recentLift = latestScore - previousScore;
  const overallLift = latestScore - startScore;
  const passRateValue = Number(passRate || 0);

  if (crossingCount >= 3) {
    return "You are showing ability, but the results are not steady yet. Focus on consistency now.";
  }

  if (mostlyBelowPass) {
    if (direction === "rising" && latestScore >= 60) {
      return "You are getting closer to the pass mark. Review the missed questions and keep pushing.";
    }

    if (direction === "falling") {
      return "Your recent performance has dipped. Take time to review before the next batch.";
    }

    if (spread <= 10) {
      return "Your effort is steady, but the scores are still below the pass mark. Tight review should come first.";
    }

    return "Most recent scores are still below the pass mark. Rework the weak areas before moving on.";
  }

  if (lastTwoAbovePass && startScore < 70 && overallLift >= 12) {
    return "You have broken above the pass mark in recent attempts. Keep that momentum.";
  }

  if (stableAbovePass) {
    if (direction === "falling" || recentLift <= -6) {
      return "You are still above the pass mark, but the recent drop needs attention. Review now and protect this level.";
    }

    if (direction === "rising" && latestScore >= 80) {
      return "Your recent performance is strong and improving. Keep that standard.";
    }

    if (spread <= 12 && passRateValue >= 65) {
      return "You are staying above the pass mark with good stability. Keep it consistent.";
    }

    return "You are mostly above the pass mark. Keep the review tight so this level holds.";
  }

  if (latestScore >= 70 && recentLift >= 6) {
    return "You have moved back above the pass mark. Build on that recovery.";
  }

  if (direction === "rising") {
    return "Your performance is improving, but it is not settled yet. Keep reviewing the misses.";
  }

  if (direction === "falling") {
    return "Your recent performance has dipped. Slow down, review carefully, and then go again.";
  }

  return "Your recent performance is mixed right now. Use the review to make the next few attempts steadier.";
}

function buildQueueReviewPreview(queue, orderedAttempts, attemptReviewMap, limit = 3) {
  if (!Array.isArray(queue) || queue.length === 0 || !Array.isArray(orderedAttempts) || !attemptReviewMap) {
    return null;
  }

  for (const attempt of orderedAttempts) {
    const rows = attemptReviewMap[attempt?.attemptId] ?? [];
    if (!Array.isArray(rows) || rows.length === 0) continue;

    const matchingItems = queue.filter((item) =>
      rows.some((row) => String(row?.question_id ?? "") === String(item?.question_id ?? "")),
    );

    if (matchingItems.length === 0) continue;

    const previewItems = matchingItems.slice(0, limit);
    const firstItem = previewItems[0] ?? null;

    if (!firstItem?.question_id) continue;

    return {
      attemptId: attempt.attemptId,
      firstQuestionId: firstItem.question_id,
      items: previewItems,
      questionIds: previewItems.map((item) => String(item.question_id)),
    };
  }

  return null;
}

function ReviewFilterChips({ options, activeValue, onChange, getCount }) {
  return (
    <div className="review-filter-row" role="tablist" aria-label="Review filters">
      {options.map((option) => {
        const isActive = activeValue === option.value;
        const count = typeof getCount === "function" ? getCount(option.value) : null;

        return (
          <button
            key={option.value}
            aria-pressed={isActive}
            className={`nav-chip ${isActive ? "active" : ""}`}
            onClick={() => onChange(option.value)}
            type="button"
          >
            <span>{option.label}</span>
            {count !== null && <strong>{count}</strong>}
          </button>
        );
      })}
    </div>
  );
}

function ReviewTrend({ values }) {
  if (!Array.isArray(values) || values.length === 0) {
    return (
      <div className="review-trend-empty">
        <p>No recent scores yet.</p>
      </div>
    );
  }

  const attemptScores = [...values].reverse();
  const minValue = Math.min(...attemptScores, 0, 70);
  const maxValue = Math.max(...attemptScores, 100, 70);
  const { points, linePath, areaPath, lastPoint } = buildTrendGeometry(attemptScores, {
    minValue,
    maxValue,
  });
  const passMarkY = getPassMarkY(70, minValue, maxValue);

  return (
    <div className="review-trend-card">
      <div className="review-trend-head">
        <span>Performance</span>
      </div>
      <svg
        aria-hidden="true"
        className="review-trend-chart"
        preserveAspectRatio="none"
        viewBox="0 0 220 88"
      >
        <defs>
          <linearGradient id="reviewTrendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="rgba(16, 94, 59, 0.18)" />
            <stop offset="100%" stopColor="rgba(16, 94, 59, 0.02)" />
          </linearGradient>
        </defs>
        <path className="review-trend-grid" d="M 6 22 H 214" />
        <path className="review-trend-grid" d="M 6 44 H 214" />
        <path className="review-trend-grid" d="M 6 66 H 214" />
        <path className="review-trend-passmark" d={`M 6 ${passMarkY} H 214`} />
        <path className="review-trend-area" d={areaPath} />
        <path className="review-trend-line" d={linePath} />
        {points.map((point, index) => (
          <circle
            className="review-trend-attempt-point"
            cx={point.x}
            cy={point.y}
            key={`${attemptScores[index]}-${index}`}
            r="2.2"
          />
        ))}
        {lastPoint && <circle className="review-trend-point" cx={lastPoint.x} cy={lastPoint.y} r="4.5" />}
      </svg>
      <div className="review-trend-foot">
        <small>Older</small>
        <small>Latest</small>
      </div>
    </div>
  );
}

function ReviewHistoryView({
  attempts,
  attemptReviewMap,
  historyFilter,
  onHistoryFilterChange,
  queue,
  queueNotice,
  attemptsNotice,
  historyNotice,
}) {
  const averageScore = attempts.length > 0
    ? Math.round(attempts.reduce((sum, item) => sum + Number(item.scorePercent ?? 0), 0) / attempts.length)
    : 0;
  const passedCount = attempts.filter((item) => item.passed).length;
  const failedCount = attempts.filter((item) => !item.passed).length;
  const filteredAttempts = filterAttemptSummaries(attempts, historyFilter);
  const trendValues = attempts.map((item) => item.scorePercent).filter((value) => Number.isFinite(value));
  const reviewQueueCount = queue.length;
  const passRate = attempts.length > 0 ? Math.round((passedCount / attempts.length) * 100) : 0;
  const performanceGuidance = getPerformanceGuidance({
    averageScore,
    passRate,
    attemptsCount: attempts.length,
    recentScores: trendValues,
  });
  const queuePreview = buildQueueReviewPreview(queue, attempts, attemptReviewMap, 3);
  const previewQueue = queuePreview?.items ?? queue.slice(0, 3);
  const topQueueSubject = previewQueue.length > 0
    ? getModuleShortLabel(
      [...previewQueue]
        .sort((left, right) => Number(right.times_missed ?? 0) - Number(left.times_missed ?? 0))[0]?.subject_name,
    )
    : null;
  const reviewQueueLink = queuePreview
    ? `/review?attempt=${queuePreview.attemptId}&question=${queuePreview.firstQuestionId}&queue=${encodeURIComponent(queuePreview.questionIds.join(","))}`
    : "/review";

  return (
    <>
      {historyNotice && <p className="inline-notice" role="status">{historyNotice}</p>}
      <section className="dashboard-panel-card review-history-overview">
        <div className="review-history-overview-intro">
          <p>Based on your last 12 attempts</p>
        </div>
        <div className="review-history-hero-row">
          <article>
            <span>Average score</span>
            <strong>{`${averageScore}%`}</strong>
          </article>
          <article>
            <span>Pass rate</span>
            <strong>{`${passRate}%`}</strong>
          </article>
        </div>

        <ReviewTrend values={trendValues} />

        <div className="review-trend-meta">
          <div className="review-trend-legend" aria-label="Trend legend">
            <span className="review-trend-legend-item">
              <i className="review-trend-legend-line" />
              <small>Pass mark</small>
            </span>
            <span className="review-trend-legend-item">
              <i className="review-trend-legend-dot" />
              <small>Attempt scores</small>
            </span>
          </div>

          <p className="review-trend-guidance">{performanceGuidance}</p>
        </div>

        <div className="review-history-support-grid">
          <article>
            <span>Recent attempts</span>
            <strong>{attempts.length}</strong>
          </article>
          <article>
            <span>Passed</span>
            <strong>{passedCount}</strong>
          </article>
          <article>
            <span>Below pass mark</span>
            <strong>{failedCount}</strong>
          </article>
          <article>
            <span>Questions to revisit</span>
            <strong>{reviewQueueCount}</strong>
          </article>
        </div>
      </section>

      <section className="dashboard-section-block">
        <div className="dashboard-section-heading review-section-heading">
          <div className="dashboard-section-heading-copy review-heading-copy-left">
            <h2>Recent attempts</h2>
          </div>
        </div>

        <ReviewFilterChips
          activeValue={historyFilter}
          getCount={(filterValue) => getHistoryFilterCount(attempts, filterValue)}
          onChange={onHistoryFilterChange}
          options={HISTORY_FILTERS}
        />

        <div className="review-history-list">
          {attemptsNotice ? (
            <article className="dashboard-panel-card review-history-empty">
              <p>{attemptsNotice}</p>
              <Link className="secondary-action" to="/dashboard#modules">
                View modules
              </Link>
            </article>
          ) : filteredAttempts.length === 0 ? (
            <article className="dashboard-panel-card review-history-empty">
              <p>
                {attempts.length === 0
                  ? "Complete a batch and your reviews will appear here."
                  : "No attempts match this filter yet."}
              </p>
              <Link className="secondary-action" to="/dashboard#modules">
                Start Practice
              </Link>
            </article>
          ) : (
            filteredAttempts.map((attempt) => {
              const contextAction = getHistoryContextAction(attempt);

              return (
                <article className="dashboard-panel-card review-history-card" key={attempt.attemptId}>
                  <div className="review-history-card-top">
                    <div className="review-history-card-copy">
                      <div className="review-history-card-title">
                        <strong>{attempt.subjectName}</strong>
                        <span className="review-history-batch">{`Batch ${attempt.batchNumber}`}</span>
                      </div>
                      <p>{`${formatDate(attempt.completedAt)} • ${attempt.attemptLabel}`}</p>
                    </div>
                    <div className="review-history-score-block">
                      <span>Score</span>
                      <strong>{`${attempt.scorePercent}%`}</strong>
                    </div>
                  </div>

                  <div className="review-history-actions">
                    <Link className="dashboard-module-toggle" to={`/review?attempt=${attempt.attemptId}`}>
                      Review
                    </Link>
                    {contextAction && (
                      <Link className="primary-action" to={contextAction.to}>
                        {contextAction.label}
                      </Link>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="dashboard-section-block">
        <div className="dashboard-section-heading review-section-heading review-section-heading-left">
          <div className="dashboard-section-heading-copy review-heading-copy-left">
            <h2 className="review-section-title">Revisit</h2>
          </div>
        </div>

        <article className="dashboard-panel-card review-queue-card review-queue-card-compact">
          {queueNotice ? (
            <p className="support-copy">{queueNotice}</p>
          ) : queue.length === 0 ? (
            <div className="review-queue-empty">
              <p>Your missed-question queue will appear here after more submitted batches.</p>
            </div>
          ) : (
            <>
              <div className="review-queue-summary">
                <div className="review-queue-summary-copy">
                  <strong>Questions worth another look</strong>
                  <p>
                    {topQueueSubject
                      ? `Most repeats are coming from ${topQueueSubject}.`
                      : "Use these to sharpen weak areas."}
                  </p>
                </div>
                <Link className="dashboard-module-toggle" to={reviewQueueLink}>
                  Open review
                </Link>
              </div>

              <div className="review-queue-list review-queue-list-compact">
                {previewQueue.map((item) => (
                  <article className="review-queue-row review-queue-row-compact" key={`${item.question_id}-${item.subject_name}`}>
                    <div className="review-queue-copy">
                      <strong>{getModuleShortLabel(item.subject_name)}</strong>
                      <p>{String(item.question_text ?? "").trim()}</p>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </article>
      </section>
    </>
  );
}

function ReviewDetailView({
  error,
  rows,
  onBack,
  queueScoped = false,
  targetQuestionId = null,
}) {
  const [currentIndex, setCurrentIndex] = useState(() => {
    const targetIndex = targetQuestionId
      ? rows.findIndex((row) => String(row?.question_id ?? "") === String(targetQuestionId))
      : -1;
    return targetIndex >= 0 ? targetIndex : 0;
  });

  const safeIndex = Math.min(currentIndex, Math.max(rows.length - 1, 0));
  const row = rows[safeIndex] ?? null;

  if (error) {
    return (
      <section className="dashboard-panel-card review-detail-empty">
        <h1>Review unavailable</h1>
        <p className="support-copy">{error}</p>
        <Link className="secondary-action" to="/review">
          Back to Review
        </Link>
      </section>
    );
  }

  if (!row) {
    return (
      <section className="dashboard-panel-card review-detail-empty">
        <h1>{queueScoped ? "Revisit unavailable" : "Review unavailable"}</h1>
        <p className="support-copy">
          {queueScoped
            ? "These revisit questions are no longer available."
            : "This review could not be found."}
        </p>
        <Link className="secondary-action" to="/review">
          Back to Review
        </Link>
      </section>
    );
  }

  const answerText = getAnswerText(row, row.selected_option);
  const correctText = getAnswerText(row, row.correct_option);
  const answerLabel = getDisplayedOptionLabel(row, row.selected_option);
  const correctLabel = getDisplayedOptionLabel(row, row.correct_option);
  const state = getQuestionState(row);
  const stateLabel = state === "correct" ? "Correct" : state === "unanswered" ? "Unanswered" : "Wrong";

  return (
    <section className="answer-review-reader">
      <header className="answer-review-header">
        <button className="answer-review-back" onClick={onBack} type="button" aria-label="Go back">
          <span aria-hidden="true">‹</span>
        </button>
        <h1>{queueScoped ? "Revisit questions" : "Answer review"}</h1>
        <strong>{`${safeIndex + 1} of ${rows.length}`}</strong>
      </header>

      <article className={`dashboard-panel-card answer-review-card is-${state}`}>
        <div className="answer-review-question-meta">
          <span>{`Question ${safeIndex + 1}`}</span>
          <strong className={`review-answer-state is-${state}`}>{stateLabel}</strong>
        </div>

        <h2>{row.question_text}</h2>

        <div className={`answer-review-response is-${state}`}>
          <span>Your answer</span>
          <p>
            {row.selected_option
              ? `${answerLabel}. ${answerText || "Answer text unavailable."}`
              : "Not answered"}
          </p>
        </div>

        <div className="answer-review-response is-correct-answer">
          <span>Correct answer</span>
          <p>
            {row.correct_option
              ? `${correctLabel}. ${correctText || "Answer text unavailable."}`
              : "Answer key unavailable."}
          </p>
        </div>

        {row.explanation?.trim() && (
          <div className="answer-review-explanation">
            <span>Explanation</span>
            <p>{row.explanation.trim()}</p>
          </div>
        )}
      </article>

      <nav className="answer-review-navigation" aria-label="Review questions">
        <button
          className="answer-review-nav-button"
          disabled={safeIndex === 0}
          onClick={() => setCurrentIndex((value) => Math.max(value - 1, 0))}
          type="button"
        >
          Previous
        </button>
        <div className="answer-review-position" aria-label={`Question ${safeIndex + 1} of ${rows.length}`}>
          {rows.map((item, index) => (
            <button
              aria-label={`Go to question ${index + 1}`}
              className={index === safeIndex ? "is-active" : ""}
              key={item.question_id}
              onClick={() => setCurrentIndex(index)}
              type="button"
            />
          ))}
        </div>
        <button
          className="answer-review-nav-button is-next"
          disabled={safeIndex === rows.length - 1}
          onClick={() => setCurrentIndex((value) => Math.min(value + 1, rows.length - 1))}
          type="button"
        >
          Next
        </button>
      </nav>
    </section>
  );
}

export default function Review() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const attemptId = searchParams.get("attempt");
  const targetQuestionId = searchParams.get("question");
  const detailReturnTo = getSafeReturnTo(
    searchParams.get("returnTo") || location.state?.returnTo,
    "/review",
  );
  const queueQuestionIds = useMemo(
    () =>
      (searchParams.get("queue") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [searchParams],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attemptSummaries, setAttemptSummaries] = useState([]);
  const [attemptReviewMap, setAttemptReviewMap] = useState({});
  const [attemptsNotice, setAttemptsNotice] = useState("");
  const [reviewQueue, setReviewQueue] = useState([]);
  const [queueNotice, setQueueNotice] = useState("");
  const [reviewRows, setReviewRows] = useState([]);
  const [loadedDetailAttemptId, setLoadedDetailAttemptId] = useState(null);
  const [historyFilter, setHistoryFilter] = useState("all");

  useEffect(() => {
    let active = true;

    async function loadHistory() {
      if (active) {
        setLoading(true);
        setError("");
        setAttemptsNotice("");
        setQueueNotice("");
        setAttemptSummaries([]);
        setAttemptReviewMap({});
        setReviewQueue([]);
        setReviewRows([]);
        setLoadedDetailAttemptId(null);
        setHistoryFilter("all");
      }

      try {
        const [attemptsResult, queueResult] = await Promise.allSettled([
          getRecentAttempts(12),
          getReviewQueue(8),
        ]);

        if (!active) return;

        const nextAttempts = attemptsResult.status === "fulfilled" && Array.isArray(attemptsResult.value)
          ? attemptsResult.value
          : [];
        const nextQueue = queueResult.status === "fulfilled" && Array.isArray(queueResult.value)
          ? queueResult.value
          : [];

        if (attemptsResult.status === "fulfilled") {
          setAttemptsNotice("");
          setAttemptSummaries(nextAttempts.map((attempt) => buildHistoryAttemptSummary(attempt)).filter(Boolean));
        } else if (!isExpectedAbortError(attemptsResult.reason)) {
          logAppError("Review history attempts", attemptsResult.reason);
          setAttemptSummaries([]);
          setAttemptReviewMap({});
          setAttemptsNotice(
            friendlyErrorMessage(
              attemptsResult.reason,
              "Your recent attempts could not be loaded right now.",
            ),
          );
        }

        if (queueResult.status === "fulfilled") {
          setReviewQueue(nextQueue);
          setQueueNotice("");
        } else if (!isExpectedAbortError(queueResult.reason)) {
          logAppError("Review queue", queueResult.reason);
          setReviewQueue([]);
          setQueueNotice("The revisit queue is not available right now.");
        }

        if (nextAttempts.length > 0 && nextQueue.length > 0) {
          try {
            const matches = await getQueueAttemptMatches(nextQueue.map((item) => item.question_id));
            if (!active) return;

            const matchingAttempt = nextAttempts.find((attempt) =>
              matches.some((match) => String(match.attempt_id) === String(attempt.id)),
            );

            if (matchingAttempt) {
              const rows = await getAttemptReview(matchingAttempt.id);
              if (!active) return;
              setAttemptReviewMap({
                [matchingAttempt.id]: Array.isArray(rows) ? rows : [],
              });
            }
          } catch (queueMatchError) {
            if (!isExpectedAbortError(queueMatchError)) {
              logAppError("Review queue attempt match", queueMatchError);
            }
          }
        }
      } catch (loadError) {
        if (!active || isExpectedAbortError(loadError)) return;
        logAppError("Review history load", loadError);
        setError(friendlyErrorMessage(loadError, "We could not load the review page. Please try again."));
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    async function loadDetail() {
      if (active) {
        setLoading(true);
        setError("");
        setAttemptsNotice("");
        setQueueNotice("");
        setAttemptSummaries([]);
        setAttemptReviewMap({});
        setReviewQueue([]);
        setReviewRows([]);
        setLoadedDetailAttemptId(null);
        setHistoryFilter("all");
      }

      try {
        const nextReview = await getAttemptReview(attemptId);

        if (!active) return;

        setReviewRows(Array.isArray(nextReview) ? nextReview : []);
        setLoadedDetailAttemptId(attemptId);
      } catch (loadError) {
        if (!active || isExpectedAbortError(loadError)) return;
        logAppError("Review detail load", loadError);
        setError(
          friendlyErrorMessage(loadError, "This review could not be found."),
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    if (attemptId) {
      void loadDetail();
    } else {
      void loadHistory();
    }

    return () => {
      active = false;
    };
  }, [attemptId]);

  const orderedReviewRows = useMemo(
    () =>
      [...reviewRows].sort(
        (left, right) =>
          Number(left.display_order ?? 0) - Number(right.display_order ?? 0),
      ),
    [reviewRows],
  );

  const baseReviewRows = useMemo(() => {
    if (queueQuestionIds.length === 0) return orderedReviewRows;

    const rowMap = new Map(
      orderedReviewRows.map((row) => [String(row?.question_id ?? ""), row]),
    );
    return queueQuestionIds.map((questionId) => rowMap.get(String(questionId))).filter(Boolean);
  }, [orderedReviewRows, queueQuestionIds]);

  const queueScoped = queueQuestionIds.length > 0;

  useEffect(() => {
    if (
      loading
      || !attemptId
      || loadedDetailAttemptId !== attemptId
      || !queueScoped
      || error
      || baseReviewRows.length > 0
    ) return;
    navigate("/review", {
      replace: true,
      state: { notice: "Those revisit questions are no longer available." },
    });
  }, [attemptId, baseReviewRows.length, error, loadedDetailAttemptId, loading, navigate, queueScoped]);

  if (loading) {
    return (
      <AppFrame showBottomNav={!attemptId} showFooter={!attemptId} showHeader={!attemptId}>
        <LoadingState />
      </AppFrame>
    );
  }

  return (
    <AppFrame showBottomNav={!attemptId} showFooter={!attemptId} showHeader={!attemptId}>
      <section className="review-page review-page-v2">
        {attemptId ? (
          <ReviewDetailView
            error={error}
            key={`${attemptId}-${queueQuestionIds.join("-")}-${targetQuestionId ?? "first"}`}
            onBack={() => navigate(detailReturnTo)}
            queueScoped={queueScoped}
            rows={baseReviewRows}
            targetQuestionId={targetQuestionId}
          />
        ) : (
          <ReviewHistoryView
            attempts={attemptSummaries}
            attemptReviewMap={attemptReviewMap}
            attemptsNotice={error || attemptsNotice}
            historyFilter={historyFilter}
            historyNotice={reviewQueue.length === 0 ? (location.state?.notice ?? "") : ""}
            onHistoryFilterChange={setHistoryFilter}
            queue={reviewQueue}
            queueNotice={queueNotice}
          />
        )}
      </section>
    </AppFrame>
  );
}
