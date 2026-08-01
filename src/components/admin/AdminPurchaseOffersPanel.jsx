import { useState } from "react";
import { formatModuleMoney } from "../../lib/pricing";

const WAT_OFFSET_MS = 60 * 60 * 1000;

function toWatInput(value) {
  if (!value) return "";
  return new Date(new Date(value).getTime() + WAT_OFFSET_MS).toISOString().slice(0, 16);
}

function fromWatInput(value) {
  return value ? new Date(`${value}:00+01:00`).toISOString() : null;
}

function initialDraft(offer = null) {
  const offerType = offer?.offer_type ?? "pick_n_modules";
  return {
    offerId: offer?.offer_id ?? null,
    name: offer?.offer_name ?? (offerType === "full_bundle" ? "Full bundle" : "Any 3 modules"),
    offerType,
    selectionCount: Number(offer?.selection_count ?? 3),
    price: offer?.price_kobo ? String(Number(offer.price_kobo) / 100) : "",
    startsAt: toWatInput(offer?.starts_at),
    endsAt: toWatInput(offer?.ends_at),
    enabled: Boolean(offer?.enabled),
  };
}

export function AdminPurchaseOffersPanel({ busy, offers = [], onSave, onToggle }) {
  const [draft, setDraft] = useState(null);

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function changeType(offerType) {
    setDraft((current) => ({
      ...current,
      offerType,
      name: current.offerId
        ? current.name
        : offerType === "full_bundle" ? "Full bundle" : "Any 3 modules",
    }));
  }

  function submit(event) {
    event.preventDefault();
    const priceKobo = Math.round(Number(draft.price) * 100);
    if (!Number.isInteger(priceKobo) || priceKobo <= 0) return;
    onSave({
      offerId: draft.offerId,
      name: draft.name.trim(),
      offerType: draft.offerType,
      selectionCount: draft.offerType === "pick_n_modules" ? Number(draft.selectionCount) : null,
      priceKobo,
      startsAt: fromWatInput(draft.startsAt),
      endsAt: fromWatInput(draft.endsAt),
      enabled: draft.enabled,
    }, () => setDraft(null));
  }

  return (
    <section className="admin-purchase-offers" aria-labelledby="admin-purchase-offers-title">
      <header>
        <div>
          <h2 id="admin-purchase-offers-title">Bundle offers</h2>
          <p>Sell a choose-your-own bundle or every available module in one payment.</p>
        </div>
        {!draft && <button type="button" onClick={() => setDraft(initialDraft())}>Create bundle</button>}
      </header>

      {offers.length > 0 && (
        <div className="admin-purchase-offer-list">
          {offers.map((offer) => (
            <article key={offer.offer_id}>
              <div>
                <span className={`admin-status admin-status-${offer.status}`}>{offer.status}</span>
                <h3>{offer.offer_name}</h3>
                <p>
                  {offer.offer_type === "full_bundle"
                    ? `All ${offer.eligible_module_count} modules`
                    : `Any ${offer.selection_count} of ${offer.eligible_module_count} modules`}
                </p>
              </div>
              <div className="admin-purchase-offer-value">
                <strong>{formatModuleMoney(offer.price_kobo, offer.currency)}</strong>
                {Number(offer.minimum_comparison_price_kobo) > Number(offer.price_kobo) && (
                  <small>Separate price from {formatModuleMoney(offer.minimum_comparison_price_kobo, offer.currency)}</small>
                )}
              </div>
              <div className="admin-purchase-offer-actions">
                <button className="ghost-button" disabled={busy} onClick={() => setDraft(initialDraft(offer))} type="button">Edit</button>
                <button
                  className={offer.enabled ? "admin-danger-button" : ""}
                  disabled={busy}
                  onClick={() => onToggle(offer, !offer.enabled)}
                  type="button"
                >
                  {offer.enabled ? "Disable" : "Enable"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {draft && (
        <form className="admin-purchase-offer-form" onSubmit={submit}>
          <label>
            Bundle type
            <select value={draft.offerType} onChange={(event) => changeType(event.target.value)}>
              <option value="pick_n_modules">Choose any modules</option>
              <option value="full_bundle">All available modules</option>
            </select>
          </label>
          {draft.offerType === "pick_n_modules" && (
            <label>
              Modules to choose
              <input min="2" max="10" required type="number" value={draft.selectionCount} onChange={(event) => update("selectionCount", event.target.value)} />
            </label>
          )}
          <label>
            Name candidates see
            <input maxLength="80" minLength="2" required value={draft.name} onChange={(event) => update("name", event.target.value)} />
          </label>
          <label>
            Bundle price (NGN)
            <input min="1" required step="1" type="number" value={draft.price} onChange={(event) => update("price", event.target.value)} />
          </label>
          <label>
            Starts (WAT, optional)
            <input type="datetime-local" value={draft.startsAt} onChange={(event) => update("startsAt", event.target.value)} />
          </label>
          <label>
            Ends (WAT, optional)
            <input min={draft.startsAt || undefined} type="datetime-local" value={draft.endsAt} onChange={(event) => update("endsAt", event.target.value)} />
          </label>
          <label className="admin-purchase-offer-enabled">
            <input checked={draft.enabled} type="checkbox" onChange={(event) => update("enabled", event.target.checked)} />
            Make visible when saved
          </label>
          <div className="admin-purchase-offer-form-actions">
            <button disabled={busy} type="submit">Save bundle</button>
            <button className="ghost-button" disabled={busy} onClick={() => setDraft(null)} type="button">Cancel</button>
          </div>
        </form>
      )}
    </section>
  );
}
