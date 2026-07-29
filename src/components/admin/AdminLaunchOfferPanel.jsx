import { useState } from "react";
import { formatLaunchOfferEnd, formatModuleMoney } from "../../lib/pricing";

const WAT_OFFSET_MS = 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function toWatInput(value) {
  if (!value) return "";
  return new Date(new Date(value).getTime() + WAT_OFFSET_MS).toISOString().slice(0, 16);
}

function fromWatInput(value) {
  return new Date(`${value}:00+01:00`).toISOString();
}

function defaultWindow() {
  const start = new Date(Date.now() + 30 * 60 * 1000);
  start.setUTCSeconds(0, 0);
  const end = new Date(start.getTime() + SEVEN_DAYS_MS);
  return { start: toWatInput(start), end: toWatInput(end) };
}

function buildInitialModulePrices(offer, modules) {
  const configured = new Map(
    (Array.isArray(offer?.module_prices) ? offer.module_prices : [])
      .map((item) => [item.subject_id, item.discounted_price_kobo]),
  );

  return Object.fromEntries(
    modules.map((module) => [
      module.subject_id,
      configured.has(module.subject_id) ? String(Number(configured.get(module.subject_id)) / 100) : "",
    ]),
  );
}

export function AdminLaunchOfferPanel({ modules = [], offer, busy, onEnd, onSchedule }) {
  const defaults = defaultWindow();
  const eligibleModules = modules.filter((module) => (
    module.lifecycle_status === "active"
    && module.price_kobo
    && module.currency === "NGN"
  ));
  const [priceBySubject, setPriceBySubject] = useState(() => buildInitialModulePrices(offer, eligibleModules));
  const [startsAt, setStartsAt] = useState(offer?.starts_at ? toWatInput(offer.starts_at) : defaults.start);
  const [endsAt, setEndsAt] = useState(offer?.ends_at ? toWatInput(offer.ends_at) : defaults.end);
  const status = offer?.status ?? "not_configured";
  const canConfigure = status === "not_configured" || status === "scheduled" || status === "cancelled";
  const allPricesPresent = eligibleModules.length > 0 && eligibleModules.every((module) => {
    const priceKobo = Math.round(Number(priceBySubject[module.subject_id]) * 100);
    return Number.isInteger(priceKobo) && priceKobo > 0 && priceKobo < Number(module.price_kobo);
  });

  function submit(event) {
    event.preventDefault();
    const modulePrices = eligibleModules.map((module) => ({
      subjectId: module.subject_id,
      discountedPriceKobo: Math.round(Number(priceBySubject[module.subject_id]) * 100),
    }));
    if (!allPricesPresent) return;
    onSchedule({
      modulePrices,
      startsAt: fromWatInput(startsAt),
      endsAt: fromWatInput(endsAt),
    });
  }

  return (
    <section className="admin-launch-offer" aria-labelledby="admin-launch-offer-title">
      <div className="admin-launch-offer-copy">
        <div className="admin-launch-offer-heading">
          <h2 id="admin-launch-offer-title">One-time launch offer</h2>
          <span className={`admin-status admin-status-${status}`}>{status.replace("_", " ")}</span>
        </div>
        <p>
          Sets one genuine discounted price per active NGN module for no more than seven days.
          Candidate pages show the regular price crossed out, checkout verifies the discount on the server,
          and the offer ends automatically. Once it starts, it cannot be restarted or rescheduled.
        </p>
        {offer?.eligible_module_count > 0 && (
          <small>
            {offer.eligible_module_count} eligible modules. Regular price
            {offer.minimum_regular_price_kobo === offer.maximum_regular_price_kobo ? " " : " range "}
            {formatModuleMoney(offer.minimum_regular_price_kobo)}
            {offer.minimum_regular_price_kobo !== offer.maximum_regular_price_kobo
              ? ` to ${formatModuleMoney(offer.maximum_regular_price_kobo)}`
              : ""}.
          </small>
        )}
        {(status === "live" || status === "ended") && offer?.ends_at && (
          <small>{status === "live" ? "Ends" : "Ended"} {formatLaunchOfferEnd(offer.ends_at)} WAT.</small>
        )}
      </div>

      {canConfigure ? (
        <form className="admin-launch-offer-form" onSubmit={submit}>
          <fieldset className="admin-launch-offer-prices">
            <legend>Launch prices (NGN)</legend>
            {eligibleModules.map((module) => {
              const priceNaira = Number(module.price_kobo) / 100;
              return (
                <label key={module.subject_id}>
                  <span>
                    <strong>{module.subject_name}</strong>
                    <small>Regular {formatModuleMoney(module.price_kobo, module.currency)}</small>
                  </span>
                  <input
                    max={Math.max(1, priceNaira - 1)}
                    min="1"
                    required
                    step="1"
                    type="number"
                    value={priceBySubject[module.subject_id] ?? ""}
                    onChange={(event) => setPriceBySubject((current) => ({
                      ...current,
                      [module.subject_id]: event.target.value,
                    }))}
                  />
                </label>
              );
            })}
          </fieldset>
          <label>
            Starts (WAT)
            <input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          </label>
          <label>
            Ends (WAT)
            <input required type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          </label>
          <button disabled={busy || !allPricesPresent || !startsAt || !endsAt} type="submit">
            {status === "scheduled" ? "Update schedule" : "Schedule offer"}
          </button>
          {(status === "scheduled" || status === "cancelled") && (
            <button className="ghost-button" disabled={busy || status === "cancelled"} onClick={onEnd} type="button">
              Cancel offer
            </button>
          )}
        </form>
      ) : status === "live" ? (
        <button className="admin-danger-button" disabled={busy} onClick={onEnd} type="button">End offer early</button>
      ) : null}
    </section>
  );
}
