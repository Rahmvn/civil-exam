import { useState } from "react";

const ADMIN_GUIDE_QUICK_START = [
  "Create the module first.",
  "Add a practice set inside the module.",
  "Add or import questions while the set is still in Draft.",
  "Resolve every readiness issue before review or publication.",
  "Create a replacement version when published content needs correction.",
];

const ADMIN_GUIDE_TASKS = [
  {
    title: "Create a module",
    steps: [
      "Open Content and select Create module.",
      "Choose Objective or Oral practice. This cannot be changed after practice sets are created.",
      "Enter the module name, status, defaults, and price.",
      "Save the module, then open it to start adding practice sets.",
    ],
  },
  {
    title: "Publish a practice set",
    steps: [
      "Open the target module and practice set.",
      "Add or import the full question set while it is still in Draft.",
      "Check question positions, answer options, and any optional guidance before review.",
      "Clear every readiness issue, then send the set for review.",
      "Publish the set only when it is fully ready and ordered correctly.",
    ],
  },
  {
    title: "Prepare an oral set",
    steps: [
      "Choose Oral practice when creating the module. The type cannot be changed after practice sets exist.",
      "Add a practice set and set its required question count.",
      "Use the oral template or Add one question. Do not use A-D options or correct-answer letters.",
      "For every prompt, provide a complete model answer and at least one distinct key point.",
      "Check the position order and preview the answer guidance before review and publication.",
    ],
  },
  {
    title: "Import questions",
    steps: [
      "Open the draft or review practice set and select Upload questions.",
      "Download the template instead of creating the file from memory.",
      "Choose Validate only, Append, or Replace all before selecting the file.",
      "Upload the file and review the current, imported, and final question counts.",
      "Fix every blocked row, then confirm Append or Replace all only when the preview is clean.",
    ],
  },
  {
    title: "Correct a published set",
    steps: [
      "Open the published set and select Create corrected replacement.",
      "Copy the current questions or start with an empty draft, then make the required corrections.",
      "Review the complete replacement and publish it only when it is ready.",
      "Publishing switches new attempts to the replacement and retires the old version without changing candidate history.",
    ],
  },
];

const ADMIN_GUIDE_SECTIONS = [
  {
    id: "modules",
    title: "Modules",
    intro: "A module is a subject area such as English Language or Public Service Rules.",
    items: [
      "Create a module before adding practice content.",
      "Module position controls where the module appears in the module list. Lower numbers appear earlier.",
      "Objective modules use automatic scoring. Oral modules use timed written responses and self-review.",
      "Questions per practice set becomes the default target for new sets. Pass mark applies only to objective modules.",
      "Module price affects future purchases only.",
      "Available for purchase controls new sales only. It does not remove existing access.",
    ],
  },
  {
    id: "module-status",
    title: "Module statuses",
    intro: "Use the module status that matches the current stage of the content.",
    items: [
      "Draft: private to administrators and best for unfinished work.",
      "Coming soon: visible before the module is ready for active use.",
      "Active: ready for real use and can be sold when purchase is enabled.",
      "Retired: no longer part of the active catalogue.",
    ],
  },
  {
    id: "sets",
    title: "Practice sets",
    intro: "A module can contain multiple numbered practice sets. Set numbers are assigned automatically.",
    items: [
      "Create a set from the module page and enter the target question count.",
      "Use Add question for manual entry and Upload questions for prepared files.",
      "A set should be complete before it moves to review or publication.",
      "Published sets are for live candidate use. Withdrawn sets are temporarily paused; retired sets are permanent historical records.",
    ],
  },
  {
    id: "set-status",
    title: "Practice set statuses",
    intro: "Practice sets move through a publishing workflow.",
    items: [
      "Draft: add, edit, import, or remove questions.",
      "In review: final check stage before publication.",
      "Published: live for candidates and no longer edited directly.",
      "Withdrawn: temporarily unavailable for new attempts and can be republished unchanged.",
      "Retired: permanently unavailable for new attempts and cannot be reopened.",
    ],
  },
  {
    id: "readiness",
    title: "Readiness checks",
    intro: "A set should pass every readiness check before it is published.",
    items: [
      "The exact expected number of questions must be present.",
      "Each question position must be valid and not repeated.",
      "Objective questions need four distinct options and one valid correct answer. Explanation and reference are optional.",
      "Oral questions need a complete model answer and at least one distinct key point.",
      "Duplicate question text in the same set should be resolved before moving forward.",
    ],
  },
  {
    id: "questions",
    title: "Questions",
    intro: "Question fields change automatically to match the module type.",
    items: [
      "Question position controls the order inside the practice set.",
      "For objective questions, fill four options and select the correct answer. Add an explanation only when it is useful.",
      "For oral questions, provide the prompt, complete model answer, and the essential key points.",
      "Candidates do not see oral model answers or key points until the full practice is complete.",
      "Reference is an optional source, rule, chapter, or authority for objective and oral questions.",
      "Internal source note is for internal admin traceability only.",
    ],
  },
  {
    id: "oral-practice",
    title: "Oral practice",
    intro: "Oral modules use timed written responses followed by candidate self-review, not automatic marking.",
    items: [
      "Choose Oral practice only for open-response prompts. The module type cannot be changed after practice sets are created.",
      "Oral questions do not use answer options, correct-answer letters, explanations, pass marks, or automatic scores.",
      "Every prompt needs a complete model answer and at least one distinct key point. Add a reliable reference whenever one is available.",
      "Admins choose whether candidates may use three minutes, five minutes, or either option per oral question.",
      "A candidate can submit early or let the timer expire. Either action moves to the next question, and earlier questions cannot be reopened.",
      "Model answers and key points stay hidden until the candidate completes the full set, then support self-review.",
      "Use the oral CSV, Excel, or JSON structure. Never upload the objective A-D template into an oral set.",
      "Before publication, verify the exact question count, unique positions, prompt clarity, model-answer accuracy, and useful key points.",
      "Create a replacement set for published oral corrections so historical attempts remain attached to the version candidates received.",
    ],
  },
  {
    id: "arrangement",
    title: "Question order and arrangement",
    intro: "Question order should be deliberate and easy to review before publication.",
    items: [
      "Use simple ascending positions such as 1, 2, 3, 4, and continue without duplicates.",
      "Candidates see questions in position order, so confirm the order before review and publication.",
      "When adding questions manually, the next position is filled automatically from the current highest position.",
      "When importing, the position column controls the final order. If position is left blank, positions are assigned from the file order starting after the current last question.",
      "Do not reuse an existing position in the same practice set.",
      "Published content is rearranged only in a replacement draft; the live version remains unchanged until replacement publication.",
    ],
  },
  {
    id: "corrections",
    title: "Published corrections",
    intro: "Do not directly rewrite published questions. Replace the complete practice-set version.",
    items: [
      "Open the published set and select Create corrected replacement.",
      "Copy existing questions for a small correction or start empty for a full re-upload.",
      "Edit and import only inside the replacement draft, then send the complete set for review.",
      "Publishing the replacement atomically retires the old version and makes the new version current.",
      "Historical attempts, answers, scores, and reviews remain attached to the original version.",
    ],
  },
  {
    id: "imports",
    title: "Bulk import",
    intro: "Bulk import is the safest way to add a prepared batch of questions to a draft or review set.",
    items: [
      "Use one row for one question only.",
      "Supported formats are CSV, XLSX, and JSON.",
      "Use the admin template instead of creating columns from memory.",
      "Write the full question exactly as candidates should see it before you upload.",
      "Objective templates require four distinct options and a correct answer letter from A to D.",
      "Oral templates require model_answer and at least key_point_1. JSON uses a key_points array.",
      "The file can contain up to 200 questions and must be 5 MB or smaller.",
      "The template supports a position column so you can control question order before upload.",
      "Keep positions unique and in the final order you want candidates to see.",
      "Validate only checks the file and never writes questions.",
      "Append keeps existing questions and adds the imported rows.",
      "Replace all atomically replaces every question in an unpublished draft or review set.",
      "If one row fails validation, nothing from that import is saved.",
    ],
  },
  {
    id: "publishing",
    title: "Publishing checklist",
    intro: "Before publishing a practice set, confirm the content and order carefully.",
    items: [
      "Make sure the expected number of questions is present.",
      "Confirm every question position is correct and there are no duplicates.",
      "For objective sets, check options and correct answers. Review any explanation or reference that was supplied.",
      "For oral sets, check every model answer and key point for accuracy and completeness.",
      "Confirm oral prompts work within the candidate's three- or five-minute choice.",
      "Preview a sample of the set before publication if anything was recently imported or corrected.",
      "Use review as the final check stage, not as a storage state for unfinished work.",
    ],
  },
  {
    id: "labels",
    title: "Common labels",
    intro: "These labels appear often in the admin and should be read carefully.",
    items: [
      "Sets: total number of practice sets in the module.",
      "Published sets: number of practice sets currently published.",
      "Total attempts: total attempt records for that module, not unique users.",
      "Current access: currently active access records, not a simple sales count.",
    ],
  },
  {
    id: "activity",
    title: "Activity log",
    intro: "Use Activity to confirm what changed, who changed it, and when it happened.",
    items: [
      "Review imports, updates, publishes, withdrawals, replacements, and retirements.",
      "Use the filters to narrow the log by action type.",
      "Open an entry to inspect the recorded details.",
    ],
  },
  {
    id: "safe-actions",
    title: "Withdraw, retire, delete, and stop sales",
    intro: "These actions are not interchangeable.",
    items: [
      "Turn off Available for purchase to stop new sales without removing existing access.",
      "Withdraw a published set to pause new attempts temporarily; republish only if its content is unchanged.",
      "Retire a set when it must never be used for new attempts again.",
      "Delete only unused drafts or empty unused content.",
      "When unsure, preserve history and choose the safer action.",
    ],
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    intro: "Use these checks first when something does not move forward as expected.",
    items: [
      "If a set will not publish, review every readiness issue.",
      "If an import is blocked, fix the file and upload it again. Partial rows were not saved.",
      "Pausing candidate availability or stopping sales does not remove existing entitlements, results, or reviews.",
      "If published content needs a change, create a replacement instead of republishing or editing the live version.",
    ],
  },
];

function matchesGuideQuery(section, normalizedQuery) {
  if (!normalizedQuery) return true;

  const searchable = [section.title, section.intro, ...section.items]
    .join(" ")
    .toLowerCase();

  return searchable.includes(normalizedQuery);
}

export function AdminGuideView({ query }) {
  const [openSection, setOpenSection] = useState(ADMIN_GUIDE_SECTIONS[0]?.id ?? "");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSections = ADMIN_GUIDE_SECTIONS.filter((section) => matchesGuideQuery(section, normalizedQuery));

  return (
    <>
      <section className="admin-page-heading">
        <div>
          <h1>Admin guide</h1>
          <p>Start with the common tasks below, then open any section when you need more detail.</p>
        </div>
      </section>

      <section className="admin-guide-hero">
        <article className="admin-guide-intro">
          <h2>Quick start</h2>
          <ol className="admin-guide-quickstart">
            {ADMIN_GUIDE_QUICK_START.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </article>

        <article className="admin-guide-tasks">
          <h2>Common tasks</h2>
          <div className="admin-guide-task-list">
            {ADMIN_GUIDE_TASKS.map((task) => (
              <section className="admin-guide-task" key={task.title}>
                <h3>{task.title}</h3>
                <ol>
                  {task.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </article>
      </section>

      {visibleSections.length === 0 ? (
        <section className="admin-empty-state">
          <h2>No matching guide section</h2>
          <p>Try another search term.</p>
        </section>
      ) : (
        <section className="admin-guide-stack">
          {visibleSections.map((section) => (
            <details
              className="admin-guide-section"
              id={`admin-guide-${section.id}`}
              key={section.id}
              open={normalizedQuery ? true : openSection === section.id}
            >
              <summary
                onClick={(event) => {
                  if (normalizedQuery) return;
                  event.preventDefault();
                  setOpenSection((current) => (current === section.id ? "" : section.id));
                }}
              >
                {section.title}
              </summary>
              <div className="admin-guide-section-body">
                <p>{section.intro}</p>
                <ul className="admin-guide-list">
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </details>
          ))}
        </section>
      )}
    </>
  );
}
