import { useState } from "react";

const ADMIN_GUIDE_QUICK_START = [
  "Create the module first.",
  "Add a practice set inside the module.",
  "Add or import questions while the set is still in Draft.",
  "Resolve every readiness issue before review or publication.",
  "Use Correct for published questions instead of editing them like drafts.",
];

const ADMIN_GUIDE_TASKS = [
  {
    title: "Create a module",
    steps: [
      "Open Content and select Create module.",
      "Enter the module name, status, defaults, and price.",
      "Save the module, then open it to start adding practice sets.",
    ],
  },
  {
    title: "Publish a practice set",
    steps: [
      "Open the target module and practice set.",
      "Add or import the full question set while it is still in Draft.",
      "Check question positions, explanations, and answer options before review.",
      "Clear every readiness issue, then send the set for review.",
      "Publish the set only when it is fully ready and ordered correctly.",
    ],
  },
  {
    title: "Import questions",
    steps: [
      "Open the draft or review practice set and select Upload questions.",
      "Download the template instead of creating the file from memory.",
      "Keep the rows in the same order you want candidates to see if you are relying on automatic positions.",
      "Upload the file, review the preview, and fix every blocked row.",
      "Confirm the import only when the preview is clean.",
    ],
  },
  {
    title: "Correct a published question",
    steps: [
      "Open the published question and select Correct.",
      "Edit and save the correction version.",
      "Preview it carefully, then publish the correction when it is ready.",
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
      "Questions per practice set and Pass mark become the defaults for new practice sets in that module.",
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
      "Published sets are for live candidate use. Archived sets preserve history but should not start new attempts.",
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
      "Archived: preserved for history and unavailable for new use.",
    ],
  },
  {
    id: "readiness",
    title: "Readiness checks",
    intro: "A set should pass every readiness check before it is published.",
    items: [
      "The exact expected number of questions must be present.",
      "Each question position must be valid and not repeated.",
      "Every question needs four distinct answer options and one valid correct answer.",
      "Every question should include an explanation before publication.",
      "Duplicate question text in the same set should be resolved before moving forward.",
    ],
  },
  {
    id: "questions",
    title: "Questions",
    intro: "Questions should be written exactly as candidates will see them.",
    items: [
      "Question position controls the order inside the practice set.",
      "Fill all four answer options and choose the correct answer letter.",
      "Explanation describes why the correct answer is right.",
      "Reference is the source, rule, chapter, or authority.",
      "Internal source note is for internal admin traceability only.",
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
      "Published question corrections keep the live question's place in the set. They are not used to rearrange the set.",
    ],
  },
  {
    id: "corrections",
    title: "Corrections",
    intro: "Do not directly rewrite a published question. Use the correction workflow.",
    items: [
      "Open the published question and select Correct.",
      "Edit and save the correction version.",
      "Preview the correction before publishing it.",
      "Publish the correction only when it has been reviewed.",
      "Historical candidate attempts remain attached to the original version they answered.",
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
      "Provide four distinct answer options and set the correct answer letter to A, B, C, or D.",
      "Check that the correct answer letter matches the actual correct option text.",
      "The file can contain up to 200 questions and must be 5 MB or smaller.",
      "The template supports a position column so you can control question order before upload.",
      "Keep positions unique and in the final order you want candidates to see.",
      "Imports are previewed before saving.",
      "If one row fails validation, the import is blocked until every issue is fixed.",
    ],
  },
  {
    id: "publishing",
    title: "Publishing checklist",
    intro: "Before publishing a practice set, confirm the content and order carefully.",
    items: [
      "Make sure the expected number of questions is present.",
      "Confirm every question position is correct and there are no duplicates.",
      "Check that each question has four distinct answer options.",
      "Check that the correct answer is set correctly for every question.",
      "Make sure every question explanation is present and readable.",
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
      "Review imports, updates, publishes, corrections, and archives.",
      "Use the filters to narrow the log by action type.",
      "Open an entry to inspect the recorded details.",
    ],
  },
  {
    id: "safe-actions",
    title: "Archive, delete, and stop sales",
    intro: "These actions are not interchangeable.",
    items: [
      "Turn off Available for purchase to stop new sales without removing existing access.",
      "Archive when content should no longer be used for new candidate activity but history must remain.",
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
      "If a module cannot retire, stop new sales and review whether active access still exists.",
      "If a published question needs a change, use Correct instead of trying to edit it like a draft question.",
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
