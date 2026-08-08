import { useMemo, useState } from "react";
import { getModuleDisplayName } from "../../lib/moduleDisplay";
import { formatModuleMoney } from "../../lib/pricing";
import {
  ACCESS_TYPE_CODES,
  DEFAULT_DURATION_MONTHS,
  PRICING_PLAN_CODES,
  buildPlanCheckoutPayload,
  buildPlanCtaCopy,
  chooseDefaultDuration,
  findPlan,
  getDurationLabel,
  getDurationPrice,
  getEligibleModules,
  getIndividualPlanCodeForModule,
  getModuleName,
  getModuleSlug,
  getPlanCodeForAccessType,
  getRequiredModuleCount,
  getSavingsAmountKobo,
  getSelectedModules,
  normalizePricingCatalog,
  validatePlanSelection,
} from "../../lib/pricingPlans";

const SCOPE_LABELS = {
  [ACCESS_TYPE_CODES.INDIVIDUAL]: "One module",
  [ACCESS_TYPE_CODES.PICK_THREE]: "Pick 3",
  [ACCESS_TYPE_CODES.COMPLETE]: "Complete",
};

function uniqueValues(values) {
  return Array.from(new Set((Array.isArray(values) ? values : []).filter(Boolean)));
}

function normalizeModules(modules) {
  return getEligibleModules(modules).map((module) => ({
    ...module,
    subject_slug: getModuleSlug(module),
    subject_name: getModuleName(module),
  }));
}

function getFallbackPlan(catalog) {
  return normalizePricingCatalog(catalog).find((plan) => plan.is_available !== false && plan.durations.length > 0) ?? null;
}

function isPlanAvailable(catalog, planCode) {
  const plan = findPlan(catalog, planCode);
  return Boolean(plan && plan.is_available !== false && plan.durations.length > 0);
}

function getInitialScope({ catalog, initialScope, initialModule }) {
  if (initialScope === "pick3" && isPlanAvailable(catalog, PRICING_PLAN_CODES.THREE_MODULE_BUNDLE)) {
    return ACCESS_TYPE_CODES.PICK_THREE;
  }
  if (initialScope === "complete" && isPlanAvailable(catalog, PRICING_PLAN_CODES.COMPLETE_BUNDLE)) {
    return ACCESS_TYPE_CODES.COMPLETE;
  }
  if (initialModule && isPlanAvailable(catalog, getIndividualPlanCodeForModule(initialModule))) {
    return ACCESS_TYPE_CODES.INDIVIDUAL;
  }
  if (isPlanAvailable(catalog, PRICING_PLAN_CODES.INDIVIDUAL_OBJECTIVE)) {
    return ACCESS_TYPE_CODES.INDIVIDUAL;
  }
  if (isPlanAvailable(catalog, PRICING_PLAN_CODES.THREE_MODULE_BUNDLE)) return ACCESS_TYPE_CODES.PICK_THREE;
  if (isPlanAvailable(catalog, PRICING_PLAN_CODES.COMPLETE_BUNDLE)) return ACCESS_TYPE_CODES.COMPLETE;
  return ACCESS_TYPE_CODES.INDIVIDUAL;
}

function durationBadge(duration) {
  if (duration?.discount_label) return duration.discount_label;
  const savings = getSavingsAmountKobo(duration);
  if (savings > 0) return `Save ${formatModuleMoney(savings, duration.currency)}`;
  return "";
}

function getSelectionLabel({ plan, selectedCount, requiredCount, isCompleteBundle }) {
  if (isCompleteBundle) {
    return `${Number(plan?.current_available_module_count ?? plan?.modules?.length ?? 0)} included`;
  }
  if (requiredCount > 1) return `${selectedCount} of ${requiredCount} selected`;
  return selectedCount > 0 ? "1 selected" : "Choose a module";
}

function getPayButtonLabel({ paying, validation }) {
  if (paying) return "Preparing payment...";
  if (!validation.ok) return validation.message;
  return "Continue to payment";
}

export function AccessPurchasePanel({
  catalog = [],
  error = "",
  initialScope = "",
  initialSubjectSlug = "",
  modules = [],
  onPay,
  paying = false,
}) {
  const normalizedCatalog = useMemo(() => normalizePricingCatalog(catalog), [catalog]);
  const availableModules = useMemo(() => normalizeModules(modules), [modules]);
  const initialModule = availableModules.find((module) => getModuleSlug(module) === initialSubjectSlug) ?? null;
  const [scope, setScope] = useState(() => getInitialScope({
    catalog: normalizedCatalog,
    initialScope,
    initialModule,
  }));
  const [durationMonths, setDurationMonths] = useState(DEFAULT_DURATION_MONTHS);
  const [selectedSlugs, setSelectedSlugs] = useState(() => (
    initialModule ? [getModuleSlug(initialModule)] : []
  ));

  const selectedModule = availableModules.find((module) => selectedSlugs.includes(getModuleSlug(module))) ?? null;
  const planCode = getPlanCodeForAccessType({ accessType: scope, selectedModule });
  const plan = findPlan(normalizedCatalog, planCode) ?? getFallbackPlan(normalizedCatalog);
  const isCompleteBundle = plan?.plan_code === PRICING_PLAN_CODES.COMPLETE_BUNDLE;
  const isPickThree = plan?.plan_code === PRICING_PLAN_CODES.THREE_MODULE_BUNDLE;
  const requiredCount = getRequiredModuleCount(plan);
  const validModuleSlugs = new Set(availableModules.map((module) => getModuleSlug(module)));
  const effectiveSelectedSlugs = !plan || isCompleteBundle
    ? []
    : uniqueValues(selectedSlugs)
      .filter((slug) => validModuleSlugs.has(slug))
      .slice(0, Math.max(requiredCount, 1));
  const selectedModules = getSelectedModules(availableModules, effectiveSelectedSlugs);
  const safeDurationMonths = plan ? chooseDefaultDuration(plan, durationMonths) : durationMonths;
  const selectedDuration = getDurationPrice(plan, safeDurationMonths);
  const checkoutPayload = buildPlanCheckoutPayload({
    plan,
    durationMonths: safeDurationMonths,
    selectedSlugs: effectiveSelectedSlugs,
  });
  const ctaCopy = buildPlanCtaCopy({
    plan,
    durationMonths: safeDurationMonths,
    selectedSlugs: effectiveSelectedSlugs,
    paying,
  });
  const validation = validatePlanSelection({ plan, selectedSlugs: effectiveSelectedSlugs });
  const selectionLabel = getSelectionLabel({
    plan,
    selectedCount: effectiveSelectedSlugs.length,
    requiredCount,
    isCompleteBundle,
  });

  function switchScope(nextScope) {
    if (paying || nextScope === scope) return;
    setScope(nextScope);
    if (nextScope === ACCESS_TYPE_CODES.COMPLETE) return;
    setSelectedSlugs((currentSlugs) => uniqueValues(currentSlugs).filter((slug) => validModuleSlugs.has(slug)));
  }

  function toggleModule(subjectSlug) {
    if (paying || isCompleteBundle) return;
    setSelectedSlugs((currentSlugs) => {
      const current = uniqueValues(currentSlugs).filter((slug) => validModuleSlugs.has(slug));
      if (current.includes(subjectSlug)) return current.filter((slug) => slug !== subjectSlug);
      if (isPickThree && current.length >= requiredCount) return current;
      if (!isPickThree) return [subjectSlug];
      return [...current, subjectSlug];
    });
  }

  function submitPayment() {
    if (!checkoutPayload || paying) return;
    onPay(checkoutPayload);
  }

  if (!plan) {
    return (
      <section className="access-purchase-panel" aria-labelledby="access-purchase-title">
        <h2 id="access-purchase-title">Buy access</h2>
        <p className="access-purchase-empty">Access options are not available right now.</p>
      </section>
    );
  }

  const includedModules = isCompleteBundle ? plan.modules : selectedModules;
  const summaryName = isCompleteBundle
    ? "Complete"
    : isPickThree
      ? "Pick 3"
      : selectedModules[0] ? getModuleDisplayName(selectedModules[0].subject_name) : "One module";

  return (
    <section className="access-purchase-panel" id="buy-access" aria-labelledby="access-purchase-title">
      <div className="access-purchase-main">
        <header className="access-purchase-heading">
          <h2 id="access-purchase-title">Buy access</h2>
        </header>

        <section className="access-purchase-group" aria-labelledby="access-scope-title">
          <h3 id="access-scope-title">Scope</h3>
          <div className="access-scope-control">
            {Object.values(ACCESS_TYPE_CODES).map((scopeCode) => {
              const scopePlanCode = getPlanCodeForAccessType({ accessType: scopeCode, selectedModule });
              const scopePlan = findPlan(normalizedCatalog, scopePlanCode);
              const available = Boolean(scopePlan?.is_available !== false && scopePlan?.durations?.length);
              return (
                <button
                  aria-pressed={scopeCode === scope}
                  className={`access-scope-button${scopeCode === scope ? " is-selected" : ""}`}
                  disabled={paying || !available}
                  key={scopeCode}
                  onClick={() => switchScope(scopeCode)}
                  type="button"
                >
                  {SCOPE_LABELS[scopeCode]}
                </button>
              );
            })}
          </div>
        </section>

        {!isCompleteBundle && (
          <section className="access-purchase-group" aria-labelledby="access-module-title">
            <div className="access-purchase-group-head">
              <h3 id="access-module-title">Module</h3>
              <span>{selectionLabel}</span>
            </div>
            <div className="access-purchase-module-list" aria-label={isPickThree ? "Choose 3 modules" : "Choose one module"}>
              {availableModules.map((module) => {
                const slug = getModuleSlug(module);
                const selected = effectiveSelectedSlugs.includes(slug);
                const disableUnselected = isPickThree && !selected && effectiveSelectedSlugs.length >= requiredCount;
                return (
                  <button
                    aria-pressed={selected}
                    className={`access-purchase-module-row${selected ? " is-selected" : ""}`}
                    disabled={paying || disableUnselected}
                    key={module.subject_id ?? slug}
                    onClick={() => toggleModule(slug)}
                    type="button"
                  >
                    <span className="access-purchase-radio" aria-hidden="true" />
                    <span className="access-purchase-module-name">{getModuleDisplayName(module.subject_name)}</span>
                    {module.practice_type === "oral" && <small>Oral</small>}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <section className="access-purchase-group" aria-labelledby="access-length-title">
          <h3 id="access-length-title">Length</h3>
          <div className="access-purchase-duration-list">
            {plan.durations.map((duration) => {
              const selected = Number(duration.duration_months) === Number(safeDurationMonths);
              return (
                <button
                  aria-pressed={selected}
                  className={`access-purchase-duration-row${selected ? " is-selected" : ""}`}
                  disabled={paying}
                  key={duration.duration_months}
                  onClick={() => setDurationMonths(Number(duration.duration_months))}
                  type="button"
                >
                  <span>{getDurationLabel(duration.duration_months)}</span>
                  <strong>{formatModuleMoney(duration.price_kobo, duration.currency)}</strong>
                  {durationBadge(duration) && <small>{durationBadge(duration)}</small>}
                </button>
              );
            })}
          </div>
        </section>

        {isCompleteBundle && (
          <section className="access-purchase-group" aria-labelledby="access-included-title">
            <div className="access-purchase-group-head">
              <h3 id="access-included-title">Included</h3>
              <span>{selectionLabel}</span>
            </div>
            <details className="access-purchase-included">
              <summary>View modules</summary>
              <div className="access-purchase-included-list">
                {includedModules.map((module) => (
                  <span key={module.subject_id ?? getModuleSlug(module)}>
                    {getModuleDisplayName(module.subject_name ?? module.name)}
                  </span>
                ))}
              </div>
            </details>
          </section>
        )}
      </div>

      <aside className="access-order-summary" aria-label="Order summary">
        <div className="access-order-summary-main">
          <span>Total</span>
          <strong>{selectedDuration ? formatModuleMoney(selectedDuration.price_kobo, selectedDuration.currency) : "Not available"}</strong>
        </div>
        <p className="access-order-summary-choice">{summaryName}{selectedDuration ? ` - ${getDurationLabel(selectedDuration.duration_months)}` : ""}</p>
        {selectedModules.length > 1 && (
          <p className="access-order-summary-modules">{selectedModules.map((module) => getModuleDisplayName(module.subject_name)).join(", ")}</p>
        )}
        {error && <p className="action-error" role="alert">{error}</p>}
        {!validation.ok && <p className="access-order-hint">{validation.message}</p>}
        <button
          aria-busy={paying}
          className="access-order-pay"
          disabled={paying || !checkoutPayload}
          onClick={submitPayment}
          type="button"
        >
          {getPayButtonLabel({ paying, validation }) || ctaCopy}
        </button>
      </aside>
    </section>
  );
}
