import { useEffect, useRef, useState } from "react";

export function AdminConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = "primary",
  busy,
  choiceLabel,
  choices = [],
  reasonLabel,
  reasonRequired = false,
  onCancel,
  onConfirm,
}) {
  const cancelRef = useRef(null);
  const firstChoice = choices[0]?.value ?? "";
  const [choice, setChoice] = useState(firstChoice);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape" && !busy) onCancel();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;

  return (
    <div className="admin-dialog-backdrop" role="presentation" onMouseDown={busy ? undefined : onCancel}>
      <section
        aria-labelledby="admin-dialog-title"
        aria-modal="true"
        className="admin-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <span className="admin-form-step">Confirm action</span>
        <h2 id="admin-dialog-title">{title}</h2>
        <div className="admin-dialog-copy">{children}</div>
        {choices.length > 0 && (
          <fieldset className="admin-dialog-choice">
            <legend>{choiceLabel}</legend>
            {choices.map((item) => (
              <label key={item.value}>
                <input
                  checked={choice === item.value}
                  name="admin-confirm-choice"
                  type="radio"
                  value={item.value}
                  onChange={(event) => setChoice(event.target.value)}
                />
                <span><strong>{item.label}</strong>{item.description && <small>{item.description}</small>}</span>
              </label>
            ))}
          </fieldset>
        )}
        {reasonLabel && (
          <label className="admin-dialog-reason">
            {reasonLabel}
            <textarea
              required={reasonRequired}
              rows="3"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        )}
        <div className="admin-form-actions">
          <button ref={cancelRef} className="ghost-button" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={tone === "danger" ? "admin-danger-button" : ""}
            type="button"
            onClick={() => onConfirm({ choice, reason })}
            disabled={busy || (reasonRequired && reason.trim().length < 3)}
          >
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
