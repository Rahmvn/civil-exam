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

export function AdminLaunchOfferPanel({ offer, busy, onEnd, onSchedule }) {
  const defaults = defaultWindow();
  const [priceNaira, setPriceNaira] = useState(
    offer?.discounted_price_kobo ? String(Number(offer.discounted_price_kobo) / 100) : "",
  );
  const [startsAt, setStartsAt] = useState(offer?.starts_at ? toWatInput(offer.starts_at) : defaults.start);
  const [endsAt, setEndsAt] = useState(offer?.ends_at ? toWatInput(offer.ends_at) : defaults.end);
  const status = offer?.status ?? "not_configured";
  const canConfigure = status === "not_configured" || status === "scheduled" || status === "cancelled";

  function submit(event) {
    event.preventDefault();
    const discountedPriceKobo = Math.round(Number(priceNaira) * 100);
    if (!Number.isInteger(discountedPriceKobo) || discountedPriceKobo <= 0) return;
    onSchedule({
      discountedPriceKobo,
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
          Sets one genuine discounted price across every active NGN module for no more than seven days.
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
          <label>
            Launch price (NGN)
            <input min="1" required step="1" type="number" value={priceNaira} onChange={(event) => setPriceNaira(event.target.value)} />
          </label>
          <label>
            Starts (WAT)
            <input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          </label>
          <label>
            Ends (WAT)
            <input required type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          </label>
          <button disabled={busy || !priceNaira || !startsAt || !endsAt} type="submit">
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
