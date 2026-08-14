import { formatModuleMoney } from "./pricing.js";

export const PRICING_PLAN_CODES = Object.freeze({
  INDIVIDUAL_OBJECTIVE: "individual_objective",
  INDIVIDUAL_ORAL: "individual_oral",
  THREE_MODULE_BUNDLE: "three_module_bundle",
  COMPLETE_BUNDLE: "complete_bundle",
});

export const ACCESS_TYPE_CODES = Object.freeze({
  INDIVIDUAL: "individual",
  PICK_THREE: "pick_three",
  COMPLETE: "complete",
});

export const DEFAULT_DURATION_MONTHS = 1;

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeDuration(duration) {
  const durationMonths = Number(duration?.duration_months);
  return {
    ...duration,
    duration_id: duration?.duration_id ?? null,
    duration_months: durationMonths,
    price_kobo: Number(duration?.price_kobo),
    list_price_kobo: duration?.list_price_kobo == null ? null : Number(duration.list_price_kobo),
    currency: duration?.currency || "NGN",
    discount_label: duration?.discount_label || "",
    enabled: duration?.enabled !== false,
  };
}

export function normalizePricingCatalog(catalog) {
  return ensureArray(catalog)
    .filter((plan) => plan?.plan_code)
    .map((plan) => ({
      ...plan,
      plan_code: String(plan.plan_code),
      plan_type: String(plan.plan_type ?? ""),
      display_name: plan.display_name || plan.plan_name || plan.plan_code,
      short_description: plan.short_description || "",
      supporting_text: plan.supporting_text || "",
      included_bullets: ensureArray(plan.included_bullets),
      is_available: plan.is_available !== false,
      durations: ensureArray(plan.durations)
        .map(normalizeDuration)
        .filter((duration) => (
          duration.enabled
          && Number.isSafeInteger(duration.duration_months)
          && duration.duration_months > 0
          && Number.isFinite(duration.price_kobo)
          && duration.price_kobo > 0
        )),
      modules: ensureArray(plan.modules ?? plan.eligible_modules),
    }));
}

export function findPlan(catalog, planCode) {
  return normalizePricingCatalog(catalog).find((plan) => plan.plan_code === planCode) ?? null;
}

export function getIndividualPlanCodeForModule(module) {
  return String(module?.practice_type ?? module?.module_practice_type ?? "").toLowerCase() === "oral"
    ? PRICING_PLAN_CODES.INDIVIDUAL_ORAL
    : PRICING_PLAN_CODES.INDIVIDUAL_OBJECTIVE;
}

export function getAccessTypeForPlanCode(planCode) {
  if (planCode === PRICING_PLAN_CODES.THREE_MODULE_BUNDLE) return ACCESS_TYPE_CODES.PICK_THREE;
  if (planCode === PRICING_PLAN_CODES.COMPLETE_BUNDLE) return ACCESS_TYPE_CODES.COMPLETE;
  return ACCESS_TYPE_CODES.INDIVIDUAL;
}

export function getPlanCodeForAccessType({ accessType, selectedModule }) {
  if (accessType === ACCESS_TYPE_CODES.PICK_THREE) return PRICING_PLAN_CODES.THREE_MODULE_BUNDLE;
  if (accessType === ACCESS_TYPE_CODES.COMPLETE) return PRICING_PLAN_CODES.COMPLETE_BUNDLE;
  return getIndividualPlanCodeForModule(selectedModule);
}

export function getAvailableDurations(plan) {
  return ensureArray(plan?.durations).filter((duration) => duration.enabled !== false);
}

export function chooseDefaultDuration(plan, requestedDurationMonths = DEFAULT_DURATION_MONTHS) {
  const durations = getAvailableDurations(plan);
  const requested = Number(requestedDurationMonths);
  return durations.some((duration) => Number(duration.duration_months) === requested)
    ? requested
    : Number(durations[0]?.duration_months ?? DEFAULT_DURATION_MONTHS);
}

export function getDurationPrice(plan, durationMonths) {
  return getAvailableDurations(plan).find((duration) => Number(duration.duration_months) === Number(durationMonths)) ?? null;
}

export function getSavingsAmountKobo(duration) {
  const listPrice = Number(duration?.list_price_kobo);
  const price = Number(duration?.price_kobo);
  if (!Number.isFinite(listPrice) || !Number.isFinite(price) || listPrice <= price) return 0;
  return listPrice - price;
}

export function getDurationLabel(durationMonths) {
  const months = Number(durationMonths);
  return `${months} month${months === 1 ? "" : "s"}`;
}

export function getModuleSlug(module) {
  return module?.subject_slug ?? module?.slug ?? "";
}

export function getModuleName(module) {
  return module?.subject_name ?? module?.name ?? "Module";
}

export function getEligibleModules(modules) {
  return ensureArray(modules).filter((module) => (
    module?.can_purchase !== false
    && !module?.has_module_access
    && getModuleSlug(module)
  ));
}

export function getSelectedModules(modules, selectedSlugs) {
  const selected = new Set(ensureArray(selectedSlugs));
  return ensureArray(modules).filter((module) => selected.has(getModuleSlug(module)));
}

export function getRequiredModuleCount(plan) {
  if (!plan) return 0;
  if (plan.plan_code === PRICING_PLAN_CODES.COMPLETE_BUNDLE || plan.plan_type === "complete_bundle") {
    return Number(plan.current_available_module_count ?? plan.modules?.length ?? 0);
  }
  return Number(plan.module_count ?? (plan.plan_type === "single_module" ? 1 : 0));
}

export function validatePlanSelection({ plan, selectedSlugs }) {
  if (!plan) return { ok: false, message: "Choose an access plan" };
  if (plan.is_available === false) return { ok: false, message: "This plan is not available" };

  const selectedCount = ensureArray(selectedSlugs).length;
  if (plan.plan_code === PRICING_PLAN_CODES.COMPLETE_BUNDLE || plan.plan_type === "complete_bundle") {
    return { ok: true, message: "" };
  }

  const requiredCount = getRequiredModuleCount(plan);
  if (selectedCount <= 0) return { ok: false, message: requiredCount === 1 ? "Choose a module" : `Select ${requiredCount} modules` };
  if (selectedCount < requiredCount) {
    const remaining = requiredCount - selectedCount;
    return { ok: false, message: `Select ${remaining} more module${remaining === 1 ? "" : "s"}` };
  }
  if (selectedCount > requiredCount) return { ok: false, message: `Select only ${requiredCount} module${requiredCount === 1 ? "" : "s"}` };
  return { ok: true, message: "" };
}

export function buildPlanCheckoutPayload({ plan, durationMonths, selectedSlugs }) {
  const duration = getDurationPrice(plan, durationMonths);
  const validation = validatePlanSelection({ plan, selectedSlugs });
  if (!validation.ok || !duration) return null;

  return {
    planCode: plan.plan_code,
    durationMonths: Number(duration.duration_months),
    subjectSlugs: plan.plan_code === PRICING_PLAN_CODES.COMPLETE_BUNDLE ? [] : ensureArray(selectedSlugs),
    expectedPriceKobo: Number(duration.price_kobo),
  };
}

export function buildPlanCtaCopy({ plan, durationMonths, selectedSlugs, paying }) {
  if (paying) return "Preparing payment...";
  const validation = validatePlanSelection({ plan, selectedSlugs });
  if (!validation.ok) return validation.message;

  const duration = getDurationPrice(plan, durationMonths);
  if (!duration) return "Choose access length";
  return `Continue to payment - ${formatModuleMoney(duration.price_kobo, duration.currency)}`;
}
