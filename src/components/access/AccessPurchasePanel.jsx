import { useMemo, useState } from "react";
import { getModuleDisplayName } from "../../lib/moduleDisplay";
import { formatModuleMoney } from "../../lib/pricing";
import {
  DEFAULT_DURATION_MONTHS,
  PRICING_PLAN_CODES,
  buildPlanCheckoutPayload,
  chooseDefaultDuration,
  findPlan,
  getDurationLabel,
  getDurationPrice,
  getEligibleModules,
  getIndividualPlanCodeForModule,
  getModuleName,
  getModuleSlug,
  getRequiredModuleCount,
  getSavingsAmountKobo,
  getSelectedModules,
  normalizePricingCatalog,
  validatePlanSelection,
} from "../../lib/pricingPlans";

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

function durationBadge(duration) {
  if (duration?.discount_label) return duration.discount_label;
  const savings = getSavingsAmountKobo(duration);
  if (savings > 0) return `Save ${formatModuleMoney(savings, duration.currency)}`;
  return "";
}

function getPlanDisplayName(plan, fallback = "Access") {
  return String(plan?.display_name || fallback).trim();
}

function getLowestDurationPrice(plan) {
  const durations = Array.isArray(plan?.durations) ? plan.durations : [];
  return durations.reduce((lowest, duration) => (
    !lowest || Number(duration.price_kobo) < Number(lowest.price_kobo) ? duration : lowest
  ), null);
}

function getSelectionLabel({ selectedCount, requiredCount, totalCount, isCompleteBundle }) {
  if (isCompleteBundle) return `${totalCount} selected`;
  if (requiredCount > 1) return `${selectedCount} of ${requiredCount} selected`;
  if (selectedCount === 0) return "Choose a module";
  return "1 selected";
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
  const directModuleIntent = Boolean(initialModule);
  const pickThreePlan = findPlan(normalizedCatalog, PRICING_PLAN_CODES.THREE_MODULE_BUNDLE);
  const completePlan = findPlan(normalizedCatalog, PRICING_PLAN_CODES.COMPLETE_BUNDLE);
  const pickThreeCount = getRequiredModuleCount(pickThreePlan) || 3;
  const canPickThree = isPlanAvailable(normalizedCatalog, PRICING_PLAN_CODES.THREE_MODULE_BUNDLE);
  const canComplete = isPlanAvailable(normalizedCatalog, PRICING_PLAN_CODES.COMPLETE_BUNDLE);
  const [targetMode, setTargetMode] = useState(() => {
    if (initialScope === "complete" && canComplete) return "complete";
    if (initialScope === "pick3" && canPickThree) return "pick3";
    return "auto";
  });
  const [showModuleBuilder, setShowModuleBuilder] = useState(() => !directModuleIntent);
  const [durationMonths, setDurationMonths] = useState(DEFAULT_DURATION_MONTHS);
  const [selectedSlugs, setSelectedSlugs] = useState(() => {
    if (initialScope === "complete" && canComplete) {
      return availableModules.map((module) => getModuleSlug(module));
    }
    return initialModule ? [getModuleSlug(initialModule)] : [];
  });

  const validModuleSlugs = new Set(availableModules.map((module) => getModuleSlug(module)));
  const effectiveSelectedSlugs = uniqueValues(selectedSlugs)
    .filter((slug) => validModuleSlugs.has(slug))
    .slice(0, availableModules.length);
  const selectedModules = getSelectedModules(availableModules, effectiveSelectedSlugs);
  const selectedCount = selectedModules.length;
  const selectedModule = selectedModules[0] ?? null;
  const isCompleteBundle = canComplete && targetMode === "complete";
  const isPickThree = canPickThree && !isCompleteBundle && (
    targetMode === "pick3" || (selectedCount > 1 && selectedCount <= pickThreeCount)
  );
  const planCode = isCompleteBundle
    ? PRICING_PLAN_CODES.COMPLETE_BUNDLE
    : isPickThree
      ? PRICING_PLAN_CODES.THREE_MODULE_BUNDLE
      : getIndividualPlanCodeForModule(selectedModule);
  const plan = findPlan(normalizedCatalog, planCode) ?? getFallbackPlan(normalizedCatalog);
  const requiredCount = isCompleteBundle ? availableModules.length : getRequiredModuleCount(plan);
  const checkoutSelectedSlugs = isCompleteBundle ? [] : effectiveSelectedSlugs;
  const safeDurationMonths = plan ? chooseDefaultDuration(plan, durationMonths) : durationMonths;
  const selectedDuration = getDurationPrice(plan, safeDurationMonths);
  const hasPurchaseSelection = isCompleteBundle || isPickThree || selectedCount > 0;
  const checkoutPayload = buildPlanCheckoutPayload({
    plan,
    durationMonths: safeDurationMonths,
    selectedSlugs: checkoutSelectedSlugs,
  });
  const validation = validatePlanSelection({ plan, selectedSlugs: checkoutSelectedSlugs });
  const selectionLabel = getSelectionLabel({
    selectedCount,
    requiredCount,
    totalCount: availableModules.length,
    isCompleteBundle,
  });
  const activePlanName = isCompleteBundle
    ? getPlanDisplayName(plan, "Complete")
    : isPickThree
      ? getPlanDisplayName(plan, "Pick 3")
      : selectedModule ? getModuleDisplayName(selectedModule.subject_name) : "One module";
  const pageTitle = directModuleIntent && !showModuleBuilder && !isPickThree && !isCompleteBundle && selectedModule
    ? `Unlock ${getModuleDisplayName(selectedModule.subject_name)}`
    : "Buy access";
  const includedModules = isCompleteBundle ? (plan.modules?.length ? plan.modules : availableModules) : selectedModules;
  const pickThreePrice = getLowestDurationPrice(pickThreePlan);
  const completePrice = getLowestDurationPrice(completePlan);

  function selectPickThree() {
    if (paying || !canPickThree) return;
    setTargetMode("pick3");
    setShowModuleBuilder(true);
    setSelectedSlugs((currentSlugs) => uniqueValues(currentSlugs)
      .filter((slug) => validModuleSlugs.has(slug))
      .slice(0, pickThreeCount));
  }

  function selectComplete() {
    if (paying || !canComplete) return;
    setTargetMode("complete");
    setShowModuleBuilder(false);
    setSelectedSlugs(availableModules.map((module) => getModuleSlug(module)));
  }

  function updateModeForSelection(nextSlugs) {
    if (canPickThree && nextSlugs.length > 1) return "pick3";
    return "auto";
  }

  function toggleModule(subjectSlug) {
    if (paying) return;
    const current = uniqueValues(selectedSlugs).filter((slug) => validModuleSlugs.has(slug));
    const next = current.includes(subjectSlug)
      ? current.filter((slug) => slug !== subjectSlug)
      : targetMode === "pick3" && current.length >= pickThreeCount
        ? current
        : [...current, subjectSlug];
    setTargetMode(updateModeForSelection(next));
    setSelectedSlugs(next);
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

  return (
    <section className="access-purchase-panel" id="buy-access" aria-labelledby="access-purchase-title">
      <div className="access-purchase-main">
        <header className="access-purchase-heading">
          <h2 id="access-purchase-title">{pageTitle}</h2>
        </header>

        {(showModuleBuilder || !directModuleIntent) && !isCompleteBundle && (
          <section className="access-purchase-group" aria-labelledby="access-module-title">
            <div className="access-purchase-group-head">
              <h3 id="access-module-title">Choose modules</h3>
              <span>{selectionLabel}</span>
            </div>
            <div className="access-purchase-module-list" aria-label="Choose modules">
              {availableModules.map((module) => {
                const slug = getModuleSlug(module);
                const selected = effectiveSelectedSlugs.includes(slug);
                const disableUnselected = targetMode === "pick3" && !selected && selectedCount >= pickThreeCount;
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

        {directModuleIntent && !showModuleBuilder && !isCompleteBundle && selectedModule && (
          <section className="access-selected-module" aria-label="Selected module">
            <strong>{getModuleDisplayName(selectedModule.subject_name)}</strong>
            {selectedModule.practice_type === "oral" && <span>Oral</span>}
          </section>
        )}

        {hasPurchaseSelection && (
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
        )}

        {isCompleteBundle && (
          <section className="access-purchase-group" aria-labelledby="access-included-title">
            <div className="access-purchase-group-head">
              <h3 id="access-included-title">{getPlanDisplayName(plan, "Complete")}</h3>
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

        {!isCompleteBundle && (canPickThree || canComplete) && (
          <section className="access-upgrade-options" aria-label="More options">
            {canPickThree && selectedCount < pickThreeCount && (
              <button className="access-upgrade-option" type="button" onClick={selectPickThree} disabled={paying}>
                <span>{getPlanDisplayName(pickThreePlan, "Pick 3")}</span>
                {pickThreePrice && <strong>{formatModuleMoney(pickThreePrice.price_kobo, pickThreePrice.currency)}</strong>}
              </button>
            )}
            {canComplete && selectedCount < availableModules.length && (
              <button className="access-upgrade-option" type="button" onClick={selectComplete} disabled={paying}>
                <span>{getPlanDisplayName(completePlan, "Complete")}</span>
                {completePrice && <strong>{formatModuleMoney(completePrice.price_kobo, completePrice.currency)}</strong>}
              </button>
            )}
          </section>
        )}
      </div>

      <aside className="access-order-summary" aria-label="Order summary">
        <div className="access-order-summary-main">
          <span>Total</span>
          <strong>{hasPurchaseSelection && selectedDuration ? formatModuleMoney(selectedDuration.price_kobo, selectedDuration.currency) : "Not selected"}</strong>
        </div>
        {hasPurchaseSelection && (
          <p className="access-order-summary-choice">
            {activePlanName}{selectedDuration ? ` - ${getDurationLabel(selectedDuration.duration_months)}` : ""}
          </p>
        )}
        {selectedModules.length > 1 && !isCompleteBundle && (
          <p className="access-order-summary-modules">{selectedModules.map((module) => getModuleDisplayName(module.subject_name)).join(", ")}</p>
        )}
        {error && <p className="action-error" role="alert">{error}</p>}
        {!validation.ok && hasPurchaseSelection && <p className="access-order-hint">{validation.message}</p>}
        <button
          aria-busy={paying}
          className="access-order-pay"
          disabled={paying || !checkoutPayload}
          onClick={submitPayment}
          type="button"
        >
          {getPayButtonLabel({ paying, validation })}
        </button>
      </aside>
    </section>
  );
}
