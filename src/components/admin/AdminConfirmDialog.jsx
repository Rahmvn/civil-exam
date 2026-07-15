import { useEffect, useRef } from "react";

export function AdminConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = "primary",
  busy,
  onCancel,
  onConfirm,
}) {
  const cancelRef = useRef(null);

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
        <div className="admin-form-actions">
          <button ref={cancelRef} className="ghost-button" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className={tone === "danger" ? "admin-danger-button" : ""} type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "Working..." : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
