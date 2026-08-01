import { useEffect } from "react";
import { getModuleDisplayName } from "../lib/moduleDisplay";
import { formatLaunchOfferEnd, formatModuleMoney } from "../lib/pricing";
import { ModulePrice } from "./ModulePrice";

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
  const currentPrice = Number(module.price_kobo);
  const regularPrice = Number(module.regular_price_kobo ?? module.price_kobo);
  const hasLaunchOffer = Boolean(
    module.launch_offer_active
      && Number.isFinite(currentPrice)
      && Number.isFinite(regularPrice)
      && currentPrice < regularPrice,
  );
  const paymentAmount = formatModuleMoney(currentPrice, module.currency);
  const modalTitle = `Unlock ${moduleName}`;
  const offerEnd = module.launch_offer_ends_at ? formatLaunchOfferEnd(module.launch_offer_ends_at) : "";

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
            <span className="access-unlock-kicker">{hasLaunchOffer ? "Launch offer" : "Module access"}</span>
            <h2 id="unlock-module-title">{modalTitle}</h2>
            <p>{hasLaunchOffer ? "Secure today's lower price before the launch window closes." : "Get full access to this structured practice module."}</p>
          </div>
          <button className="access-unlock-close" aria-label="Close unlock module" onClick={onClose} type="button">&times;</button>
        </header>

        <div className="access-unlock-value-card">
          <div className="access-unlock-price">
            <span>{hasLaunchOffer ? "You pay today" : "Price"}</span>
            <ModulePrice module={module} />
          </div>

          {hasLaunchOffer && offerEnd && (
            <p className="access-unlock-offer-end">
              Offer ends {offerEnd} WAT.
            </p>
          )}
        </div>

        <div className="access-unlock-benefits" aria-label="What you get">
          <span>Exam-style practice</span>
          <span>Review after attempts</span>
          <span>Progress saved on your account</span>
        </div>

        <p className="access-unlock-copy">
          Pay securely with Paystack. Your access opens automatically after payment is confirmed.
        </p>

        <div className="access-unlock-actions">
          <button className="ghost-button" disabled={paying} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            aria-busy={paying}
            className="primary-action"
            disabled={paying}
            onClick={() => void onStartPayment(module.subject_slug ?? module.slug, Number(module.price_kobo))}
            type="button"
          >
            {paying ? "Connecting..." : `Unlock for ${paymentAmount}`}
          </button>
        </div>
        {error && <p className="access-module-error" role="alert">{error}</p>}
      </section>
    </div>
  );
}
