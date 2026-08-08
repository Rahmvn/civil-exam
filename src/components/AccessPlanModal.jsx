import { useEffect, useMemo, useState } from "react";
import { getModuleDisplayName } from "../lib/moduleDisplay";
import { formatModuleMoney } from "../lib/pricing";
import {
  ACCESS_TYPE_CODES,
  DEFAULT_DURATION_MONTHS,
  PRICING_PLAN_CODES,
  buildPlanCheckoutPayload,
  buildPlanCtaCopy,
  chooseDefaultDuration,
  findPlan,
  getAccessTypeForPlanCode,
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
} from "../lib/pricingPlans";

const ACCESS_TYPE_LABELS = {
  [ACCESS_TYPE_CODES.INDIVIDUAL]: "This module",
  [ACCESS_TYPE_CODES.PICK_THREE]: "Pick 3",
  [ACCESS_TYPE_CODES.COMPLETE]: "Complete",
};

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function durationBadge(duration) {
  if (duration.discount_label) return duration.discount_label;
  const savings = getSavingsAmountKobo(duration);
  if (savings > 0) return `Save ${formatModuleMoney(savings, duration.currency)}`;
  return "";
}

function planAvailable(catalog, planCode) {
  const plan = findPlan(catalog, planCode);
  return Boolean(plan && plan.is_available !== false && plan.durations.length > 0);
}

function getInitialAccessType({ catalog, initialPlanCode, initialSubjectModule }) {
  if (initialPlanCode && planAvailable(catalog, initialPlanCode)) {
    return getAccessTypeForPlanCode(initialPlanCode);
  }
  if (initialSubjectModule && planAvailable(catalog, getIndividualPlanCodeForModule(initialSubjectModule))) {
    return ACCESS_TYPE_CODES.INDIVIDUAL;
  }
  if (planAvailable(catalog, PRICING_PLAN_CODES.THREE_MODULE_BUNDLE)) return ACCESS_TYPE_CODES.PICK_THREE;
  if (planAvailable(catalog, PRICING_PLAN_CODES.COMPLETE_BUNDLE)) return ACCESS_TYPE_CODES.COMPLETE;
  return ACCESS_TYPE_CODES.INDIVIDUAL;
}

function getFallbackPlan(catalog) {
  return normalizePricingCatalog(catalog).find((plan) => plan.is_available !== false && plan.durations.length > 0) ?? null;
}

function normalizeModules(modules) {
  return getEligibleModules(modules).map((module) => ({
    ...module,
    subject_slug: getModuleSlug(module),
    subject_name: getModuleName(module),
  }));
}

export function AccessPlanModal({
  catalog = [],
  error = "",
  initialPlanCode = "",
  initialSubjectSlug = "",
  modules = [],
  onClose,
  onPay,
  paying = false,
}) {
  const normalizedCatalog = useMemo(() => normalizePricingCatalog(catalog), [catalog]);
  const availableModules = useMemo(() => normalizeModules(modules), [modules]);
  const initialSubjectModule = availableModules.find((module) => getModuleSlug(module) === initialSubjectSlug) ?? null;
  const [accessType, setAccessType] = useState(() => getInitialAccessType({
    catalog: normalizedCatalog,
    initialPlanCode,
    initialSubjectModule,
  }));
  const [durationMonths, setDurationMonths] = useState(DEFAULT_DURATION_MONTHS);
  const [selectedSlugs, setSelectedSlugs] = useState(() => (
    initialSubjectSlug ? [initialSubjectSlug] : []
  ));

  const selectedModule = availableModules.find((module) => selectedSlugs.includes(getModuleSlug(module))) ?? initialSubjectModule;
  const planCode = getPlanCodeForAccessType({ accessType, selectedModule });
  const resolvedPlan = findPlan(normalizedCatalog, planCode) ?? getFallbackPlan(normalizedCatalog);
  const plan = resolvedPlan;
  const requiredCount = getRequiredModuleCount(plan);
  const isCompleteBundle = plan?.plan_code === PRICING_PLAN_CODES.COMPLETE_BUNDLE;
  const isPickThree = plan?.plan_code === PRICING_PLAN_CODES.THREE_MODULE_BUNDLE;
  const safeDurationMonths = plan ? chooseDefaultDuration(plan, durationMonths) : durationMonths;
  const effectiveSelectedSlugs = useMemo(() => {
    if (!plan || isCompleteBundle) return [];
    const validSlugs = new Set(availableModules.map((module) => getModuleSlug(module)));
    const initial = initialSubjectSlug && validSlugs.has(initialSubjectSlug) ? [initialSubjectSlug] : [];
    const filtered = uniqueValues(selectedSlugs).filter((slug) => validSlugs.has(slug));
    const nextSlugs = filtered.length > 0 ? filtered : initial;
    return nextSlugs.slice(0, Math.max(requiredCount, 1));
  }, [availableModules, initialSubjectSlug, isCompleteBundle, plan, requiredCount, selectedSlugs]);
  const needsModulePicker = Boolean(plan && !isCompleteBundle && (isPickThree || !initialSubjectSlug));
  const selectedModules = getSelectedModules(availableModules, effectiveSelectedSlugs);
  const selectedDuration = getDurationPrice(plan, safeDurationMonths);
  const validation = validatePlanSelection({ plan, selectedSlugs: effectiveSelectedSlugs });
  const checkoutPayload = buildPlanCheckoutPayload({ plan, durationMonths: safeDurationMonths, selectedSlugs: effectiveSelectedSlugs });
  const ctaCopy = buildPlanCtaCopy({ plan, durationMonths: safeDurationMonths, selectedSlugs: effectiveSelectedSlugs, paying });
  const title = plan?.plan_code === PRICING_PLAN_CODES.INDIVIDUAL_OBJECTIVE || plan?.plan_code === PRICING_PLAN_CODES.INDIVIDUAL_ORAL
    ? getModuleDisplayName(selectedModule?.subject_name ?? plan?.display_name)
    : plan?.display_name ?? "Choose access";
  const contextCopy = isCompleteBundle
    ? "All currently available modules."
    : isPickThree
      ? "Choose any 3 available modules."
      : "Choose how long you want access.";

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !paying) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, paying]);

  if (!plan) return null;

  function switchAccessType(nextAccessType) {
    if (paying || nextAccessType === accessType) return;
    setAccessType(nextAccessType);
  }

  function toggleModule(subjectSlug) {
    if (paying || isCompleteBundle) return;
    setSelectedSlugs((currentSlugs) => {
      const validSlugs = new Set(availableModules.map((module) => getModuleSlug(module)));
      const current = uniqueValues(currentSlugs).filter((slug) => validSlugs.has(slug));
      if (current.includes(subjectSlug)) return current.filter((slug) => slug !== subjectSlug);
      if (current.length >= requiredCount) return current;
      return [...current, subjectSlug];
    });
  }

  function submitPayment() {
    if (!checkoutPayload || paying) return;
    onPay(checkoutPayload);
  }

  const includedModules = isCompleteBundle
    ? plan.modules
    : selectedModules;
  const moduleSelectionLabel = isCompleteBundle
    ? `${Number(plan.current_available_module_count ?? plan.modules?.length ?? 0)} modules included`
    : validation.ok ? "Ready for payment" : `${effectiveSelectedSlugs.length} of ${requiredCount} selected`;

  return (
    <div className="access-plan-backdrop" role="presentation" onClick={paying ? undefined : onClose}>
      <section
        aria-labelledby="access-plan-title"
        aria-modal="true"
        className="access-plan-sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <button
          aria-label="Close access plan"
          className="access-plan-handle"
          disabled={paying}
          onClick={onClose}
          type="button"
        />

        <header className="access-plan-head">
          <div className="access-plan-title-block">
            <h2 id="access-plan-title">{title}</h2>
            <p>{contextCopy}</p>
          </div>
          <button
            aria-label="Close access plan"
            className="access-plan-close"
            disabled={paying}
            onClick={onClose}
            type="button"
          >
            &times;
          </button>
        </header>

        <div className="access-plan-body">
          <section className="access-plan-section" aria-labelledby="access-type-title">
            <h3 id="access-type-title">Access type</h3>
            <div className="access-type-list">
              {Object.values(ACCESS_TYPE_CODES).map((type) => {
                const typePlanCode = getPlanCodeForAccessType({ accessType: type, selectedModule });
                const typePlan = findPlan(normalizedCatalog, typePlanCode);
                const available = Boolean(typePlan?.is_available !== false && typePlan?.durations?.length);
                return (
                  <button
                    aria-pressed={type === accessType}
                    className={`access-type-option${type === accessType ? " is-selected" : ""}`}
                    disabled={paying || !available}
                    key={type}
                    onClick={() => switchAccessType(type)}
                    type="button"
                  >
                    <span>{ACCESS_TYPE_LABELS[type]}</span>
                    {type === accessType && <small>Active</small>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="access-plan-section" aria-labelledby="access-duration-title">
            <h3 id="access-duration-title">Access length</h3>
            <div className="access-duration-list">
              {plan.durations.map((duration) => {
                const selected = Number(duration.duration_months) === Number(durationMonths);
                return (
                  <button
                    aria-pressed={selected}
                    className={`access-duration-option${selected ? " is-selected" : ""}`}
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

          <section className="access-plan-summary" aria-label="Selected access summary">
            <strong>{selectedDuration ? formatModuleMoney(selectedDuration.price_kobo, selectedDuration.currency) : "Choose access"}</strong>
            <p>{selectedDuration ? `Valid for ${getDurationLabel(selectedDuration.duration_months)} after activation.` : "Choose access length."}</p>
            <p>Access starts after payment is verified.</p>
          </section>

          {needsModulePicker ? (
            <section className="access-plan-section" aria-labelledby="access-plan-modules-title">
              <header className="access-plan-section-head">
                <h3 id="access-plan-modules-title">Modules</h3>
                <span>{moduleSelectionLabel}</span>
              </header>
              <div className="access-plan-module-list" aria-label={isPickThree ? "Choose modules" : "Choose module"}>
                {availableModules.map((module) => {
                  const slug = getModuleSlug(module);
                  const selected = effectiveSelectedSlugs.includes(slug);
                  return (
                    <button
                      aria-pressed={selected}
                      className={`access-plan-module-option${selected ? " is-selected" : ""}`}
                      disabled={paying}
                      key={module.subject_id ?? slug}
                      onClick={() => toggleModule(slug)}
                      type="button"
                    >
                      <span className="access-plan-module-check" aria-hidden="true" />
                      <span>{getModuleDisplayName(module.subject_name)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          ) : (
            <section className="access-plan-section" aria-labelledby="access-plan-included-title">
              <header className="access-plan-section-head">
                <h3 id="access-plan-included-title">Included</h3>
                {isCompleteBundle && <span>{moduleSelectionLabel}</span>}
              </header>
              <div className="access-plan-included-list">
                {(includedModules.length > 0 ? includedModules : selectedModule ? [selectedModule] : []).map((module) => (
                  <span key={module.subject_id ?? getModuleSlug(module)}>
                    {getModuleDisplayName(module.subject_name ?? module.name)}
                  </span>
                ))}
                {!isCompleteBundle && (
                  <>
                    <span>All published practice sets</span>
                    <span>Retries, answer review, and progress tracking</span>
                  </>
                )}
              </div>
              {isCompleteBundle && <p className="access-plan-footnote">Future modules are not included automatically.</p>}
            </section>
          )}
        </div>

        <footer className="access-plan-footer">
          <p>Secure payment by Paystack. Access activates automatically.</p>
          {error && <p className="action-error" role="alert">{error}</p>}
          <button
            aria-busy={paying}
            className="access-plan-pay"
            disabled={paying || !checkoutPayload}
            onClick={submitPayment}
            type="button"
          >
            {ctaCopy}
          </button>
        </footer>
      </section>
    </div>
  );
}
