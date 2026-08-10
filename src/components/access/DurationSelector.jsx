import { formatModuleMoney } from "../../lib/pricing";
import { getDurationLabel, getSavingsAmountKobo } from "../../lib/pricingPlans";
import "./DurationSelector.css";

function getDurationBadge(duration) {
  if (duration?.discount_label) return duration.discount_label;
  const savings = getSavingsAmountKobo(duration);
  if (savings > 0) return `Save ${formatModuleMoney(savings, duration.currency)}`;
  return "";
}

export function DurationSelector({ disabled = false, idPrefix, legend = "Choose how long you want access", onChange, plan, value }) {
  return (
    <fieldset className="purchase-duration-selector">
      <legend className="purchase-duration-selector__legend">{legend}</legend>
      <div className="purchase-duration-selector__list">
        {plan.durations.map((option) => {
          const months = Number(option.duration_months);
          const selected = months === Number(value);
          const badge = getDurationBadge(option);
          const inputId = `${idPrefix}-duration-${months}`;
          const optionDisabled = disabled || option.enabled === false || option.is_available === false;

          return (
            <label
              className={`purchase-duration-selector__option${selected ? " is-selected" : ""}`}
              htmlFor={inputId}
              key={option.duration_months}
            >
              <input
                checked={selected}
                className="purchase-duration-selector__radio"
                disabled={optionDisabled}
                id={inputId}
                name={`${idPrefix}-duration`}
                onChange={() => onChange(months)}
                type="radio"
                value={months}
              />
              <span className="purchase-duration-selector__content">
                <strong>{getDurationLabel(months)}</strong>
                {badge && <small>{badge}</small>}
              </span>
              <span className="purchase-duration-selector__price">{formatModuleMoney(option.price_kobo, option.currency)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
