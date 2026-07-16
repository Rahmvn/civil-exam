import { useEffect } from "react";
import { getModuleDisplayName } from "../lib/moduleDisplay";

function formatMoney(kobo, currency = "NGN") {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currency || "NGN",
    maximumFractionDigits: 0,
  }).format((kobo ?? 0) / 100);
}

export function UnlockModuleModal({
  error,
  module,
  onClose,
  onStartPayment,
  paying,
}) {
  useEffect(() => {
    if (!module) return undefined;

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [module, onClose]);

  if (!module) return null;

  return (
    <div className="access-receipt-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="unlock-module-title"
        aria-modal="true"
        className="access-unlock-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="access-unlock-header">
          <div>
            <h2 id="unlock-module-title">Module access</h2>
            <p>{getModuleDisplayName(module.subject_name ?? module.name)}</p>
          </div>
          <button className="access-unlock-close" aria-label="Close unlock module" onClick={onClose} type="button">×</button>
        </header>

        <div className="access-unlock-price">
          <span>Amount to pay</span>
          <strong>{formatMoney(module.price_kobo, module.currency)}</strong>
        </div>

        <p className="access-unlock-copy">You will be redirected to Paystack to complete this payment.</p>

        <div className="access-unlock-actions">
          <button
            aria-busy={paying}
            disabled={paying}
            onClick={() => void onStartPayment(module.subject_slug ?? module.slug)}
            type="button"
          >
            {paying ? "Connecting..." : "Continue"}
          </button>
        </div>
        {error && <p className="access-module-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
