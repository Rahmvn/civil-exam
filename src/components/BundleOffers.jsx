import { useEffect, useMemo, useState } from "react";
import { formatLaunchOfferEnd, formatModuleMoney } from "../lib/pricing";
import { getModuleDisplayName } from "../lib/moduleDisplay";

function offerModules(offer) {
  return Array.isArray(offer?.modules) ? offer.modules : [];
}

function BundleMark({ className = "" }) {
  return (
    <span className={`bundle-mark ${className}`.trim()} aria-hidden="true">
      <svg focusable="false" viewBox="0 0 24 24">
        <path d="M7 6.5h10v5H7z" />
        <path d="M5.5 10.5h13v6.5h-13z" />
        <path d="M9 14h6" />
      </svg>
    </span>
  );
}

function getOfferModuleCount(offer) {
  if (!offer) return 0;
  if (offer.offer_type === "full_bundle") return Number(offer.available_module_count ?? offer.modules?.length ?? 0);
  return Number(offer.selection_count ?? 0);
}

function getOfferComparisonPrice(offer, selectedListPrice = null) {
  const selectedComparison = Number(selectedListPrice);
  const directComparison = Number(offer?.list_price_kobo ?? offer?.minimum_comparison_price_kobo);
  const price = Number(offer?.price_kobo);

  if (Number.isFinite(selectedComparison) && selectedComparison > price) return selectedComparison;
  if (Number.isFinite(directComparison) && directComparison > price) return directComparison;
  return null;
}

function getOfferCardCopy(offer) {
  if (offer?.offer_type === "full_bundle") return "Unlock every available module.";
  return "Pick your modules at checkout.";
}

function getOfferModalCopy(offer) {
  if (offer?.offer_type === "full_bundle") return "Review included modules before payment.";
  return `Select ${getOfferModuleCount(offer)} modules to continue.`;
}

function getOfferActionCopy(offer) {
  if (offer?.offer_type === "full_bundle") return "Review bundle";
  return "Choose modules";
}

function getBundlePayCopy({ offer, paying, selectedCount, requiredCount }) {
  if (paying) return "Preparing payment...";
  if (selectedCount < requiredCount) {
    const remaining = requiredCount - selectedCount;
    return `Select ${remaining} more module${remaining === 1 ? "" : "s"}`;
  }
  return `Continue - ${formatModuleMoney(offer.price_kobo, offer.currency)}`;
}

export function BundleOfferTrigger({ offer, onChoose, variant = "dashboard" }) {
  if (!offer) return null;

  return (
    <button className={`bundle-offer-trigger is-${variant}`} onClick={() => onChoose(offer)} type="button">
      <BundleMark />
      <span>View bundle offers</span>
    </button>
  );
}

export function BundleOffers({ offers = [], onChoose }) {
  if (offers.length === 0) return null;

  return (
    <section className="bundle-offers" id="bundles" aria-labelledby="bundle-offers-title">
      <header className="bundle-offers-heading">
        <h2 id="bundle-offers-title">Bundle offers</h2>
      </header>

      <div className="bundle-offer-list">
        {offers.map((offer) => {
          const isApplicable = offer.is_applicable !== false;

          return (
            <article className={`bundle-offer-row${isApplicable ? "" : " is-unavailable"}`} key={offer.offer_id}>
              <div className="bundle-offer-row-copy">
                <h3>{offer.offer_name}</h3>
                <p>{isApplicable ? getOfferCardCopy(offer) : offer.eligibility_message}</p>
              </div>
              <div className="bundle-offer-row-price">
                <strong>{formatModuleMoney(offer.price_kobo, offer.currency)}</strong>
              </div>
              {isApplicable ? (
                <button className="bundle-offer-row-action" type="button" onClick={() => onChoose(offer)}>
                  {getOfferActionCopy(offer)}
                </button>
              ) : (
                <span className="bundle-offer-row-status">Not available</span>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function BundleCheckoutModal({ error, offer, onClose, onPay, paying }) {
  const modules = useMemo(() => offerModules(offer), [offer]);
  const isFullBundle = offer?.offer_type === "full_bundle";
  const requiredCount = isFullBundle ? modules.length : Number(offer?.selection_count ?? 0);
  const [selectionState, setSelectionState] = useState({ offerId: null, slugs: [] });

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !paying) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, paying]);

  if (!offer) return null;

  const selectedSlugs = selectionState.offerId === offer.offer_id
    ? selectionState.slugs
    : isFullBundle ? modules.map((module) => module.subject_slug) : [];
  const selected = modules.filter((module) => selectedSlugs.includes(module.subject_slug));
  const selectedListPrice = selected.reduce((sum, module) => sum + Number(module.price_kobo), 0);
  const selectionComplete = selected.length === requiredCount;
  const comparisonPrice = selectionComplete
    ? getOfferComparisonPrice(offer, selectedListPrice)
    : getOfferComparisonPrice(offer);
  const selectionLabel = isFullBundle
    ? `${modules.length} modules included`
    : selectionComplete ? "Ready for payment" : `${selected.length} of ${requiredCount} selected`;
  const payCopy = getBundlePayCopy({
    offer,
    paying,
    selectedCount: selected.length,
    requiredCount,
  });

  function toggleModule(subjectSlug) {
    if (paying || isFullBundle) return;
    setSelectionState((currentState) => {
      const current = currentState.offerId === offer.offer_id ? currentState.slugs : [];
      if (current.includes(subjectSlug)) {
        return { offerId: offer.offer_id, slugs: current.filter((slug) => slug !== subjectSlug) };
      }
      if (current.length >= requiredCount) {
        return currentState.offerId === offer.offer_id ? currentState : { offerId: offer.offer_id, slugs: current };
      }
      return { offerId: offer.offer_id, slugs: [...current, subjectSlug] };
    });
  }

  return (
    <div className="bundle-checkout-backdrop" role="presentation" onClick={paying ? undefined : onClose}>
      <section
        aria-labelledby="bundle-checkout-title"
        aria-modal="true"
        className="bundle-checkout-sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button
          aria-label="Close bundle checkout"
          className="bundle-checkout-handle"
          disabled={paying}
          onClick={onClose}
          type="button"
        />

        <header className="bundle-checkout-head">
          <div className="bundle-checkout-title-block">
            <h2 id="bundle-checkout-title">{offer.offer_name}</h2>
            <p>{getOfferModalCopy(offer)}</p>
          </div>
          <button
            aria-label="Close bundle checkout"
            className="bundle-checkout-close"
            disabled={paying}
            onClick={onClose}
            type="button"
          >
            &times;
          </button>
        </header>

        <div className="bundle-checkout-body">
          <section className="bundle-checkout-summary" aria-label="Bundle price">
            <strong>{formatModuleMoney(offer.price_kobo, offer.currency)}</strong>
            {comparisonPrice && <span>Normally {formatModuleMoney(comparisonPrice, offer.currency)}</span>}
            {offer.ends_at && <p>Ends {formatLaunchOfferEnd(offer.ends_at)} WAT.</p>}
          </section>

          <section className="bundle-module-picker" aria-labelledby="bundle-module-picker-title">
            <header>
              <h3 id="bundle-module-picker-title">{isFullBundle ? "Included modules" : `Choose ${requiredCount} modules`}</h3>
              <span>{selectionLabel}</span>
            </header>

            <div className="bundle-module-list" aria-label={isFullBundle ? "Included modules" : "Choose modules"}>
              {modules.map((module) => {
                const selectedModule = selectedSlugs.includes(module.subject_slug);
                return (
                  <button
                    aria-pressed={selectedModule}
                    className={`bundle-module-option${selectedModule ? " is-selected" : ""}`}
                    disabled={isFullBundle || paying}
                    key={module.subject_id}
                    onClick={() => toggleModule(module.subject_slug)}
                    type="button"
                  >
                    <span className="bundle-module-check" aria-hidden="true" />
                    <span className="bundle-module-name">{getModuleDisplayName(module.subject_name)}</span>
                    {isFullBundle && <small>Included</small>}
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <footer className="bundle-checkout-footer">
          <p className="bundle-checkout-trust">Payment is secured by Paystack.</p>
          {error && <p className="action-error" role="alert">{error}</p>}
          <button
            aria-busy={paying}
            className="bundle-checkout-pay"
            disabled={paying || !selectionComplete}
            onClick={() => void onPay(offer, selectedSlugs)}
            type="button"
          >
            {payCopy}
          </button>
        </footer>
      </section>
    </div>
  );
}
