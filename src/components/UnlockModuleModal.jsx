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

  const moduleName = getModuleDisplayName(module.subject_name ?? module.name);

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
            <h2 id="unlock-module-title">{moduleName}</h2>
          </div>
          <button className="access-unlock-close" aria-label="Close unlock module" onClick={onClose} type="button">&times;</button>
        </header>

        <div className="access-unlock-price">
          <span>Price</span>
          <strong>{formatMoney(module.price_kobo, module.currency)}</strong>
        </div>

        <p className="access-unlock-copy">Pay securely with Paystack. Your module unlocks automatically after payment is confirmed.</p>

        <div className="access-unlock-actions">
          <button className="ghost-button" disabled={paying} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            aria-busy={paying}
            className="primary-action"
            disabled={paying}
            onClick={() => void onStartPayment(module.subject_slug ?? module.slug)}
            type="button"
          >
            {paying ? "Connecting..." : "Continue to payment"}
          </button>
        </div>
        {error && <p className="access-module-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
