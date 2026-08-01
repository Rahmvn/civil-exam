import { useEffect } from "react";
import { getModuleDisplayName } from "../lib/moduleDisplay";
import { formatLaunchOfferEnd, formatModuleMoney } from "../lib/pricing";

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
  const regularAmount = formatModuleMoney(regularPrice, module.currency);
  const offerEnd = module.launch_offer_ends_at ? formatLaunchOfferEnd(module.launch_offer_ends_at) : "";

  return (
    <div className="access-receipt-backdrop access-unlock-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="unlock-module-title"
        aria-modal="true"
        className="access-unlock-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button className="access-unlock-drag-handle" aria-label="Close payment modal" onClick={onClose} type="button" />
        <header className="access-unlock-header">
          <div>
            <h2 id="unlock-module-title">{moduleName}</h2>
          </div>
          <button className="access-unlock-close" aria-label="Close unlock module" onClick={onClose} type="button">&times;</button>
        </header>

        <div className="access-unlock-price">
          <div className="access-unlock-price-stack">
            {hasLaunchOffer && <del className="access-unlock-regular-price">{regularAmount}</del>}
            <strong>{paymentAmount}</strong>
          </div>
        </div>

        {hasLaunchOffer && offerEnd && (
          <p className="access-unlock-offer-end">
            Offer ends {offerEnd} WAT.
          </p>
        )}

        <p className="access-unlock-copy">
          Pay securely with Paystack. Access opens automatically after payment.
        </p>

        <div className="access-unlock-actions">
          <button
            aria-busy={paying}
            className="primary-action"
            disabled={paying}
            onClick={() => void onStartPayment(module.subject_slug ?? module.slug, Number(module.price_kobo))}
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
