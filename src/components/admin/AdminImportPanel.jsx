import { useRef, useState } from "react";
import {
  ADMIN_IMPORT_JSON_EXAMPLE,
  ADMIN_IMPORT_TEMPLATE,
  parseAdminImportFile,
} from "../../lib/adminContent";

const PREVIEW_PAGE_SIZE = 20;
const IMPORT_FORMATS = {
  csv: {
    label: "CSV",
    badge: "Recommended",
    description: "Best for a simple spreadsheet export or a file edited in plain text.",
    rules: [
      "Keep the first row as the column names.",
      "Put one full question on each row after the header.",
      "Save the file as `.csv`.",
    ],
    example: ADMIN_IMPORT_TEMPLATE,
  },
  excel: {
    label: "Excel",
    description: "Best if you want to work in Excel or Google Sheets and save the final file as `.xlsx`.",
    rules: [
      "Use the same columns as the CSV template in row 1.",
      "Put one full question on each spreadsheet row.",
      "Save the finished file as `.xlsx` before upload.",
    ],
    example: "A1 position\nB1 question_text\nC1 option_a\nD1 option_b\nE1 option_c\nF1 option_d\nG1 correct_answer\nH1 explanation\nI1 reference\nJ1 difficulty",
  },
  json: {
    label: "JSON",
    description: "Best for technical workflows or when another system is generating the question file for you.",
    rules: [
      "Use an array of question objects.",
      "Use one object for each question.",
      "Save the file as `.json`.",
    ],
    example: ADMIN_IMPORT_JSON_EXAMPLE,
  },
};

function downloadTemplate() {
  const blob = new Blob([ADMIN_IMPORT_TEMPLATE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "promotionsure-question-template.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function downloadJsonExample() {
  const blob = new Blob([ADMIN_IMPORT_JSON_EXAMPLE], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "promotionsure-question-example.json";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function AdminImportPanel({ questions, importing, onClose, onImport, presentation = "inline" }) {
  const inputRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [metadata, setMetadata] = useState(null);
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState([]);
  const [errors, setErrors] = useState([]);
  const [selectedFormat, setSelectedFormat] = useState("csv");

  const currentQuestions = questions.filter((question) => question.status !== "archived");
  const nextPosition = currentQuestions.reduce(
    (highest, question) => Math.max(highest, Number(question.batch_position ?? 0)),
    0,
  ) + 1;

  async function handleFile(event) {
    const file = event.target.files?.[0];
    setFileName(file?.name ?? "");
    setMetadata(null);
    setPage(0);
    setPreview([]);
    setErrors([]);

    if (!file) return;

    try {
      const result = await parseAdminImportFile(file, nextPosition);
      const existingPositions = new Set(currentQuestions.map((question) => Number(question.batch_position)));
      const existingTexts = new Set(currentQuestions.map((question) =>
        question.question_text.toLowerCase().replace(/\s+/g, " ").trim()));
      const conflictErrors = [];

      result.questions.forEach((question, index) => {
        if (existingPositions.has(question.batch_position)) {
          conflictErrors.push(`Row ${index + 2}: position ${question.batch_position} already exists in this practice set.`);
        }

        const normalizedText = question.question_text.toLowerCase().replace(/\s+/g, " ").trim();
        if (existingTexts.has(normalizedText)) {
          conflictErrors.push(`Row ${index + 2}: this question already exists in the practice set.`);
        }
      });

      setPreview(result.questions);
      setMetadata(result.metadata);
      setErrors([...result.errors, ...conflictErrors]);
    } catch (error) {
      setErrors([error.message || "We could not read that file."]);
    }
  }

  async function handleImport() {
    const imported = await onImport(preview, metadata);
    if (!imported) return;

    setFileName("");
    setMetadata(null);
    setPage(0);
    setPreview([]);
    setErrors([]);
    if (inputRef.current) inputRef.current.value = "";
    onClose?.();
  }

  const pageCount = Math.max(1, Math.ceil(preview.length / PREVIEW_PAGE_SIZE));
  const shownQuestions = preview.slice(page * PREVIEW_PAGE_SIZE, (page + 1) * PREVIEW_PAGE_SIZE);
  const activeFormat = IMPORT_FORMATS[selectedFormat];

  return (
    <section className={`admin-import-panel${presentation === "dialog" ? " is-dialog" : ""}`}>
      <div className="admin-import-heading">
        <div>
          <span className="admin-form-step">Bulk upload</span>
          <h2>Upload questions</h2>
          <p>Choose one format, prepare the file carefully, then review every row before saving.</p>
        </div>
        <div className="admin-inline-actions">
          <button className="ghost-button" type="button" onClick={downloadTemplate}>Download CSV template</button>
          <button className="ghost-button" type="button" onClick={downloadJsonExample}>Download JSON example</button>
          {onClose && <button className="link-button" type="button" onClick={onClose}>Close</button>}
        </div>
      </div>

      <section className="admin-import-formats" aria-label="Supported import formats">
        <div className="admin-import-format-picker" role="tablist" aria-label="Question import formats">
          {Object.entries(IMPORT_FORMATS).map(([key, format]) => (
            <button
              key={key}
              className={`admin-import-format-toggle${selectedFormat === key ? " is-active" : ""}`}
              type="button"
              role="tab"
              aria-selected={selectedFormat === key}
              onClick={() => setSelectedFormat(key)}
            >
              <span>{format.label}</span>
              {format.badge && <small>{format.badge}</small>}
            </button>
          ))}
        </div>

        <article className="admin-import-format-focus">
          <div className="admin-import-format-copy">
            <div className="admin-import-format-head">
              <strong>{activeFormat.label}</strong>
              {activeFormat.badge && <span>{activeFormat.badge}</span>}
            </div>
            <p>{activeFormat.description}</p>
            <ul>
              {activeFormat.rules.map((rule) => <li key={rule}>{rule}</li>)}
            </ul>
          </div>
          <pre className="admin-import-example"><code>{activeFormat.example}</code></pre>
        </article>
      </section>

      <section className="admin-import-workspace" aria-label="Upload workspace">
        <label className="admin-file-drop">
          <input ref={inputRef} accept=".csv,.xlsx,.json" type="file" onChange={handleFile} />
          <span className="admin-file-drop-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V7" />
              <path d="m8.5 10.5 3.5-3.5 3.5 3.5" />
              <path d="M5 18.5h14" />
            </svg>
          </span>
          <strong>{fileName || "Drop your file here"}</strong>
          <span className="admin-file-drop-action">{fileName ? "Choose a different file" : "Click to choose a CSV, Excel, or JSON file"}</span>
          <small>Maximum 200 questions and 5 MB. Excel should use the same columns as the CSV template. Nothing is saved until you confirm the import.</small>
        </label>

        <section className="admin-import-checklist" aria-label="Import preparation guide">
          <div>
            <strong>Before you upload</strong>
            <p>Check the essentials before you confirm the import.</p>
          </div>
          <ul>
            <li>Use one row for one question only.</li>
            <li>Write the full question and all four options exactly as candidates should see them.</li>
            <li>Set `correct_answer` to `A`, `B`, `C`, or `D` so it matches the right option.</li>
            <li>Use unique positions in the final order you want candidates to see.</li>
            <li>Review spelling, punctuation, explanations, and answer accuracy before confirming.</li>
          </ul>
        </section>
      </section>

      {errors.length > 0 && (
        <div className="admin-validation-list is-error" role="alert">
          <strong>{errors.length} {errors.length === 1 ? "item" : "items"} to fix before importing</strong>
          <ul>
            {errors.map((error, index) => <li key={`${index}-${error}`}>{error}</li>)}
          </ul>
        </div>
      )}

      {preview.length > 0 && (
        <div className="admin-import-preview">
          <div className="admin-import-preview-head">
            <div>
              <strong>{preview.length} questions found</strong>
              <span>{errors.length === 0 ? "All rows passed the initial checks" : "Import is blocked until every issue is fixed"}</span>
            </div>
            <span>Rows {page * PREVIEW_PAGE_SIZE + 1}-{Math.min((page + 1) * PREVIEW_PAGE_SIZE, preview.length)} of {preview.length}</span>
          </div>
          <div className="admin-import-preview-table" role="table" aria-label="Questions ready to import">
            <div className="admin-import-preview-row is-heading" role="row">
              <span role="columnheader">Position</span>
              <span role="columnheader">Question</span>
              <span role="columnheader">Answer</span>
            </div>
            {shownQuestions.map((question) => (
              <div className="admin-import-preview-row" role="row" key={`${question.batch_position}-${question.question_text}`}>
                <span role="cell">{question.batch_position}</span>
                <span role="cell">{question.question_text}</span>
                <strong role="cell">{question.correct_option}</strong>
              </div>
            ))}
          </div>
          {pageCount > 1 && (
            <div className="admin-import-pagination" aria-label="Import preview pages">
              <button className="ghost-button" type="button" disabled={page === 0} onClick={() => setPage((current) => current - 1)}>Previous</button>
              <span>Page {page + 1} of {pageCount}</span>
              <button className="ghost-button" type="button" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button>
            </div>
          )}
          <div className="admin-import-commit">
            <p>The database checks the complete file again. If one row fails, no questions are saved.</p>
            <button type="button" disabled={errors.length > 0 || importing} onClick={handleImport}>
              {importing ? "Importing questions..." : `Import ${preview.length} questions`}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
