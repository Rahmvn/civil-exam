import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  DIFFICULTIES,
  QUESTION_STATUSES,
  SERVICE_LEVELS,
  getActivePack,
  getAdminAuditLogs,
  getAdminQuestionCounts,
  getAdminQuestions,
  getSubjects,
  saveQuestion,
} from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { useAuth } from "../lib/useAuth";

const blankQuestion = {
  id: "",
  exam_pack_id: "",
  subject_id: "",
  service_level: "",
  difficulty: "medium",
  question_text: "",
  option_a: "",
  option_b: "",
  option_c: "",
  option_d: "",
  correct_option: "A",
  explanation: "",
  reference_note: "",
  source_note: "",
  status: "draft",
};

function validateQuestion(question) {
  const requiredFields = [
    "exam_pack_id",
    "subject_id",
    "question_text",
    "option_a",
    "option_b",
    "option_c",
    "option_d",
    "correct_option",
  ];

  const missingField = requiredFields.find((field) => !String(question[field] ?? "").trim());

  if (missingField) {
    return "Question, subject, options A-D, and the correct answer are required.";
  }

  if (question.status === "published" && !question.explanation.trim()) {
    return "Published questions must include an explanation.";
  }

  return "";
}

export default function Admin() {
  const { user } = useAuth();
  const [pack, setPack] = useState(null);
  const [subjects, setSubjects] = useState([]);
  const [counts, setCounts] = useState({ draft_count: 0, review_count: 0, published_count: 0 });
  const [questions, setQuestions] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [form, setForm] = useState(blankQuestion);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function loadAdmin() {
      try {
        const [nextPack, nextSubjects, nextCounts, nextQuestions, nextAuditLogs] = await Promise.all([
          getActivePack(),
          getSubjects(),
          getAdminQuestionCounts(),
          getAdminQuestions(),
          getAdminAuditLogs(),
        ]);

        setPack(nextPack);
        setSubjects(nextSubjects);
        setCounts(nextCounts);
        setQuestions(nextQuestions);
        setAuditLogs(nextAuditLogs);
        setForm((previous) => ({
          ...previous,
          exam_pack_id: nextPack?.id ?? "",
          subject_id: nextSubjects[0]?.id ?? "",
        }));
      } catch (error) {
        logAppError("Admin load", error);
        setMessage(friendlyErrorMessage(error, "We could not load the admin console."));
      } finally {
        setLoading(false);
      }
    }

    void loadAdmin();
  }, []);

  const selectedSubject = useMemo(
    () => subjects.find((subject) => subject.id === form.subject_id),
    [form.subject_id, subjects],
  );

  function updateForm(field, value) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  function editQuestion(question) {
    setForm({
      id: question.id,
      exam_pack_id: pack?.id ?? "",
      subject_id: question.subject_id,
      service_level: question.service_level ?? "",
      difficulty: question.difficulty,
      question_text: question.question_text,
      option_a: question.option_a,
      option_b: question.option_b,
      option_c: question.option_c,
      option_d: question.option_d,
      correct_option: question.correct_option,
      explanation: question.explanation,
      reference_note: question.reference_note,
      source_note: question.source_note,
      status: question.status,
    });
    setMessage(`Editing question in ${question.subjects?.name ?? selectedSubject?.name ?? "module"}.`);
  }

  function resetForm() {
    setForm({
      ...blankQuestion,
      exam_pack_id: pack?.id ?? "",
      subject_id: subjects[0]?.id ?? "",
    });
    setMessage("");
  }

  async function reloadAdmin() {
    const [nextCounts, nextQuestions, nextAuditLogs] = await Promise.all([
      getAdminQuestionCounts(),
      getAdminQuestions(),
      getAdminAuditLogs(),
    ]);

    setCounts(nextCounts);
    setQuestions(nextQuestions);
    setAuditLogs(nextAuditLogs);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    const validationMessage = validateQuestion(form);

    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    setSaving(true);

    try {
      await saveQuestion(form, user.id);
      await reloadAdmin();
      resetForm();
      setMessage("Question saved.");
    } catch (error) {
      logAppError("Admin save question", error);
      setMessage(friendlyErrorMessage(error, "We could not save that question."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="state-shell">Loading admin console...</main>;
  }

  return (
    <main className="admin-shell">
      <header className="practice-topbar">
        <Link className="text-link" to="/dashboard">
          Back to dashboard
        </Link>
        <span>{pack?.name}</span>
      </header>

      <section className="admin-hero premium-hero">
        <div>
          <p className="eyebrow">Admin console</p>
          <h1>Question bank management</h1>
          <p>
            Publish clean module-based questions with clear explanations and helpful references.
          </p>
        </div>
        <div className="admin-counts">
          <article>
            <span>Draft</span>
            <strong>{counts.draft_count}</strong>
          </article>
          <article>
            <span>Review</span>
            <strong>{counts.review_count}</strong>
          </article>
          <article>
            <span>Published</span>
            <strong>{counts.published_count}</strong>
          </article>
        </div>
      </section>

      {message && <p className="notice">{message}</p>}

      <section className="admin-layout">
        <form className="question-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <label>
              Module
              <select value={form.subject_id} onChange={(event) => updateForm("subject_id", event.target.value)}>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Service level override
              <select
                value={form.service_level}
                onChange={(event) => updateForm("service_level", event.target.value)}
              >
                <option value="">Shared (all eligible candidates)</option>
                {SERVICE_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Difficulty
              <select value={form.difficulty} onChange={(event) => updateForm("difficulty", event.target.value)}>
                {DIFFICULTIES.map((difficulty) => (
                  <option key={difficulty} value={difficulty}>
                    {difficulty}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select value={form.status} onChange={(event) => updateForm("status", event.target.value)}>
                {QUESTION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            Question
            <textarea
              required
              rows={4}
              value={form.question_text}
              onChange={(event) => updateForm("question_text", event.target.value)}
              placeholder="Enter the question exactly as candidates should see it"
            />
          </label>

          <div className="form-grid">
            {["a", "b", "c", "d"].map((option) => (
              <label key={option}>
                Option {option.toUpperCase()}
                <input
                  required
                  value={form[`option_${option}`]}
                  onChange={(event) => updateForm(`option_${option}`, event.target.value)}
                />
              </label>
            ))}
          </div>

          <div className="form-grid">
            <label>
              Correct answer
              <select value={form.correct_option} onChange={(event) => updateForm("correct_option", event.target.value)}>
                {["A", "B", "C", "D"].map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reference
              <input
                value={form.reference_note}
                onChange={(event) => updateForm("reference_note", event.target.value)}
                placeholder="Rule, regulation, book, chapter, or section"
              />
            </label>
            <label>
              Internal source note
              <input
                value={form.source_note}
                onChange={(event) => updateForm("source_note", event.target.value)}
                placeholder="Past paper, authoring note, or provenance"
              />
            </label>
          </div>

          <label>
            Explanation
            <textarea
              rows={4}
              value={form.explanation}
              onChange={(event) => updateForm("explanation", event.target.value)}
              placeholder="Explain why the correct option is right"
            />
          </label>

          <div className="hero-actions">
            <button type="submit" disabled={saving}>
              {saving ? "Saving..." : form.id ? "Update question" : "Save question"}
            </button>
            <button className="ghost-button" type="button" onClick={resetForm}>
              Clear form
            </button>
          </div>
        </form>

        <aside className="admin-question-list">
          <p className="eyebrow">Latest questions</p>
          {questions.length === 0 ? (
            <p>No questions have been entered yet.</p>
          ) : (
            questions.map((question) => (
              <article key={question.id}>
                <div>
                  <strong>{question.question_text}</strong>
                  <span>
                    {question.subjects?.name} · {question.service_level ?? "Shared"} · {question.status}
                  </span>
                </div>
                <button className="ghost-button" type="button" onClick={() => editQuestion(question)}>
                  Edit
                </button>
              </article>
            ))
          )}
        </aside>
      </section>

      <section className="two-column-section">
        <div>
          <div className="section-heading">
            <p className="eyebrow">Audit logs</p>
            <h2>Recent admin activity</h2>
          </div>
          <div className="admin-question-list">
            {auditLogs.length === 0 ? (
              <p>No admin activity has been recorded yet.</p>
            ) : (
              auditLogs.map((log) => (
                <article key={log.id}>
                  <div>
                    <strong>
                      {log.action} · {log.entity_type}
                    </strong>
                    <span>
                      {log.actor?.email ?? "Unknown admin"}
                      {log.metadata?.status ? ` · status: ${log.metadata.status}` : ""}
                    </span>
                  </div>
                  <span>{new Date(log.created_at).toLocaleString()}</span>
                </article>
              ))
            )}
          </div>
        </div>

        <aside className="side-panel">
          <p className="eyebrow">Content rule</p>
          <p>
            Shared questions are the default pool for all candidates. Use a service level only when
            you intentionally need a level-specific override.
          </p>
        </aside>
      </section>
    </main>
  );
}
