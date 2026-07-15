import { useState } from "react";
import { slugifyModuleName } from "../../lib/adminContent";

const DEFAULT_MODULE = {
  subject_id: "",
  subject_name: "",
  subject_slug: "",
  sort_order: 100,
  lifecycle_status: "draft",
  batch_size: 30,
  pass_mark_percent: 70,
  price_kobo: 500000,
  currency: "NGN",
  available_for_purchase: false,
};

function toFormState(module) {
  const source = module ?? DEFAULT_MODULE;
  return {
    ...DEFAULT_MODULE,
    ...source,
    price_naira: Number(source.price_kobo ?? DEFAULT_MODULE.price_kobo) / 100,
  };
}

export function AdminModuleForm({ module = null, saving, onCancel, onSubmit }) {
  const [form, setForm] = useState(() => toFormState(module));
  const isEditing = Boolean(module?.subject_id);
  const hasPublishedSets = Number(module?.published_set_count ?? 0) > 0;

  function updateField(field, value) {
    setForm((current) => {
      const next = { ...current, [field]: value };

      if (field === "subject_name" && !isEditing) {
        next.subject_slug = slugifyModuleName(value);
      }

      if (field === "lifecycle_status" && value !== "active") {
        next.available_for_purchase = false;
      }

      return next;
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({
      ...form,
      name: form.subject_name,
      slug: form.subject_slug,
      sort_order: Number(form.sort_order),
      price_kobo: Math.round(Number(form.price_naira) * 100),
      batch_size: Number(form.batch_size),
      pass_mark_percent: Number(form.pass_mark_percent),
    });
  }

  return (
    <form className="admin-editor-form" onSubmit={handleSubmit}>
      <div className="admin-form-section">
        <div>
          <h2>{isEditing ? "Module settings" : "Create module"}</h2>
          <p>{isEditing ? "Update how this module appears and is sold." : "Start privately, then add and review its practice sets."}</p>
        </div>

        <label>
          Module name
          <input
            required
            value={form.subject_name}
            onChange={(event) => updateField("subject_name", event.target.value)}
            placeholder="For example, Public Service Rules"
          />
        </label>

        {!isEditing && form.subject_slug && (
          <p className="admin-field-note">URL: /modules/{form.subject_slug}</p>
        )}

        <div className="admin-form-grid">
          <label>
            Status
            <select
              value={form.lifecycle_status}
              onChange={(event) => updateField("lifecycle_status", event.target.value)}
            >
              {!hasPublishedSets && <option value="draft">Draft</option>}
              {!hasPublishedSets && <option value="coming_soon">Coming soon</option>}
              {isEditing && hasPublishedSets && <option value="active">Active</option>}
              {isEditing && <option value="retired">Retired</option>}
            </select>
          </label>
        </div>

        <details className="admin-advanced-fields">
          <summary>Advanced</summary>
          <label>
            Module position
            <input
              min="1"
              required
              type="number"
              value={form.sort_order}
              onChange={(event) => updateField("sort_order", event.target.value)}
            />
          </label>
        </details>
      </div>

      <div className="admin-form-section">
        <div>
          <h3>Practice standards</h3>
          <p>These defaults apply to the module's practice sets.</p>
        </div>

        <div className="admin-form-grid">
          <label>
            Questions per practice set
            <input
              min="1"
              max="200"
              required
              type="number"
              value={form.batch_size}
              onChange={(event) => updateField("batch_size", event.target.value)}
            />
          </label>

          <label>
            Pass mark (%)
            <input
              min="1"
              max="100"
              required
              type="number"
              value={form.pass_mark_percent}
              onChange={(event) => updateField("pass_mark_percent", event.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="admin-form-section">
        <div>
          <h3>Pricing and availability</h3>
          <p>Price changes apply to future purchases only.</p>
        </div>

        <label>
          Module price (NGN)
          <input
            min="1"
            required
            step="1"
            type="number"
            value={form.price_naira}
            onChange={(event) => updateField("price_naira", event.target.value)}
          />
        </label>

        {isEditing && (
          <label className={`admin-check-row${form.lifecycle_status !== "active" ? " is-disabled" : ""}`}>
            <input
              checked={Boolean(form.available_for_purchase)}
              disabled={form.lifecycle_status !== "active"}
              type="checkbox"
              onChange={(event) => updateField("available_for_purchase", event.target.checked)}
            />
            <span>
              <strong>Available for purchase</strong>
              <small>Turn this off to stop new sales without removing existing access.</small>
            </span>
          </label>
        )}
      </div>

      <div className="admin-form-actions admin-sticky-actions">
        <button type="button" className="ghost-button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" disabled={saving || !form.subject_name.trim() || !form.subject_slug}>
          {saving ? "Saving..." : isEditing ? "Save changes" : "Create module"}
        </button>
      </div>
    </form>
  );
}
