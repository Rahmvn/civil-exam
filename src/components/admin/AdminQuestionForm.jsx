import { useState } from "react";

function createBlankQuestion(practiceSetId, nextPosition, practiceType) {
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
    model_answer: "",
    key_points: practiceType === "oral" ? [""] : [],
    reference_note: "",
    source_note: "Admin content manager",
  };
}

function normalizeQuestion(question, practiceSetId, nextPosition, practiceType) {
  return question
    ? {
        ...createBlankQuestion(practiceSetId, nextPosition, practiceType),
        ...question,
        key_points: practiceType === "oral" && (!Array.isArray(question.key_points) || question.key_points.length === 0)
          ? [""]
          : question.key_points,
        practice_set_id: question.practice_set_id ?? practiceSetId,
      }
    : createBlankQuestion(practiceSetId, nextPosition, practiceType);
}

export function AdminQuestionForm({
  question,
  practiceSetId,
  nextPosition,
  saving,
  mode = "question",
  practiceType = "objective",
  onCancel,
  onSubmit,
}) {
  const [form, setForm] = useState(() => normalizeQuestion(question, practiceSetId, nextPosition, practiceType));
  const isOral = practiceType === "oral";
  const isCorrection = mode === "correction";
  const isPendingCorrection = Boolean(question?.supersedes_question_id);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const shared = {
      ...form,
      batch_position: Number(form.batch_position),
      question_text: form.question_text.trim(),
      reference_note: form.reference_note.trim(),
      source_note: form.source_note.trim(),
    };

    onSubmit(isOral ? {
      ...shared,
      model_answer: form.model_answer.trim(),
      key_points: form.key_points.map((point) => point.trim()).filter(Boolean),
    } : {
      ...shared,
      option_a: form.option_a.trim(),
      option_b: form.option_b.trim(),
      option_c: form.option_c.trim(),
      option_d: form.option_d.trim(),
      explanation: form.explanation.trim(),
    });
  }

  function updateKeyPoint(index, value) {
    setForm((current) => ({
      ...current,
      key_points: current.key_points.map((point, pointIndex) => pointIndex === index ? value : point),
    }));
  }

  function removeKeyPoint(index) {
    setForm((current) => ({ ...current, key_points: current.key_points.filter((_, pointIndex) => pointIndex !== index) }));
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
          <p>{isOral ? "Add the prompt and the guidance candidates will use after finishing." : "Write the question exactly as candidates should see it."}</p>
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

      {isOral ? (
        <div className="admin-oral-answer-editor">
          <label>
            Model answer
            <textarea
              required
              rows="6"
              value={form.model_answer}
              onChange={(event) => updateField("model_answer", event.target.value)}
              placeholder="Write the complete answer candidates should compare with after the practice."
            />
          </label>

          <fieldset className="admin-key-points-editor">
            <legend>Key points</legend>
            <p>List the essential ideas a strong answer should cover.</p>
            {form.key_points.map((point, index) => (
              <div className="admin-key-point-row" key={index}>
                <label>
                  <span className="sr-only">Key point {index + 1}</span>
                  <input
                    required={index === 0}
                    value={point}
                    onChange={(event) => updateKeyPoint(index, event.target.value)}
                    placeholder={`Key point ${index + 1}`}
                  />
                </label>
                {form.key_points.length > 1 && (
                  <button className="link-button" type="button" onClick={() => removeKeyPoint(index)}>Remove</button>
                )}
              </div>
            ))}
            {form.key_points.length < 6 && (
              <button className="ghost-button" type="button" onClick={() => updateField("key_points", [...form.key_points, ""])}>Add key point</button>
            )}
          </fieldset>
        </div>
      ) : (
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
      )}
      {!isOral && <p className="admin-field-note">Select the letter beside the correct answer.</p>}

      {!isOral && <label>
        Explanation <span className="admin-optional-label">(optional)</span>
        <textarea
          rows="3"
          value={form.explanation}
          onChange={(event) => updateField("explanation", event.target.value)}
          placeholder="Add a short reason when it would help the candidate."
        />
      </label>}

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
            Reference <span className="admin-optional-label">(optional)</span>
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
