import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AdminConfirmDialog } from "../components/admin/AdminConfirmDialog";
import { AdminGuideView } from "../components/admin/AdminGuideView";
import { AdminImportPanel } from "../components/admin/AdminImportPanel";
import { AdminModuleForm } from "../components/admin/AdminModuleForm";
import { AdminQuestionForm } from "../components/admin/AdminQuestionForm";
import { BrandLogo } from "../components/BrandLogo";
import { LoadingState } from "../components/LoadingState";
import "../styles/admin.css";
import {
  archiveAdminQuestion,
  createAdminModule,
  createAdminPracticeSet,
  createAdminPracticeSetReplacement,
  createAdminQuestionRevision,
  deleteDraftAdminQuestion,
  deleteEmptyAdminModule,
  deleteEmptyAdminPracticeSet,
  getAdminAuditLogs,
  getAdminContentModules,
  getAdminPracticeSets,
  getAdminPracticeSetValidation,
  getAdminQuestions,
  getAdminSupportRequests,
  importAdminQuestions,
  publishAdminPracticeSetReplacement,
  publishAdminQuestionRevision,
  saveAdminQuestion,
  republishAdminPracticeSet,
  retireAdminPracticeSet,
  transitionAdminPracticeSet,
  updateAdminModule,
  updateAdminModuleAvailability,
  updateAdminModuleLifecycle,
  updateAdminModuleSalesAvailability,
  updateAdminPracticeSet,
  updateAdminQuestionRevision,
  updateSupportRequest,
  withdrawAdminPracticeSet,
} from "../lib/appApi";
import {
  formatAdminCurrency,
  getNextPracticeSetNumber,
  getRetiredPracticeSetVersionOptions,
  PRACTICE_SET_STATUS_LABELS,
} from "../lib/adminContent";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { supabase } from "../lib/supabaseClient";

const STATUS_LABELS = {
  active: "Active",
  available: "Available",
  archived: "Retired",
  coming_soon: "Coming soon",
  draft: "Draft",
  hidden: "Hidden",
  paused: "Paused",
  published: "Published",
  retired: "Retired",
  review: "In review",
  withdrawn: "Withdrawn",
};

function practiceTypeLabel(value) {
  return value === "oral" ? "Oral practice" : "Objective";
}

const COUNT_FORMATTER = new Intl.NumberFormat("en-NG");

function statusLabel(status) {
  return PRACTICE_SET_STATUS_LABELS[status] ?? STATUS_LABELS[status] ?? status;
}

function formatCount(value) {
  return COUNT_FORMATTER.format(Number(value ?? 0));
}

function isReplacementPublishError(error) {
  return String(error?.message ?? error?.details ?? error ?? "").toLowerCase().includes("replacement action");
}

function adminErrorMessage(error, fallback) {
  const rawMessage = String(error?.message ?? error?.details ?? "").trim();

  if (rawMessage.includes("Only an unused draft or review question can be permanently deleted")) {
    return "This question has candidate history and must remain available for historical review. Create a replacement set instead.";
  }

  // Business-rule exceptions are deliberately written for administrators.
  if (error?.code === "P0001" && rawMessage) return rawMessage;
  return friendlyErrorMessage(error, fallback);
}

function StatusBadge({ status }) {
  return <span className={`admin-status admin-status-${status}`}>{statusLabel(status)}</span>;
}

function AdminChromeIcon({ name }) {
  const paths = {
    content: (
      <>
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M8 8h8" />
        <path d="M8 12h8" />
        <path d="M8 16h5" />
      </>
    ),
    activity: (
      <>
        <path d="M5 17h14" />
        <path d="M7 14V9" />
        <path d="M12 14V6" />
        <path d="M17 14v-3" />
      </>
    ),
    guide: (
      <>
        <path d="M7 5.5A2.5 2.5 0 0 1 9.5 3H19v16h-9.5A2.5 2.5 0 0 0 7 21" />
        <path d="M7 5.5A2.5 2.5 0 0 0 4.5 3H3v16h1.5A2.5 2.5 0 0 1 7 21" />
        <path d="M10 7h6" />
        <path d="M10 11h6" />
      </>
    ),
  };

  return (
    <span className={`admin-icon admin-icon-${name}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {paths[name]}
      </svg>
    </span>
  );
}

function AdminSummaryStrip({ items }) {
  return (
    <section className="admin-summary-strip" aria-label="Summary">
      {items.map((item) => (
        <article className={`admin-summary-item${item.tone ? ` is-${item.tone}` : ""}`} key={item.label}>
          <span className="admin-summary-item-label">{item.label}</span>
          <strong className="admin-summary-item-value">{item.value}</strong>
        </article>
      ))}
    </section>
  );
}

function AdminRail({ currentView, navigate }) {
  return (
    <aside className="admin-rail" aria-label="Admin sections">
      <div className="admin-rail-brand">
        <BrandLogo />
      </div>

      <nav className="admin-rail-nav">
        <button
          className={`admin-rail-link${currentView === "modules" ? " is-active" : ""}`}
          type="button"
          onClick={() => navigate("/admin")}
        >
          <AdminChromeIcon name="content" />
          <strong>Content</strong>
        </button>
        <button
          className={`admin-rail-link${currentView === "activity" ? " is-active" : ""}`}
          type="button"
          onClick={() => navigate("/admin/activity")}
        >
          <AdminChromeIcon name="activity" />
          <strong>Activity</strong>
        </button>
        <button
          className={`admin-rail-link${currentView === "guide" ? " is-active" : ""}`}
          type="button"
          onClick={() => navigate("/admin/guide")}
        >
          <AdminChromeIcon name="guide" />
          <strong>Guide</strong>
        </button>
        <button
          className={`admin-rail-link${currentView === "support" ? " is-active" : ""}`}
          type="button"
          onClick={() => navigate("/admin/help")}
        >
          <AdminChromeIcon name="activity" />
          <strong>Help requests</strong>
        </button>
      </nav>
    </aside>
  );
}

function AdminFeedback({ feedback, onDismiss }) {
  if (!feedback?.message) return null;

  return (
    <div className={`admin-feedback is-${feedback.tone ?? "info"}`} role={feedback.tone === "error" ? "alert" : "status"}>
      <span>{feedback.message}</span>
      <button className="link-button" type="button" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

function ModuleCatalogue({ modules, onCreate, onManage, onQueryChange, query }) {
  const [filter, setFilter] = useState("all");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleModules = modules.filter((module) => {
    const matchesQuery = !normalizedQuery || module.subject_name.toLowerCase().includes(normalizedQuery);
    const needsAttention = module.lifecycle_status === "draft"
      || (module.lifecycle_status === "active" && Number(module.published_set_count) === 0);
    const matchesFilter = filter === "all"
      || (filter === "attention" && needsAttention)
      || (filter === "live" && module.lifecycle_status === "active")
      || module.lifecycle_status === filter;
    return matchesQuery && matchesFilter;
  });

  const counts = {
    all: modules.length,
    attention: modules.filter((module) => module.lifecycle_status === "draft"
      || (module.lifecycle_status === "active" && Number(module.published_set_count) === 0)).length,
    draft: modules.filter((module) => module.lifecycle_status === "draft").length,
    live: modules.filter((module) => module.lifecycle_status === "active").length,
    retired: modules.filter((module) => module.lifecycle_status === "retired").length,
  };

  return (
    <>
      <section className="admin-page-heading">
        <div>
          <h1>Content</h1>
          <p>Manage modules and the practice sets candidates can use.</p>
        </div>
        <button type="button" onClick={onCreate}>Create module</button>
      </section>

      <div className="admin-filter-tabs" aria-label="Filter modules">
        {[
          ["all", "All"],
          ["attention", "Needs attention"],
          ["draft", "Draft"],
          ["live", "Live"],
          ["retired", "Retired"],
        ].map(([value, label]) => (
          <button
            className={`admin-filter-button${filter === value ? " is-active" : ""}`}
            key={value}
            type="button"
            onClick={() => setFilter(value)}
          >
            {label} <span>{counts[value]}</span>
          </button>
        ))}
      </div>

      <div className="admin-list-toolbar">
        <label className="admin-inline-search">
          <span className="sr-only">Search modules</span>
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search modules..."
          />
        </label>
        <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Module status filter">
          <option value="all">Status: All</option>
          <option value="live">Status: Active</option>
          <option value="draft">Status: Draft</option>
          <option value="attention">Status: Needs attention</option>
          <option value="retired">Status: Retired</option>
        </select>
        <span>{visibleModules.length} modules</span>
      </div>

      {visibleModules.length === 0 ? (
        <section className="admin-empty-state">
          <h2>No matching modules</h2>
          <p>Try another search or create a new module.</p>
        </section>
      ) : (
        <section className="admin-module-table" aria-label="Modules">
          <div className="admin-module-table-head" aria-hidden="true">
            <span>Module</span>
            <span>Status</span>
            <span>Practice sets</span>
            <span>Sales</span>
            <span>Price</span>
            <span />
          </div>
          {visibleModules.map((module) => (
            <article className="admin-module-row" key={module.subject_id}>
              <div className="admin-module-row-name">
              <strong>{module.subject_name}</strong>
              <small className="admin-module-type">{practiceTypeLabel(module.practice_type)}</small>
              </div>
              <div className="admin-module-row-status"><StatusBadge status={module.lifecycle_status} /></div>
              <span className="admin-module-metric admin-module-metric-sets">
                {module.published_set_count} published<span className="admin-secondary-count"> / {module.practice_set_count} total</span>
              </span>
              <span className="admin-module-metric admin-module-metric-sales">
                {module.available_for_purchase ? "On sale" : "Not on sale"}
                <small>{statusLabel(module.candidate_availability)}</small>
              </span>
              <span className="admin-module-metric admin-module-metric-price">
                {module.price_kobo ? formatAdminCurrency(module.price_kobo, module.currency) : "Not set"}
              </span>
              <button className="admin-row-more" type="button" onClick={() => onManage(module.subject_id)} aria-label={`Open ${module.subject_name}`}>
                <span aria-hidden="true">...</span>
              </button>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function ModuleWorkspace({
  module,
  practiceSets,
  query,
  loading,
  onBack,
  onCreateSet,
  onDelete,
  onEdit,
  onOpenSet,
}) {
  const [showSetCreator, setShowSetCreator] = useState(false);
  const [showRetiredHistory, setShowRetiredHistory] = useState(false);
  const [expectedCount, setExpectedCount] = useState(module.batch_size ?? 30);
  const [creationTarget, setCreationTarget] = useState("new");
  const isUnused = Number(module.question_count) === 0
    && Number(module.attempt_count) === 0
    && Number(module.payment_count) === 0;
  const summaryItems = [
    { label: "Sets", value: formatCount(module.practice_set_count) },
    { label: "Published sets", value: formatCount(module.published_set_count) },
    { label: "Total attempts", value: formatCount(module.attempt_count) },
    { label: "Current access", value: formatCount(module.active_entitlement_count) },
  ];
  const normalizedQuery = query.trim().toLowerCase();
  const retiredPracticeSets = practiceSets.filter((practiceSet) => practiceSet.status === "archived");
  const visiblePracticeSets = practiceSets
    .filter((practiceSet) => showRetiredHistory || practiceSet.status !== "archived")
    .filter((practiceSet) => (
      !normalizedQuery
      || `practice set ${practiceSet.set_number}`.toLowerCase().includes(normalizedQuery)
    ));
  const retiredVersionOptions = getRetiredPracticeSetVersionOptions(practiceSets);
  const nextSetNumber = getNextPracticeSetNumber(practiceSets);

  function openSetCreator() {
    const retiredSet = retiredVersionOptions[0];
    setCreationTarget(retiredSet?.practice_set_id ?? "new");
    setExpectedCount(retiredSet?.expected_question_count ?? module.batch_size ?? 30);
    setShowSetCreator(true);
  }

  return (
    <>
      <nav className="admin-breadcrumbs" aria-label="Breadcrumb">
        <button className="admin-breadcrumb-button" type="button" onClick={onBack}>Content</button>
        <span aria-hidden="true">/</span>
        <span>{module.subject_name}</span>
      </nav>

      <section className="admin-module-overview">
        <div>
          <div className="admin-inline-status">
            <StatusBadge status={module.lifecycle_status} />
            <span>{practiceTypeLabel(module.practice_type)}</span>
            <span>Candidates: {statusLabel(module.candidate_availability)}</span>
            <span>{module.available_for_purchase ? "On sale" : "Not on sale"}</span>
          </div>
          <h1>{module.subject_name}</h1>
          <p>{formatAdminCurrency(module.price_kobo, module.currency)} per module</p>
        </div>
        <div className="admin-overview-actions">
          <button type="button" onClick={openSetCreator}>Add practice set</button>
          <button className="ghost-button" type="button" onClick={() => onEdit(module)}>Settings</button>
        </div>
      </section>

      <AdminSummaryStrip items={summaryItems} />

      <section className="admin-module-notices" aria-label="Module availability summary">
        {Number(module.published_set_count) === 0 && <p>This module has no published practice sets.</p>}
        {Number(module.active_entitlement_count) > 0 && <p>Existing entitled candidates still retain access.</p>}
        {!module.available_for_purchase && <p>New purchases are disabled.</p>}
        {Number(module.in_progress_attempt_count) > 0 && <p>{formatCount(module.in_progress_attempt_count)} attempts are currently in progress.</p>}
        {module.candidate_availability === "paused" && <p>New attempts are paused while candidate history and entitlements remain safe.</p>}
      </section>

      {showSetCreator && (
        <form
          className="admin-inline-creator"
          onSubmit={(event) => {
            event.preventDefault();
            onCreateSet({
              expectedCount,
              sourceSetId: creationTarget === "new" ? null : creationTarget,
            }, () => setShowSetCreator(false));
          }}
        >
          <div>
            <h2>Add practice set</h2>
            <p>Continue a retired numbered slot or add the next new slot.</p>
          </div>
          {retiredVersionOptions.length > 0 && (
            <fieldset className="admin-creation-targets">
              <legend>Practice-set slot</legend>
              {retiredVersionOptions.map((practiceSet) => (
                <label key={practiceSet.practice_set_id}>
                  <input
                    checked={creationTarget === practiceSet.practice_set_id}
                    name="creation-target"
                    type="radio"
                    value={practiceSet.practice_set_id}
                    onChange={() => {
                      setCreationTarget(practiceSet.practice_set_id);
                      setExpectedCount(practiceSet.expected_question_count);
                    }}
                  />
                  <span>
                    <strong>New version of Practice set {practiceSet.set_number}</strong>
                    <small>Keeps the retired version as history and starts an empty draft with the same number.</small>
                  </span>
                </label>
              ))}
              <label>
                <input
                  checked={creationTarget === "new"}
                  name="creation-target"
                  type="radio"
                  value="new"
                  onChange={() => {
                    setCreationTarget("new");
                    setExpectedCount(module.batch_size ?? 30);
                  }}
                />
                <span>
                  <strong>New Practice set {nextSetNumber}</strong>
                  <small>Adds a separate numbered slot after the existing sets.</small>
                </span>
              </label>
            </fieldset>
          )}
          {creationTarget === "new" ? (
            <label>
              Questions required
              <input
                min="1"
                max="200"
                required
                type="number"
                value={expectedCount}
                onChange={(event) => setExpectedCount(event.target.value)}
              />
            </label>
          ) : (
            <p className="admin-inherited-count">Question target: <strong>{expectedCount}</strong>, inherited from the retired version.</p>
          )}
          <div className="admin-inline-actions">
            <button className="ghost-button" type="button" onClick={() => setShowSetCreator(false)}>Cancel</button>
            <button type="submit" disabled={loading}>{loading ? "Adding..." : "Add draft set"}</button>
          </div>
        </form>
      )}

      <section className="admin-section-heading">
        <div>
          <h2>Practice sets</h2>
          <p>{showRetiredHistory ? "Current sets and immutable historical versions." : "Current versions available for administration."}</p>
        </div>
        {retiredPracticeSets.length > 0 && (
          <button
            className="ghost-button admin-history-toggle"
            type="button"
            aria-expanded={showRetiredHistory}
            onClick={() => setShowRetiredHistory((current) => !current)}
          >
            {showRetiredHistory ? "Hide retired history" : `Show retired history (${retiredPracticeSets.length})`}
          </button>
        )}
      </section>

      {loading ? (
        <LoadingState />
      ) : visiblePracticeSets.length === 0 ? (
        <section className="admin-empty-state">
          <h2>{practiceSets.length > 0 && !showRetiredHistory && !normalizedQuery ? "No current practice sets" : "No matching practice sets"}</h2>
          <p>{practiceSets.length === 0
            ? "Use the create action above, then add questions individually or import them."
            : !showRetiredHistory && !normalizedQuery
              ? "Add a new version from a retired slot, or show retired history for inspection."
              : "Try another search."}</p>
        </section>
      ) : (
        <section className="admin-set-list">
          {visiblePracticeSets.map((practiceSet) => {
            const questionCount = Number(practiceSet.capabilities?.question_count ?? practiceSet.active_question_count ?? 0);
            const expected = Number(practiceSet.expected_question_count ?? 0);
            const percentage = expected > 0 ? Math.min(100, Math.round((questionCount / expected) * 100)) : 0;

            return (
              <article key={practiceSet.practice_set_id}>
                <div className="admin-set-number"><span>Set</span><strong>{practiceSet.set_number}</strong></div>
                <div className="admin-set-main">
                  <div className="admin-set-title-row">
                    <div>
                      <strong>Practice set {practiceSet.set_number}</strong>
                      <StatusBadge status={practiceSet.status} />
                      {practiceSet.status === "archived" && (
                        <small className="admin-version-label">Version {practiceSet.version_number} history</small>
                      )}
                    </div>
                    <span className={questionCount !== expected ? "needs-attention" : ""}>
                      {questionCount} of {expected} questions
                    </span>
                  </div>
                  <div className="admin-progress-track" aria-label={`${percentage}% complete`}>
                    <span style={{ width: `${percentage}%` }} />
                  </div>
                  {questionCount !== expected && <small>{expected - questionCount > 0 ? `${expected - questionCount} more needed` : `${questionCount - expected} over the set limit`}</small>}
                </div>
                <button className="admin-row-open" type="button" onClick={() => onOpenSet(practiceSet.practice_set_id)}>
                  Open <span aria-hidden="true">&gt;</span>
                </button>
              </article>
            );
          })}
        </section>
      )}

      <details className="admin-usage-disclosure">
        <summary>Usage and lifecycle detail</summary>
        <dl>
          <div><dt>Total attempts</dt><dd>{module.attempt_count}</dd></div>
          <div><dt>Current access</dt><dd>{module.active_entitlement_count}</dd></div>
          <div><dt>Published sets</dt><dd>{module.published_set_count}</dd></div>
        </dl>
      </details>

      {isUnused && (
        <section className="admin-danger-zone">
          <div>
            <h2>Unused module</h2>
            <p>This empty module can be permanently deleted.</p>
          </div>
          <button className="admin-danger-button" type="button" onClick={onDelete}>Delete unused module</button>
        </section>
      )}
    </>
  );
}

function QuestionPreview({ question, onClose }) {
  if (!question) return null;

  return (
    <div className="admin-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="admin-question-preview" role="dialog" aria-modal="true" aria-labelledby="question-preview-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="admin-editor-heading">
          <div>
            <span className="admin-form-step">Candidate preview</span>
            <h2 id="question-preview-title">Question {question.batch_position}</h2>
          </div>
          <button className="link-button" type="button" onClick={onClose}>Close</button>
        </div>
        <p className="admin-preview-question">{question.question_text}</p>
        {question.model_answer ? (
          <div className="admin-preview-oral">
            <div><strong>Model answer</strong><p>{question.model_answer}</p></div>
            <div><strong>Key points</strong><ul>{question.key_points.map((point) => <li key={point}>{point}</li>)}</ul></div>
          </div>
        ) : <div className="admin-preview-options">
          {["A", "B", "C", "D"].map((option) => (
            <div className={question.correct_option === option ? "is-answer" : ""} key={option}>
              <span>{option}</span>
              <p>{question[`option_${option.toLowerCase()}`]}</p>
              {question.correct_option === option && <strong>Correct answer</strong>}
            </div>
          ))}
        </div>}
        {question.explanation && (
          <div className="admin-preview-explanation"><strong>Explanation</strong><p>{question.explanation}</p></div>
        )}
      </section>
    </div>
  );
}

function PracticeSetWorkspace({
  module,
  practiceSet,
  questions,
  onQueryChange,
  query,
  validation,
  loading,
  working,
  onArchiveQuestion,
  onBack,
  onDeleteQuestion,
  onDeleteSet,
  forceReplacementPublish = false,
  onImport,
  onLifecycleAction,
  onPublishCorrection,
  onSaveExpectedCount,
  onSaveQuestion,
  onTransition,
}) {
  const [editor, setEditor] = useState(null);
  const [showImporter, setShowImporter] = useState(false);
  const [previewQuestion, setPreviewQuestion] = useState(null);
  const [statusFilter, setStatusFilter] = useState("current");
  const [visibleLimit, setVisibleLimit] = useState(30);
  const [expectedCount, setExpectedCount] = useState(practiceSet.expected_question_count);
  const practiceType = practiceSet.practice_type ?? module.practice_type ?? "objective";
  const capabilities = practiceSet.capabilities ?? {};
  const isReplacementVersion = Boolean(practiceSet.replaces_practice_set_id);
  const shouldUseReplacementPublish = isReplacementVersion || forceReplacementPublish;
  const canPublishSet = Boolean(capabilities.can_publish) && !shouldUseReplacementPublish;
  const canPublishReplacement = Boolean(capabilities.can_publish_replacement)
    || (practiceSet.status === "review" && shouldUseReplacementPublish);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleQuestions = questions.filter((question) => {
    const statusMatches = statusFilter === "all"
      || (statusFilter === "current" && question.status !== "archived")
      || question.status === statusFilter;
    const queryMatches = !normalizedQuery || question.question_text.toLowerCase().includes(normalizedQuery);
    return statusMatches && queryMatches;
  });
  const activeQuestions = questions.filter((question) => question.status !== "archived");
  const shownQuestions = visibleQuestions.slice(0, visibleLimit);
  const noQuestionsYet = questions.length === 0;
  const nextPosition = activeQuestions.reduce(
    (highest, question) => Math.max(highest, Number(question.batch_position ?? 0)),
    0,
  ) + 1;
  const canEditSet = Boolean(capabilities.can_edit);
  const readinessLoading = loading || !validation;
  const readinessReady = Boolean(validation?.ready);
  const readinessErrors = validation?.errors ?? [];
  const shouldShowReadinessPanel = readinessLoading
    || readinessErrors.length > 0
    || ["review", "published", "withdrawn", "archived"].includes(practiceSet.status);
  const stageGuide = {
    draft: {
      label: "Draft set",
      note: "Add or revise questions before sending the set to review.",
    },
    review: {
      label: "In review",
      note: "Check readiness errors and publish only when the set is complete.",
    },
    published: {
      label: "Published set",
      note: "This is the candidate-facing version. Create a replacement for content corrections.",
    },
    withdrawn: {
      label: "Withdrawn set",
      note: "New attempts are paused. Existing attempts, results, and reviews remain safe.",
    },
    archived: {
      label: "Retired set",
      note: "Permanently closed to new attempts and preserved for candidate history.",
    },
  }[practiceSet.status] ?? {
    label: statusLabel(practiceSet.status),
    note: "Manage this practice set from the current workspace.",
  };
  const summaryItems = [
    { label: "Questions", value: formatCount(capabilities.question_count ?? practiceSet.active_question_count) },
    { label: "Target", value: formatCount(practiceSet.expected_question_count) },
    { label: "Attempts", value: formatCount(practiceSet.attempt_count) },
    { label: "In progress", value: formatCount(practiceSet.in_progress_attempt_count) },
    {
      label: "Readiness",
      value: readinessLoading ? "Checking" : readinessReady ? "Ready" : "Blocked",
      tone: readinessLoading ? undefined : readinessReady ? "success" : "attention",
    },
  ];

  function editQuestion(question) {
    if (question.status === "published") {
      setEditor({ mode: "correction", question });
    } else if (question.supersedes_question_id) {
      setEditor({ mode: "correction", question });
    } else {
      setEditor({ mode: "question", question });
    }
  }

  if (editor) {
    const editorTitle = editor.mode === "correction"
      ? "Question correction"
      : editor.question
        ? `Question ${editor.question.batch_position}`
        : "New question";

    return (
      <>
        <nav className="admin-breadcrumbs" aria-label="Breadcrumb">
          <button className="admin-breadcrumb-button" type="button" onClick={onBack}>{module.subject_name}</button>
          <span aria-hidden="true">/</span>
          <button className="admin-breadcrumb-button" type="button" onClick={() => setEditor(null)}>Practice set {practiceSet.set_number}</button>
          <span aria-hidden="true">/</span>
          <span>{editorTitle}</span>
        </nav>
        <section className="admin-editor-workspace">
          <AdminQuestionForm
            key={`${editor.mode}:${editor.question?.id ?? "new"}:${nextPosition}`}
            question={editor.question}
            mode={editor.mode}
            nextPosition={nextPosition}
            practiceSetId={practiceSet.practice_set_id}
            practiceType={practiceType}
            saving={working}
            onCancel={() => setEditor(null)}
            onSubmit={(question) => onSaveQuestion(editor.mode, question, () => setEditor(null))}
          />
        </section>
      </>
    );
  }

  return (
    <>
      <nav className="admin-breadcrumbs" aria-label="Breadcrumb">
        <button className="admin-breadcrumb-button" type="button" onClick={onBack}>{module.subject_name}</button>
        <span aria-hidden="true">/</span>
        <span>Practice set {practiceSet.set_number}</span>
      </nav>

      <section className="admin-set-overview">
        <div>
          <div className="admin-inline-status">
            <StatusBadge status={practiceSet.status} />
            <span>{capabilities.question_count ?? practiceSet.active_question_count} of {practiceSet.expected_question_count} questions</span>
          </div>
          <h1>Practice set {practiceSet.set_number}</h1>
          <p>{stageGuide.note}</p>
        </div>
        <div className="admin-set-actions">
          {canEditSet && (
            <>
              <button type="button" onClick={() => setShowImporter(true)}>Upload questions</button>
              <button className="ghost-button" type="button" onClick={() => setEditor({ mode: "question", question: null })}>Add one question</button>
            </>
          )}
          {capabilities.can_delete && (
            <button className="admin-danger-link" type="button" onClick={onDeleteSet}>Delete unused draft</button>
          )}
          {capabilities.can_send_to_review && (
            <button className="ghost-button" disabled={!validation?.ready || working} type="button" onClick={() => onTransition("review")}>Send for review</button>
          )}
          {capabilities.can_return_to_draft && (
            <>
              <button className="ghost-button" disabled={working} type="button" onClick={() => onTransition("draft")}>Return to draft</button>
              {canPublishSet && <button disabled={!validation?.ready || working} type="button" onClick={() => onTransition("published")}>Publish set</button>}
            </>
          )}
          {canPublishReplacement && <button disabled={!validation?.ready || working} type="button" onClick={() => onLifecycleAction("publish_replacement")}>Publish replacement</button>}
          {capabilities.can_withdraw && <button className="ghost-button" disabled={working} type="button" onClick={() => onLifecycleAction("withdraw")}>Withdraw temporarily</button>}
          {capabilities.can_republish && <button disabled={working} type="button" onClick={() => onLifecycleAction("republish")}>Republish unchanged</button>}
          {capabilities.can_create_replacement && <button className="ghost-button" disabled={working} type="button" onClick={() => onLifecycleAction("create_replacement")}>{practiceSet.status === "archived" ? "Create new version" : "Create corrected replacement"}</button>}
          {capabilities.can_retire && <button className="admin-danger-outline" disabled={working} type="button" onClick={() => onLifecycleAction("retire")}>Retire permanently</button>}
        </div>
      </section>

      <AdminSummaryStrip items={summaryItems} />

      {shouldShowReadinessPanel && (
        <section className={`admin-readiness${readinessLoading ? " is-pending" : readinessReady ? " is-ready" : " is-blocked"}`}>
          <div className="admin-readiness-copy">
            <strong>{readinessLoading ? "Checking readiness" : readinessReady ? "Ready for the next step" : "Needs attention"}</strong>
            <p className="admin-readiness-hint">
              {practiceSet.status === "draft" && "Draft sets should pass every readiness check before review."}
              {practiceSet.status === "review" && "Review sets should be complete and verified before publication."}
              {practiceSet.status === "published" && "Published sets should use correction revisions instead of direct edits."}
              {practiceSet.status === "withdrawn" && "Withdrawn sets can be republished unchanged or replaced with a corrected version."}
              {practiceSet.status === "archived" && "Retired sets remain historical records and are not open for new attempts."}
            </p>
          </div>
          <div className="admin-readiness-details">
            {readinessLoading ? (
              <p>Loading the latest question count and content checks.</p>
            ) : readinessErrors.length > 0 ? (
              <ul>{readinessErrors.map((error) => <li key={error}>{error}</li>)}</ul>
            ) : (
              <p>Question count and content checks have passed.</p>
            )}
          </div>
        </section>
      )}

      {(capabilities.warnings?.length > 0 || Object.keys(capabilities.blocking_reasons ?? {}).length > 0) && (
        <details className="admin-set-tools admin-capability-detail">
          <summary>Availability and blocked actions</summary>
          {capabilities.warnings?.length > 0 && <ul>{capabilities.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          {Object.entries(capabilities.blocking_reasons ?? {}).map(([action, reasons]) => (
            <div key={action}>
              <strong>{action === "edit" ? "Editing" : "Deleting"}</strong>
              <ul>{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
            </div>
          ))}
        </details>
      )}

      {canEditSet && (
        <details className="admin-set-tools">
          <summary>Question target</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSaveExpectedCount(expectedCount);
            }}
          >
            <label>
              Expected questions
              <input
                min="1"
                max="200"
                required
                type="number"
                value={expectedCount}
                onChange={(event) => setExpectedCount(event.target.value)}
              />
            </label>
            <button className="ghost-button" type="submit" disabled={working || Number(expectedCount) === Number(practiceSet.expected_question_count)}>
              Save
            </button>
          </form>
        </details>
      )}

      {(loading || !noQuestionsYet) && (
        <section className="admin-question-bank">
          <div className="admin-question-bank-head">
            <div>
              <h2>Questions</h2>
              <p>{`${Math.min(shownQuestions.length, visibleQuestions.length)} of ${visibleQuestions.length} shown`}</p>
            </div>
            {questions.length > 0 && (
              <div className="admin-question-filters">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => onQueryChange(event.target.value)}
                  placeholder="Search questions..."
                />
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="current">Current questions</option>
                  <option value="all">All records</option>
                  <option value="draft">Draft</option>
                  <option value="review">In review</option>
                  <option value="published">Published</option>
                  <option value="archived">Retired</option>
                </select>
              </div>
            )}
          </div>

          {loading ? (
            <LoadingState />
          ) : visibleQuestions.length === 0 ? (
            <div className="admin-question-empty">
              <h3>No matching questions</h3>
              <p>Change the search or status filter.</p>
            </div>
          ) : (
            <div className="admin-question-rows">
              {shownQuestions.map((question) => (
                <article className={question.supersedes_question_id ? "is-revision" : ""} key={question.id}>
                  <div className="admin-question-position">{question.batch_position}</div>
                  <div className="admin-question-copy">
                    <div className="admin-question-copy-meta">
                      {question.status !== "published" && <StatusBadge status={question.status} />}
                      {question.supersedes_question_id && <span className="admin-revision-label">Correction</span>}
                      {Number(question.revision_number) > 1 && <span>Revision {question.revision_number}</span>}
                    </div>
                    <strong>{question.question_text}</strong>
                    <small className="admin-question-answer">
                      {practiceType === "oral"
                        ? `${question.key_points.length} key point${question.key_points.length === 1 ? "" : "s"}`
                        : `Correct answer: ${question.correct_option}`}
                    </small>
                  </div>
                  <div className="admin-row-actions">
                    <div className="admin-row-action-group">
                      <button className="ghost-button admin-row-inspect" type="button" onClick={() => setPreviewQuestion(question)}>Preview</button>
                      {canEditSet && question.status !== "archived" && (
                        <button className="link-button admin-row-main-action" type="button" onClick={() => editQuestion(question)}>
                          Edit
                        </button>
                      )}
                    </div>
                    {canEditSet && question.status !== "archived" && (
                      question.supersedes_question_id && question.status === "review" && (
                        <button type="button" disabled={working} onClick={() => onPublishCorrection(question.id)}>Publish correction</button>
                      )
                    )}
                    {["draft", "review"].includes(question.status) && !question.supersedes_question_id && (
                      <button className="admin-danger-link" type="button" disabled={working} onClick={() => onDeleteQuestion(question)}>Remove</button>
                    )}
                    {["draft", "review"].includes(question.status) && question.supersedes_question_id && (
                      <button className="admin-danger-link" type="button" disabled={working} onClick={() => onArchiveQuestion(question)}>Discard</button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
          {shownQuestions.length < visibleQuestions.length && (
            <button className="ghost-button admin-show-more" type="button" onClick={() => setVisibleLimit((current) => current + 30)}>
              Show 30 more
            </button>
          )}
        </section>
      )}

      {canEditSet && showImporter && (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={() => setShowImporter(false)}>
          <section
            className="admin-module-dialog admin-import-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Upload questions"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <AdminImportPanel
              expectedQuestionCount={practiceSet.expected_question_count}
              presentation="dialog"
              questions={questions}
              practiceType={practiceType}
              importing={working}
              onClose={() => setShowImporter(false)}
              onImport={onImport}
            />
          </section>
        </div>
      )}

      <QuestionPreview question={previewQuestion} onClose={() => setPreviewQuestion(null)} />
    </>
  );
}

function activityLabel(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function activityTitle(log) {
  const entity = {
    module: "Module",
    practice_set: "Practice set",
    question: "Question",
    question_revision: "Question correction",
    oral_question: "Oral question",
  }[log.entity_type] ?? activityLabel(log.entity_type);
  const action = {
    ARCHIVE: "archived",
    CREATE: "created",
    DELETE: "deleted",
    IMPORT: "questions imported",
    PUBLISH: "published",
    UPDATE: "updated",
  }[String(log.action).toUpperCase()] ?? String(log.action).replaceAll("_", " ").toLowerCase();

  return action === "questions imported" ? `Questions imported to ${entity.toLowerCase()}` : `${entity} ${action}`;
}

function activityDetailValue(key, value) {
  if (key === "price_kobo") return formatAdminCurrency(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function activitySummary(log) {
  const details = Object.entries(log.metadata ?? {})
    .filter(([key]) => !key.endsWith("_id"))
    .slice(0, 2)
    .map(([key, value]) => `${activityLabel(key)}: ${activityDetailValue(key, value)}`);

  if (details.length > 0) return details.join(" • ");
  return activityTitle(log);
}

function ActivityView({ auditLogs, onQueryChange, query }) {
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedLogId, setSelectedLogId] = useState(null);
  const normalizedQuery = query.trim().toLowerCase();
  const typeOptions = Array.from(new Set(auditLogs.map((log) => String(log.action).toUpperCase()))).sort();
  const visibleLogs = auditLogs.filter((log) => {
    const searchable = [log.action, log.entity_type, log.actor?.full_name, log.actor?.email, JSON.stringify(log.metadata)]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesType = typeFilter === "all" || String(log.action).toUpperCase() === typeFilter;
    return matchesType && (!normalizedQuery || searchable.includes(normalizedQuery));
  });
  const selectedLog = visibleLogs.find((log) => log.id === selectedLogId) ?? visibleLogs[0] ?? null;
  const selectedDetails = Object.entries(selectedLog?.metadata ?? {})
    .sort(([firstKey], [secondKey]) => Number(firstKey.endsWith("_id")) - Number(secondKey.endsWith("_id")));

  return (
    <>
      <section className="admin-page-heading">
        <div>
          <h1>Activity</h1>
          <p>A record of content and publication changes.</p>
        </div>
      </section>

      <section className="admin-activity-board">
        <div className="admin-list-toolbar">
          <label className="admin-inline-search">
            <span className="sr-only">Search activity</span>
            <input
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search activity..."
            />
          </label>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Activity filter">
            <option value="all">All types</option>
            {typeOptions.map((type) => (
              <option key={type} value={type}>{activityLabel(type)}</option>
            ))}
          </select>
          <span>{visibleLogs.length} entries</span>
        </div>

        {visibleLogs.length === 0 ? (
          <div className="admin-empty-state"><h2>No activity yet</h2><p>Content changes will be recorded here.</p></div>
        ) : (
          <>
            <section className="admin-activity-table" aria-label="Activity log">
              <div className="admin-activity-table-head" aria-hidden="true">
                <span>Time</span>
                <span>User</span>
                <span>Event</span>
                <span>Entity</span>
                <span>Details</span>
              </div>
              {visibleLogs.map((log) => (
                <button
                  className={`admin-activity-row${selectedLog?.id === log.id ? " is-active" : ""}`}
                  key={log.id}
                  type="button"
                  onClick={() => setSelectedLogId(log.id)}
                >
                  <span className="admin-activity-time">
                    {new Date(log.created_at).toLocaleDateString("en-NG", { month: "short", day: "numeric", year: "numeric" })}
                    <small>{new Date(log.created_at).toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}</small>
                  </span>
                  <span>{log.actor?.full_name || log.actor?.email || "Admin"}</span>
                  <span>{activityLabel(log.action)}</span>
                  <span>{activityLabel(log.entity_type)}</span>
                  <span>{activitySummary(log)}</span>
                </button>
              ))}
            </section>

            {selectedLog && (
              <section className="admin-activity-details">
                <div className="admin-activity-details-head">
                  <div>
                    <h2>Event details</h2>
                    <p>{activityTitle(selectedLog)}</p>
                  </div>
                  <span className={`admin-activity-action is-${String(selectedLog.action).toLowerCase()}`}>
                    {activityLabel(selectedLog.action)}
                  </span>
                </div>
                <dl>
                  {selectedDetails.map(([key, value]) => (
                    <div key={key}>
                      <dt>{activityLabel(key)}</dt>
                      <dd className={typeof value === "object" ? "is-technical" : undefined}>
                        {activityDetailValue(key, value)}
                      </dd>
                    </div>
                  ))}
                  {selectedLog.entity_id && (
                    <div>
                      <dt>Record ID</dt>
                      <dd className="is-technical">{selectedLog.entity_id}</dd>
                    </div>
                  )}
                </dl>
              </section>
            )}
          </>
        )}
      </section>
    </>
  );
}

function SupportRequestDetail({ onUpdate, request, working }) {
  const [status, setStatus] = useState(request.status);
  const [resolutionNote, setResolutionNote] = useState(request.resolution_note ?? "");

  return (
    <section className="admin-support-detail">
      <header>
        <div>
          <span>{request.category}</span>
          <h2>{request.subject}</h2>
          <p>{request.requester_name || request.requester_email || "Candidate"}</p>
        </div>
        <strong>{request.status.replace("_", " ")}</strong>
      </header>
      <p className="admin-support-description">{request.description}</p>
      <dl>
        {request.requester_email && <div><dt>Email</dt><dd>{request.requester_email}</dd></div>}
        {request.payment_reference && <div><dt>Payment reference</dt><dd className="is-technical">{request.payment_reference}</dd></div>}
        {request.page_path && <div><dt>Page</dt><dd>{request.page_path}</dd></div>}
        <div><dt>Received</dt><dd>{new Date(request.created_at).toLocaleString("en-NG")}</dd></div>
      </dl>
      <div className="admin-support-resolution">
        <label>
          <span>Status</span>
          <select disabled={working} onChange={(event) => setStatus(event.target.value)} value={status}>
            <option value="received">Received</option>
            <option value="in_review">In review</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>
        </label>
        <label>
          <span>Resolution note</span>
          <textarea disabled={working} maxLength={2000} onChange={(event) => setResolutionNote(event.target.value)} rows={4} value={resolutionNote} />
        </label>
        <button disabled={working || (status === request.status && resolutionNote === (request.resolution_note ?? ""))} onClick={() => onUpdate(request.id, status, resolutionNote)} type="button">
          {working ? "Saving..." : "Save update"}
        </button>
      </div>
    </section>
  );
}

function AdminSupportView({ onQueryChange, onUpdate, query, requests, working }) {
  const [selectedId, setSelectedId] = useState(null);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleRequests = requests.filter((request) => [
    request.subject,
    request.description,
    request.requester_name,
    request.requester_email,
    request.payment_reference,
    request.status,
  ].filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery));
  const selected = visibleRequests.find((request) => request.id === selectedId) ?? visibleRequests[0] ?? null;

  return (
    <>
      <section className="admin-page-heading">
        <div><h1>Help requests</h1><p>Resolve account, access, payment, practice, and technical problems reported by candidates.</p></div>
      </section>
      <section className="admin-support-board">
        <div className="admin-list-toolbar">
          <label className="admin-inline-search">
            <span className="sr-only">Search help requests</span>
            <input onChange={(event) => onQueryChange(event.target.value)} placeholder="Search help requests..." type="search" value={query} />
          </label>
          <span>{visibleRequests.length} requests</span>
        </div>
        {visibleRequests.length === 0 ? (
          <div className="admin-empty-state"><h2>No help requests</h2><p>New candidate requests will appear here.</p></div>
        ) : (
          <div className="admin-support-layout">
            <div className="admin-support-list">
              {visibleRequests.map((request) => (
                <button className={selected?.id === request.id ? "is-active" : ""} key={request.id} onClick={() => setSelectedId(request.id)} type="button">
                  <span><strong>{request.subject}</strong><small>{request.requester_name || request.requester_email}</small></span>
                  <small>{request.status.replace("_", " ")}</small>
                </button>
              ))}
            </div>
            {selected && <SupportRequestDetail key={`${selected.id}:${selected.updated_at}`} onUpdate={onUpdate} request={selected} working={working} />}
          </div>
        )}
      </section>
    </>
  );
}

export default function Admin() {
  const [searchParams] = useSearchParams();
  const { moduleId: routeModuleId, setId: routeSetId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const selectedModuleId = routeModuleId ?? searchParams.get("module");
  const selectedSetId = routeSetId ?? searchParams.get("set");
  const currentView = location.pathname === "/admin/activity" || searchParams.get("view") === "activity"
    ? "activity"
    : location.pathname === "/admin/help" || searchParams.get("view") === "support"
      ? "support"
    : location.pathname === "/admin/guide" || searchParams.get("view") === "guide"
      ? "guide"
      : "modules";

  const [modules, setModules] = useState([]);
  const [practiceSets, setPracticeSets] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [validation, setValidation] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [supportRequests, setSupportRequests] = useState([]);
  const [practiceSetsModuleId, setPracticeSetsModuleId] = useState(null);
  const [contentKey, setContentKey] = useState(null);
  const [validationKey, setValidationKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [replacementPublishHints, setReplacementPublishHints] = useState(() => new Set());
  const [moduleEditor, setModuleEditor] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [shellSearch, setShellSearch] = useState("");
  const selectedModule = modules.find((module) => module.subject_id === selectedModuleId) ?? null;
  const selectedSet = practiceSets.find((practiceSet) => practiceSet.practice_set_id === selectedSetId) ?? null;
  const routePracticeType = selectedSet?.practice_type
    ?? selectedModule?.practice_type
    ?? (selectedModule ? "objective" : null);
  const routeContentKey = selectedSetId && routePracticeType
    ? `${selectedSetId}:${routePracticeType}`
    : null;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  useEffect(() => {
    let active = true;

    async function loadAdmin() {
      try {
        const [nextModules, nextAuditLogs] = await Promise.all([
          getAdminContentModules(),
          getAdminAuditLogs(),
        ]);

        if (!active) return;
        setModules(nextModules);
        setAuditLogs(nextAuditLogs);
      } catch (error) {
        if (!active) return;
        logAppError("Admin content load", error);
        setFeedback({ tone: "error", message: friendlyErrorMessage(error, "We could not load the content manager.") });
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadAdmin();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (currentView !== "support") return undefined;
    let active = true;

    getAdminSupportRequests(100)
      .then((rows) => {
        if (active) setSupportRequests(rows);
      })
      .catch((error) => {
        if (!active) return;
        logAppError("Admin support requests load", error);
        setFeedback({ tone: "error", message: friendlyErrorMessage(error, "Help requests could not be loaded.") });
      });

    return () => { active = false; };
  }, [currentView]);

  useEffect(() => {
    let active = true;

    if (!selectedModuleId) {
      return () => { active = false; };
    }

    getAdminPracticeSets(selectedModuleId)
      .then((rows) => {
        if (!active) return;
        setPracticeSets(rows);
        setPracticeSetsModuleId(selectedModuleId);
      })
      .catch((error) => {
        if (!active) return;
        logAppError("Admin practice sets load", error);
        setPracticeSets([]);
        setPracticeSetsModuleId(selectedModuleId);
        setFeedback({ tone: "error", message: friendlyErrorMessage(error, "We could not load this module's practice sets.") });
      });

    return () => { active = false; };
  }, [selectedModuleId]);

  useEffect(() => {
    let active = true;

    if (!selectedSetId) {
      return () => { active = false; };
    }

    if (!routePracticeType) return () => { active = false; };

    getAdminQuestions(selectedSetId, routePracticeType)
      .then((nextQuestions) => {
        if (!active) return;
        setQuestions(nextQuestions);
        setContentKey(`${selectedSetId}:${routePracticeType}`);
      })
      .catch((error) => {
        if (!active) return;
        logAppError("Admin practice set content load", error);
        setQuestions([]);
        setContentKey(`${selectedSetId}:${routePracticeType}`);
        setFeedback({ tone: "error", message: friendlyErrorMessage(error, "We could not load this practice set's questions.") });
      });

    getAdminPracticeSetValidation(selectedSetId)
      .then((nextValidation) => {
        if (!active) return;
        setValidation(nextValidation);
        setValidationKey(selectedSetId);
      })
      .catch((error) => {
        if (!active) return;
        logAppError("Admin practice set validation load", error);
        setValidation({
          ready: false,
          errors: ["Readiness checks could not be loaded. Refresh before changing this set's status."],
        });
        setValidationKey(selectedSetId);
      });

    return () => { active = false; };
  }, [routePracticeType, selectedSetId]);

  const moduleContentLoading = Boolean(selectedModuleId && practiceSetsModuleId !== selectedModuleId);
  const setContentLoading = Boolean(routeContentKey && contentKey !== routeContentKey);
  const shellSearchPlaceholder = currentView === "activity"
    ? "Search activity..."
    : currentView === "support"
      ? "Search help requests..."
    : currentView === "guide"
      ? "Search guide..."
      : selectedSet
        ? "Search questions..."
        : selectedModule
          ? "Search practice sets..."
          : "Search modules...";

  function navigateWithinAdmin(destination) {
    setShellSearch("");
    navigate(destination);
  }

  function reportError(scope, error, fallback) {
    logAppError(scope, error);
    setFeedback({ tone: "error", message: adminErrorMessage(error, fallback) });
  }

  async function handleSupportUpdate(requestId, status, resolutionNote) {
    setWorking(true);
    try {
      const updated = await updateSupportRequest(requestId, status, resolutionNote);
      setSupportRequests((current) => current.map((request) => request.id === requestId ? { ...request, ...updated } : request));
      setFeedback({ tone: "success", message: "Help request updated." });
    } catch (error) {
      reportError("Admin support request update", error, "The help request could not be updated.");
    } finally {
      setWorking(false);
    }
  }

  async function refreshModules() {
    const nextModules = await getAdminContentModules();
    setModules(nextModules);
    return nextModules;
  }

  async function refreshPracticeSets(subjectId = selectedModuleId) {
    if (!subjectId) return [];
    const nextSets = await getAdminPracticeSets(subjectId);
    setPracticeSets(nextSets);
    setPracticeSetsModuleId(subjectId);
    return nextSets;
  }

  async function refreshSetContent(setId = selectedSetId) {
    if (!setId) return;
    const practiceType = practiceSets.find((practiceSet) => practiceSet.practice_set_id === setId)?.practice_type
      ?? selectedModule?.practice_type
      ?? "objective";
    const [nextQuestions, nextValidation] = await Promise.all([
      getAdminQuestions(setId, practiceType),
      getAdminPracticeSetValidation(setId),
    ]);
    setQuestions(nextQuestions);
    setValidation(nextValidation);
    setContentKey(`${setId}:${practiceType}`);
    setValidationKey(setId);
  }

  async function refreshAudit() {
    setAuditLogs(await getAdminAuditLogs());
  }

  async function handleSaveModule(module) {
    if (module.subject_id && module.lifecycle_status === "retired" && selectedModule?.lifecycle_status !== "retired") {
      requestConfirmation({
        title: "Retire this module permanently?",
        body: `This stops all new practice and sales for the module. ${formatCount(selectedModule.active_entitlement_count)} existing entitlements and all candidate history will be preserved. Retire individual practice sets separately if needed.`,
        label: "Retire module",
        tone: "danger",
        reasonLabel: "Reason for module retirement",
        reasonRequired: true,
        action: async ({ reason }) => {
          await updateAdminModule({
            ...module,
            lifecycle_status: selectedModule.lifecycle_status,
            available_for_purchase: selectedModule.available_for_purchase,
          });
          await updateAdminModuleLifecycle(module.subject_id, "retired", reason);
          await updateAdminModuleSalesAvailability(module.subject_id, false);
          await Promise.all([refreshModules(), refreshAudit()]);
          setModuleEditor(null);
          setFeedback({ tone: "success", message: "Module retired. Existing entitlements and history were preserved." });
        },
      });
      return;
    }

    setWorking(true);
    try {
      if (module.subject_id) {
        await updateAdminModule({
          ...module,
          lifecycle_status: selectedModule.lifecycle_status,
          available_for_purchase: selectedModule.available_for_purchase,
        });
        await updateAdminModuleLifecycle(module.subject_id, module.lifecycle_status);
        await updateAdminModuleAvailability(module.subject_id, module.candidate_availability);
        await updateAdminModuleSalesAvailability(module.subject_id, module.available_for_purchase);
        setFeedback({ tone: "success", message: "Module settings saved." });
      } else {
        const created = await createAdminModule(module);
        setFeedback({ tone: "success", message: `${created.name} was created as a private draft.` });
      }
      await Promise.all([refreshModules(), refreshAudit()]);
      setModuleEditor(null);
    } catch (error) {
      reportError("Admin save module", error, "We could not save this module.");
    } finally {
      setWorking(false);
    }
  }

  async function handleCreateSet({ expectedCount, sourceSetId }, closeCreator) {
    setSectionLoading(true);
    try {
      const createdSet = sourceSetId
        ? await createAdminPracticeSetReplacement(sourceSetId, false)
        : await createAdminPracticeSet(selectedModuleId, expectedCount);
      await Promise.all([refreshModules(), refreshPracticeSets(), refreshAudit()]);
      closeCreator();
      setFeedback({
        tone: "success",
        message: sourceSetId
          ? `A new empty version of Practice set ${createdSet.set_number} was created as a draft.`
          : `Practice set ${createdSet.set_number} was created as a draft.`,
      });
      navigateWithinAdmin(`/admin/modules/${selectedModuleId}/sets/${createdSet.id}`);
    } catch (error) {
      reportError("Admin create practice set", error, "We could not create the practice set.");
    } finally {
      setSectionLoading(false);
    }
  }

  async function handleSaveQuestion(mode, question, closeEditor) {
    setWorking(true);
    try {
      if (mode === "correction") {
        if (question.supersedes_question_id) {
          await updateAdminQuestionRevision(question, selectedModule.practice_type);
          setFeedback({ tone: "success", message: "The pending correction was updated." });
        } else {
          await createAdminQuestionRevision(question, selectedModule.practice_type);
          setFeedback({ tone: "success", message: "Correction saved for review. The live question is unchanged." });
        }
      } else {
        await saveAdminQuestion(question, selectedModule.practice_type);
        setFeedback({ tone: "success", message: question.id ? "Question saved." : "Question added to the draft set." });
      }
      await Promise.all([refreshSetContent(), refreshPracticeSets(), refreshModules()]);
      closeEditor();
    } catch (error) {
      reportError("Admin save question", error, "We could not save this question.");
    } finally {
      setWorking(false);
    }
  }

  async function handleImport(importedQuestions, metadata, mode = "append") {
    setWorking(true);
    try {
      const result = await importAdminQuestions(selectedSetId, importedQuestions, metadata, selectedModule.practice_type, mode);
      await Promise.all([refreshSetContent(), refreshPracticeSets(), refreshModules(), refreshAudit()]);
      setFeedback({
        tone: "success",
        message: mode === "replace"
          ? `Draft questions replaced. The set now has ${result.final_count} questions.`
          : `${result.imported_count} questions were imported into this set.`,
      });
      return true;
    } catch (error) {
      reportError("Admin import questions", error, "The questions were not imported. No partial import was saved.");
      return false;
    } finally {
      setWorking(false);
    }
  }

  function requestConfirmation(config) {
    setConfirmDialog(config);
  }

  async function runConfirmedAction(values) {
    if (!confirmDialog?.action) return;
    setWorking(true);
    try {
      await confirmDialog.action(values ?? {});
      setConfirmDialog(null);
    } catch (error) {
      reportError("Admin confirmed action", error, "We could not complete that action.");
    } finally {
      setWorking(false);
    }
  }

  function handleTransition(status) {
    const copy = {
      draft: {
        title: "Return this set to draft?",
        body: "Questions will leave review and can be edited again.",
        label: "Return to draft",
      },
      review: {
        title: "Send this set to review?",
        body: "All draft questions will be marked ready for final review.",
        label: "Send to review",
      },
      published: {
        title: "Publish this practice set?",
        body: "Candidates with module access will be able to start this set immediately. Sales availability will not change.",
        label: "Publish practice set",
      },
    }[status];

    requestConfirmation({
      ...copy,
      action: async () => {
        try {
          await transitionAdminPracticeSet(selectedSetId, status);
        } catch (error) {
          if (status === "published" && isReplacementPublishError(error)) {
            setReplacementPublishHints((current) => new Set(current).add(selectedSetId));
            setFeedback({ tone: "error", message: "This reviewed set is a replacement version. Use Publish replacement to retire the old version atomically." });
            return;
          }
          throw error;
        }
        await Promise.all([refreshSetContent(), refreshPracticeSets(), refreshModules(), refreshAudit()]);
        setFeedback({
          tone: "success",
          message: status === "published"
            ? "Practice set published. Use module settings when you are ready to change sales availability."
            : `Practice set ${statusLabel(status).toLowerCase()}.`,
        });
      },
    });
  }

  function handleLifecycleAction(action) {
    const impact = `${formatCount(selectedSet.in_progress_attempt_count)} in-progress and ${formatCount(selectedSet.completed_attempt_count)} completed attempts are attached to this version.`;
    const configs = {
      withdraw: {
        title: "Withdraw this practice set temporarily?",
        body: `This will stop new candidates from starting this set. Existing attempts, completed results, and reviews will remain available. You can republish this unchanged version later. ${impact}`,
        label: "Withdraw temporarily",
        action: async () => {
          await withdrawAdminPracticeSet(selectedSetId);
          setFeedback({ tone: "success", message: "Practice set withdrawn. Candidate access and history are unchanged." });
        },
      },
      republish: {
        title: "Republish this unchanged version?",
        body: "New eligible attempts will use this exact version again. No questions or historical results will be changed.",
        label: "Republish unchanged",
        action: async () => {
          await republishAdminPracticeSet(selectedSetId);
          setFeedback({ tone: "success", message: "The unchanged practice-set version is published again." });
        },
      },
      create_replacement: {
        title: selectedSet.status === "archived" ? "Create a new version of this retired set?" : "Create a corrected replacement?",
        body: selectedSet.status === "archived"
          ? `A new editable Practice set ${selectedSet.set_number} will be created. This retired version and all historical attempts remain unchanged.`
          : "A new editable version will be created. The current version will remain unchanged until the replacement is reviewed and published.",
        label: selectedSet.status === "archived" ? "Create new version" : "Create replacement",
        choiceLabel: "Replacement content",
        choices: [
          { value: "copy", label: "Copy existing questions", description: "Start with the current version, then correct only what changed." },
          { value: "empty", label: "Start empty", description: "Create a blank replacement for a complete reupload." },
        ],
        action: async ({ choice }) => {
          const replacement = await createAdminPracticeSetReplacement(selectedSetId, choice !== "empty");
          await Promise.all([refreshPracticeSets(), refreshModules(), refreshAudit()]);
          navigateWithinAdmin(`/admin/modules/${selectedModuleId}/sets/${replacement.id}`);
          setFeedback({
            tone: "success",
            message: selectedSet.status === "archived"
              ? `A new version of Practice set ${selectedSet.set_number} was created as a draft.`
              : "Replacement draft created. The current candidate version is unchanged.",
          });
        },
      },
      publish_replacement: {
        title: "Publish this replacement?",
        body: `This will retire the current version and publish this reviewed replacement. New attempts will use the replacement. Existing attempts and historical reviews will remain attached to the old version. ${impact}`,
        label: "Publish replacement",
        action: async () => {
          await publishAdminPracticeSetReplacement(selectedSetId);
          setReplacementPublishHints((current) => {
            const next = new Set(current);
            next.delete(selectedSetId);
            return next;
          });
          setFeedback({ tone: "success", message: "Replacement published. The previous version is preserved as retired history." });
        },
      },
      retire: {
        title: "Retire this version permanently?",
        body: `This permanently closes this version to new candidates. Existing attempts and reviews will remain available. This version cannot be restored through the normal admin interface. ${impact}`,
        label: "Retire permanently",
        tone: "danger",
        reasonLabel: "Reason for retirement",
        reasonRequired: true,
        action: async ({ reason }) => {
          await retireAdminPracticeSet(selectedSetId, reason);
          setFeedback({ tone: "success", message: "Practice-set version retired permanently. Historical attempts remain available." });
        },
      },
    };

    requestConfirmation({
      ...configs[action],
      action: async (values) => {
        await configs[action].action(values);
        if (action !== "create_replacement") {
          await Promise.all([refreshSetContent(), refreshPracticeSets(), refreshModules(), refreshAudit()]);
        }
      },
    });
  }

  function handleDeleteQuestion(question) {
    requestConfirmation({
      title: "Remove this question?",
      body: "It will leave this practice set. If it appears in a past attempt, its historical review will be preserved.",
      label: "Remove question",
      tone: "danger",
      action: async () => {
        await deleteDraftAdminQuestion(question.id, selectedModule.practice_type);
        await Promise.all([refreshSetContent(), refreshPracticeSets(), refreshModules(), refreshAudit()]);
        setFeedback({ tone: "success", message: "The question was removed. Historical reviews remain unchanged." });
      },
    });
  }

  function handleArchiveQuestion(question) {
    requestConfirmation({
      title: "Discard this correction?",
      body: "This unpublished correction draft will be discarded. The currently published question will not change.",
      label: "Discard correction",
      tone: "danger",
      action: async () => {
        await archiveAdminQuestion(question.id, selectedModule.practice_type);
        await Promise.all([refreshSetContent(), refreshAudit()]);
        setFeedback({ tone: "success", message: "The pending correction was discarded." });
      },
    });
  }

  function handlePublishCorrection(questionId) {
    requestConfirmation({
      title: "Publish this correction?",
      body: "The corrected version will become live. The previous version will stay attached to historical attempts.",
      label: "Publish correction",
      action: async () => {
        await publishAdminQuestionRevision(questionId, selectedModule.practice_type);
        await Promise.all([refreshSetContent(), refreshPracticeSets(), refreshAudit()]);
        setFeedback({ tone: "success", message: "The correction is now live. Historical reviews were preserved." });
      },
    });
  }

  function handleDeleteModule() {
    requestConfirmation({
      title: "Delete this unused module?",
      body: "The empty module and its inactive price record will be removed permanently.",
      label: "Delete module",
      tone: "danger",
      action: async () => {
        await deleteEmptyAdminModule(selectedModuleId);
        await Promise.all([refreshModules(), refreshAudit()]);
        navigateWithinAdmin("/admin");
        setFeedback({ tone: "success", message: "The unused module was deleted." });
      },
    });
  }

  function handleDeleteSet() {
    requestConfirmation({
      title: "Delete this unused draft?",
      body: "This permanently deletes this unpublished and unused set and its questions.",
      label: "Delete unused draft",
      tone: "danger",
      action: async () => {
        await deleteEmptyAdminPracticeSet(selectedSetId);
        await Promise.all([refreshPracticeSets(), refreshModules(), refreshAudit()]);
        navigateWithinAdmin(`/admin/modules/${selectedModuleId}`);
        setFeedback({ tone: "success", message: "The unused draft was deleted." });
      },
    });
  }

  async function handleSaveExpectedCount(expectedCount) {
    setWorking(true);
    try {
      await updateAdminPracticeSet(selectedSetId, expectedCount);
      await Promise.all([refreshSetContent(), refreshPracticeSets(), refreshAudit()]);
      setFeedback({ tone: "success", message: "Expected question count updated." });
    } catch (error) {
      reportError("Admin update practice set", error, "We could not update the expected question count.");
    } finally {
      setWorking(false);
    }
  }

  async function handleAdminSignOut() {
    setWorking(true);
    setFeedback(null);

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      navigate("/", { replace: true });
    } catch (error) {
      reportError("Admin sign out", error, "We could not sign you out. Please try again.");
    } finally {
      setWorking(false);
    }
  }

  if (loading) return <LoadingState fullPage />;

  return (
    <main className="admin-shell admin-content-manager">
      <div className="admin-workspace">
        <AdminRail
          currentView={currentView}
          navigate={navigateWithinAdmin}
        />

        <div className="admin-stage">
          <header className="admin-topbar">
            <label className="admin-shell-search">
              <span className="sr-only">Search current admin view</span>
              <input
                type="search"
                value={shellSearch}
                onChange={(event) => setShellSearch(event.target.value)}
                placeholder={shellSearchPlaceholder}
              />
            </label>
            <div className="admin-topbar-context">
              <span className="admin-topbar-avatar" aria-hidden="true">A</span>
              <span className="admin-topbar-label">Admin</span>
              <button className="admin-signout-button" disabled={working} onClick={() => void handleAdminSignOut()} type="button">
                {working ? "Please wait" : "Sign out"}
              </button>
            </div>
          </header>

          <AdminFeedback feedback={feedback} onDismiss={() => setFeedback(null)} />

          <div className="admin-page">
            {currentView === "activity" ? (
              <ActivityView auditLogs={auditLogs} query={shellSearch} onQueryChange={setShellSearch} />
            ) : currentView === "support" ? (
              <AdminSupportView onQueryChange={setShellSearch} onUpdate={(...args) => void handleSupportUpdate(...args)} query={shellSearch} requests={supportRequests} working={working} />
            ) : currentView === "guide" ? (
              <AdminGuideView query={shellSearch} />
            ) : selectedSetId && selectedModule && moduleContentLoading ? (
              <LoadingState />
            ) : selectedSetId && selectedModule && !selectedSet ? (
              <section className="admin-empty-state">
                <h1>Practice set unavailable</h1>
                <p>It may have been removed or the link may be out of date.</p>
                <button type="button" onClick={() => navigateWithinAdmin(`/admin/modules/${selectedModuleId}`)}>Back to module</button>
              </section>
            ) : selectedSetId && selectedModule && selectedSet ? (
              <PracticeSetWorkspace
                key={`${selectedSet.practice_set_id}:${selectedSet.expected_question_count}`}
                loading={sectionLoading || setContentLoading}
                module={selectedModule}
                practiceSet={selectedSet}
                questions={setContentLoading ? [] : questions}
                onQueryChange={setShellSearch}
                query={shellSearch}
                validation={validationKey === selectedSetId ? validation : null}
                working={working}
                onArchiveQuestion={handleArchiveQuestion}
                onBack={() => navigateWithinAdmin(`/admin/modules/${selectedModuleId}`)}
                onDeleteQuestion={handleDeleteQuestion}
                onDeleteSet={handleDeleteSet}
                forceReplacementPublish={replacementPublishHints.has(selectedSetId)}
                onImport={handleImport}
                onLifecycleAction={handleLifecycleAction}
                onPublishCorrection={handlePublishCorrection}
                onSaveExpectedCount={handleSaveExpectedCount}
                onSaveQuestion={handleSaveQuestion}
                onTransition={handleTransition}
              />
            ) : selectedModule ? (
              <ModuleWorkspace
                key={`${selectedModule.subject_id}:${selectedModule.batch_size}`}
                loading={sectionLoading || moduleContentLoading}
                module={selectedModule}
                practiceSets={practiceSets}
                query={shellSearch}
                onBack={() => navigateWithinAdmin("/admin")}
                onCreateSet={handleCreateSet}
                onDelete={handleDeleteModule}
                onEdit={setModuleEditor}
                onOpenSet={(setId) => navigateWithinAdmin(`/admin/modules/${selectedModuleId}/sets/${setId}`)}
              />
            ) : selectedModuleId ? (
              <section className="admin-empty-state">
                <h1>Module unavailable</h1>
                <p>It may have been removed or the link may be out of date.</p>
                <button type="button" onClick={() => navigateWithinAdmin("/admin")}>Back to content</button>
              </section>
            ) : (
              <ModuleCatalogue
                modules={modules}
                query={shellSearch}
                onCreate={() => setModuleEditor({})}
                onManage={(id) => navigateWithinAdmin(`/admin/modules/${id}`)}
                onQueryChange={setShellSearch}
              />
            )}
          </div>
        </div>
      </div>

      {moduleEditor && (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={working ? undefined : () => setModuleEditor(null)}>
          <section className="admin-module-dialog" role="dialog" aria-modal="true" aria-label={moduleEditor.subject_id ? "Edit module" : "Create module"} onMouseDown={(event) => event.stopPropagation()}>
            <AdminModuleForm
              key={moduleEditor.subject_id ?? "new-module"}
              module={moduleEditor.subject_id ? moduleEditor : null}
              saving={working}
              onCancel={() => setModuleEditor(null)}
              onSubmit={handleSaveModule}
            />
          </section>
        </div>
      )}

      <AdminConfirmDialog
        key={confirmDialog?.title ?? "closed-confirmation"}
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        confirmLabel={confirmDialog?.label}
        choiceLabel={confirmDialog?.choiceLabel}
        choices={confirmDialog?.choices}
        reasonLabel={confirmDialog?.reasonLabel}
        reasonRequired={confirmDialog?.reasonRequired}
        tone={confirmDialog?.tone}
        busy={working}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={runConfirmedAction}
      >
        <p>{confirmDialog?.body}</p>
      </AdminConfirmDialog>
    </main>
  );
}
