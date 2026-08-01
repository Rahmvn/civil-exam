import { useEffect, useMemo, useState } from "react";
import { formatLaunchOfferEnd, formatModuleMoney } from "../lib/pricing";
import { getModuleDisplayName } from "../lib/moduleDisplay";

function offerModules(offer) {
  return Array.isArray(offer?.modules) ? offer.modules : [];
}

function GiftMark({ className = "" }) {
  return (
    <span className={`bundle-gift-mark ${className}`.trim()} aria-hidden="true">
      <svg focusable="false" viewBox="0 0 24 24">
        <path d="M4.75 10.25h14.5v8.5H4.75z" />
        <path d="M3.75 6.75h16.5v3.5H3.75z" />
        <path d="M12 6.75v12" />
        <path d="M12 6.75c-1.25-2.65-4.85-2.8-4.85-.45 0 1.55 1.65 2.1 4.85.45Z" />
        <path d="M12 6.75c1.25-2.65 4.85-2.8 4.85-.45 0 1.55-1.65 2.1-4.85.45Z" />
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

function getOfferSavings(offer, selectedListPrice = null) {
  const comparison = getOfferComparisonPrice(offer, selectedListPrice);
  const price = Number(offer?.price_kobo);

  if (!comparison || !Number.isFinite(price) || comparison <= price) return "";
  return `Save ${formatModuleMoney(comparison - price, offer.currency)}`;
}

function getOfferDescriptor(offer) {
  if (offer?.offer_type === "full_bundle") return "All available modules";
  return `Any ${getOfferModuleCount(offer)} modules`;
}

function getOfferBodyCopy(offer) {
  if (offer?.offer_type === "full_bundle") return "Unlock every available module.";
  return `Choose ${getOfferModuleCount(offer)} modules in one payment.`;
}

function getOfferActionCopy(offer) {
  if (offer?.offer_type === "full_bundle") return "Review";
  return "Choose";
}

export function BundleOfferTrigger({ offer, onChoose, variant = "dashboard" }) {
  if (!offer) return null;

  return (
    <button className={`bundle-offer-trigger is-${variant}`} onClick={() => onChoose(offer)} type="button">
      <GiftMark />
      <span>Bundle offer</span>
    </button>
  );
}

export function BundleOffers({ offers = [], onChoose }) {
  if (offers.length === 0) return null;

  return (
    <section className="bundle-offers" id="bundles" aria-labelledby="bundle-offers-title">
      <header className="bundle-offers-heading">
        <div>
          <span>Bundle offer</span>
          <h2 id="bundle-offers-title">Save when unlocking multiple modules</h2>
        </div>
      </header>

      <div className="bundle-offer-list">
        {offers.map((offer) => {
          const comparisonPrice = getOfferComparisonPrice(offer);
          const savings = getOfferSavings(offer);

          return (
            <article className="bundle-offer-row" key={offer.offer_id}>
              <GiftMark />
              <div className="bundle-offer-row-copy">
                <h3>{offer.offer_name}</h3>
                <p>{getOfferBodyCopy(offer)}</p>
              </div>
              <div className="bundle-offer-row-price">
                <strong>{formatModuleMoney(offer.price_kobo, offer.currency)}</strong>
                {comparisonPrice && <small>{formatModuleMoney(comparisonPrice, offer.currency)} separately</small>}
                {savings && <span>{savings}</span>}
              </div>
              <button className="bundle-offer-row-action" type="button" onClick={() => onChoose(offer)}>
                {getOfferActionCopy(offer)}
              </button>
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
  const savings = selectionComplete
    ? getOfferSavings(offer, selectedListPrice)
    : getOfferSavings(offer);
  const selectionLabel = isFullBundle
    ? `${modules.length} modules included`
    : selectionComplete ? "Ready for payment" : `${selected.length} of ${requiredCount} selected`;

  function toggleModule(subjectSlug) {
    if (paying || isFullBundle) return;
    setSelectionState((currentState) => {
      const current = currentState.offerId === offer.offer_id ? currentState.slugs : [];
      if (current.includes(subjectSlug)) {
        return { offerId: offer.offer_id, slugs: current.filter((slug) => slug !== subjectSlug) };
      }
      if (current.length >= requiredCount) return currentState.offerId === offer.offer_id ? currentState : { offerId: offer.offer_id, slugs: current };
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
        <button className="bundle-checkout-handle" aria-label="Close bundle checkout" onClick={onClose} type="button" />

        <header className="bundle-checkout-head">
          <div className="bundle-checkout-title-block">
            <span><GiftMark /> Bundle offer</span>
            <h2 id="bundle-checkout-title">{offer.offer_name}</h2>
            <p>{getOfferDescriptor(offer)}</p>
          </div>
          <button className="bundle-checkout-close" aria-label="Close bundle checkout" disabled={paying} onClick={onClose} type="button">&times;</button>
        </header>

        <div className="bundle-checkout-body">
          <section className="bundle-checkout-summary" aria-label="Bundle price">
            <strong>{formatModuleMoney(offer.price_kobo, offer.currency)}</strong>
            <div>
              {comparisonPrice && <span>{formatModuleMoney(comparisonPrice, offer.currency)} separately</span>}
              {savings && <span>{savings}</span>}
            </div>
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
                    className={selectedModule ? "is-selected" : ""}
                    disabled={isFullBundle || paying}
                    key={module.subject_id}
                    onClick={() => toggleModule(module.subject_slug)}
                    type="button"
                  >
                    <span className="bundle-module-check" aria-hidden="true">{selectedModule ? "✓" : ""}</span>
                    <span className="bundle-module-name">{getModuleDisplayName(module.subject_name)}</span>
                    {isFullBundle && <small>Included</small>}
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <footer className="bundle-checkout-footer">
          {error && <p className="action-error" role="alert">{error}</p>}
          <button
            aria-busy={paying}
            className="bundle-checkout-pay"
            disabled={paying || !selectionComplete}
            onClick={() => void onPay(offer, selectedSlugs)}
            type="button"
          >
            {paying ? "Preparing payment..." : "Continue to payment"}
          </button>
        </footer>
      </section>
    </div>
  );
}
