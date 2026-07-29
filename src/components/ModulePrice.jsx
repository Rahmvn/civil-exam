import { formatModuleMoney } from "../lib/pricing";

export function ModulePrice({ module, compact = false }) {
  const regularPrice = Number(module?.regular_price_kobo ?? module?.price_kobo);
  const currentPrice = Number(module?.price_kobo);
  const offerActive = Boolean(
    module?.launch_offer_active
      && Number.isFinite(regularPrice)
      && Number.isFinite(currentPrice)
      && currentPrice < regularPrice,
  );

  return (
    <span className={`module-price${offerActive ? " is-launch-offer" : ""}${compact ? " is-compact" : ""}`}>
      {offerActive && (
        <span className="module-price-regular">
          <span>Regular price</span>
          <del>{formatModuleMoney(regularPrice, module.currency)}</del>
        </span>
      )}
      <span className="module-price-current">
        {offerActive && <span>Launch price</span>}
        <strong>{formatModuleMoney(currentPrice, module?.currency)}</strong>
      </span>
    </span>
  );
}
