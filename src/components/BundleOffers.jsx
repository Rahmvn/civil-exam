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

function getOfferSubtitle(offer) {
  if (offer?.offer_type === "full_bundle") return `All ${getOfferModuleCount(offer)} modules`;
  return `Any ${getOfferModuleCount(offer)} modules`;
}

export function BundleOfferTrigger({ offer, onChoose, variant = "dashboard" }) {
  if (!offer) return null;

  const savings = getOfferSavings(offer);

  return (
    <button className={`bundle-offer-trigger is-${variant}`} onClick={() => onChoose(offer)} type="button">
      <GiftMark />
      <span>
        <strong>Bundle offer</strong>
        <small>{savings || getOfferSubtitle(offer)}</small>
      </span>
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
      <div className="bundle-offer-grid">
        {offers.map((offer) => {
          const isFullBundle = offer.offer_type === "full_bundle";
          const comparisonPrice = getOfferComparisonPrice(offer);
          const savings = getOfferSavings(offer);

          return (
            <article className="bundle-offer-card" key={offer.offer_id}>
              <GiftMark />
              <div className="bundle-offer-card-copy">
                <h3>{offer.offer_name}</h3>
                <p>{isFullBundle ? `All ${offer.available_module_count} modules` : `Choose any ${offer.selection_count} modules`}</p>
              </div>
              <div className="bundle-offer-price">
                {comparisonPrice && <del>{formatModuleMoney(comparisonPrice, offer.currency)} separately</del>}
                <strong>{formatModuleMoney(offer.price_kobo, offer.currency)}</strong>
                {savings && <span>{savings}</span>}
              </div>
              <button className="bundle-offer-card-action" type="button" onClick={() => onChoose(offer)}>
                View bundle
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
        className="bundle-checkout-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button className="bundle-checkout-handle" aria-label="Close bundle checkout" onClick={onClose} type="button" />
        <header className="bundle-checkout-header">
          <div>
            <span className="bundle-checkout-kicker"><GiftMark /> Bundle offer</span>
            <h2 id="bundle-checkout-title">{offer.offer_name}</h2>
          </div>
          <button aria-label="Close bundle checkout" disabled={paying} onClick={onClose} type="button">&times;</button>
        </header>

        <div className="bundle-checkout-price" aria-label="Bundle price">
          <div>
            {comparisonPrice && <del>{formatModuleMoney(comparisonPrice, offer.currency)} separately</del>}
            <strong>{formatModuleMoney(offer.price_kobo, offer.currency)}</strong>
          </div>
          <span>{savings || getOfferSubtitle(offer)}</span>
        </div>

        {!isFullBundle && <p className="bundle-checkout-select-note">{selected.length} of {requiredCount} selected</p>}

        <div className="bundle-checkout-modules" aria-label="Modules in bundle">
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
                <span>{getModuleDisplayName(module.subject_name)}</span>
              </button>
            );
          })}
        </div>

        {offer.ends_at && <p className="bundle-checkout-end">Ends {formatLaunchOfferEnd(offer.ends_at)} WAT.</p>}
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
      </section>
    </div>
  );
}
