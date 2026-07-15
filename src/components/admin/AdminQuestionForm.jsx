import { useState } from "react";

function createBlankQuestion(practiceSetId, nextPosition) {
  return {
    id: "",
    practice_set_id: practiceSetId,
    batch_position: nextPosition,
    difficulty: "medium",
    question_text: "",
    option_a: "",
    option_b: "",
    option_c: "",
    option_d: "",
    correct_option: "A",
    explanation: "",
    reference_note: "",
    source_note: "Admin content manager",
  };
}

function normalizeQuestion(question, practiceSetId, nextPosition) {
  return question
    ? {
        ...createBlankQuestion(practiceSetId, nextPosition),
        ...question,
        practice_set_id: question.practice_set_id ?? practiceSetId,
      }
    : createBlankQuestion(practiceSetId, nextPosition);
}

export function AdminQuestionForm({
  question,
  practiceSetId,
  nextPosition,
  saving,
  mode = "question",
  onCancel,
  onSubmit,
}) {
  const [form, setForm] = useState(() => normalizeQuestion(question, practiceSetId, nextPosition));
  const isCorrection = mode === "correction";
  const isPendingCorrection = Boolean(question?.supersedes_question_id);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      ...form,
      batch_position: Number(form.batch_position),
      question_text: form.question_text.trim(),
      option_a: form.option_a.trim(),
      option_b: form.option_b.trim(),
      option_c: form.option_c.trim(),
      option_d: form.option_d.trim(),
      explanation: form.explanation.trim(),
      reference_note: form.reference_note.trim(),
      source_note: form.source_note.trim(),
    });
  }

  const title = isCorrection
    ? isPendingCorrection
      ? "Edit correction"
      : "Correct published question"
    : form.id
      ? "Edit question"
      : "Add question";

  return (
    <form className="admin-question-editor" onSubmit={handleSubmit}>
      <div className="admin-editor-heading">
        <div>
          <h1>{title}</h1>
          <p>Write the question exactly as candidates should see it.</p>
        </div>
        <button className="link-button" type="button" onClick={onCancel} disabled={saving}>
          Close
        </button>
      </div>

      {isCorrection && (
        <p className="admin-safety-note">
          The live question is unchanged until this correction is published.
        </p>
      )}

      <div className="admin-form-grid is-compact">
        <label>
          Position
          <input
            min="1"
            required
            type="number"
            disabled={isCorrection}
            value={form.batch_position}
            onChange={(event) => updateField("batch_position", event.target.value)}
          />
        </label>
      </div>

      <label>
        Question
        <textarea
          required
          rows="4"
          value={form.question_text}
          onChange={(event) => updateField("question_text", event.target.value)}
          placeholder="Enter the complete question exactly as candidates should see it."
        />
      </label>

      <div className="admin-option-editor">
        {["a", "b", "c", "d"].map((option) => {
          const optionKey = `option_${option}`;
          const optionLabel = option.toUpperCase();
          return (
            <div className="admin-option-row" key={option}>
              <label className="admin-answer-selector" title={`Mark option ${optionLabel} as correct`}>
                <input
                  type="radio"
                  name="correct-option"
                  value={optionLabel}
                  checked={form.correct_option === optionLabel}
                  onChange={() => updateField("correct_option", optionLabel)}
                />
                <span>{optionLabel}</span>
              </label>
              <label>
                <span className="sr-only">Option {optionLabel}</span>
                <input
                  required
                  value={form[optionKey]}
                  onChange={(event) => updateField(optionKey, event.target.value)}
                  placeholder={`Option ${optionLabel}`}
                />
              </label>
            </div>
          );
        })}
      </div>
      <p className="admin-field-note">Select the letter beside the correct answer.</p>

      <label>
        Explanation
        <textarea
          rows="3"
          required={isCorrection}
          value={form.explanation}
          onChange={(event) => updateField("explanation", event.target.value)}
          placeholder="Explain why the correct answer is right. This is required before publication."
        />
      </label>

      <details className="admin-advanced-fields">
        <summary>Additional details</summary>
        <div className="admin-form-grid">
          <label>
            Difficulty
            <select value={form.difficulty} onChange={(event) => updateField("difficulty", event.target.value)}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </label>
          <label>
            Reference
            <input
              value={form.reference_note}
              onChange={(event) => updateField("reference_note", event.target.value)}
              placeholder="Rule, circular, chapter, or source"
            />
          </label>
          <label>
            Internal source note
            <input
              value={form.source_note}
              onChange={(event) => updateField("source_note", event.target.value)}
              placeholder="Where this question came from"
            />
          </label>
        </div>
      </details>

      <div className="admin-form-actions admin-sticky-actions">
        <button className="ghost-button" type="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" disabled={saving}>
          {saving ? "Saving..." : isCorrection ? "Save correction" : form.id ? "Save question" : "Add question"}
        </button>
      </div>
    </form>
  );
}
