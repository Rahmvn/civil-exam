import { getModuleDisplayName } from "../../lib/moduleDisplay";
import { getModuleSlug } from "../../lib/pricingPlans";
import "./ModuleSelector.css";

function getModuleName(module) {
  return getModuleDisplayName(module?.subject_name ?? module?.name ?? "Module");
}

export function ModuleSelector({ contextLabel, disabled = false, modules, onToggle, requiredCount, selectedSlugs }) {
  const selectedCount = selectedSlugs.length;

  return (
    <fieldset className="purchase-module-selector">
      <legend className="purchase-module-selector__legend">
        <span>{contextLabel}</span>
        <span aria-live="polite">{`${selectedCount} of ${requiredCount} selected`}</span>
      </legend>
      <div className="purchase-module-selector__list">
        {modules.map((module) => {
          const slug = getModuleSlug(module);
          const selected = selectedSlugs.includes(slug);
          const atMaximum = !selected && selectedCount >= requiredCount;
          const inputId = `purchase-module-${slug}`;

          return (
            <label
              className={`purchase-module-selector__option${selected ? " is-selected" : ""}`}
              htmlFor={inputId}
              key={slug}
            >
              <input
                checked={selected}
                className="purchase-module-selector__checkbox"
                disabled={disabled || atMaximum}
                id={inputId}
                onChange={() => onToggle(slug)}
                type="checkbox"
              />
              <span>{getModuleName(module)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
