import { useEffect } from "react";
import { Link } from "react-router-dom";

export default function AuthPromptModal({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-label="Authentication options"
        aria-modal="true"
        className="auth-modal-card auth-prompt-card"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          aria-label="Close sign-in prompt"
          className="auth-modal-close"
          onClick={onClose}
          type="button"
        >
          x
        </button>
        <h2 className="auth-prompt-title">Sign in to continue</h2>
        <p className="auth-prompt-copy">
          Create your account to start Batch 1 of one selected module for free.
        </p>
        <div className="auth-modal-actions auth-prompt-actions">
          <Link className="primary-action" to="/auth?mode=sign-in">
            Sign in
          </Link>
          <Link className="secondary-action" to="/auth?mode=sign-up">
            Create account
          </Link>
        </div>
      </section>
    </div>
  );
}
