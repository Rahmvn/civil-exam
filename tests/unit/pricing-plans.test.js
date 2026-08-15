import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCESS_TYPE_CODES,
  PRICING_PLAN_CODES,
  buildPlanCheckoutPayload,
  buildPlanCtaCopy,
  chooseDefaultDuration,
  findPlan,
  getDurationPrice,
  getIndividualPlanCodeForModule,
  getPlanCodeForAccessType,
  getSavingsAmountKobo,
  normalizePricingCatalog,
  validatePlanSelection,
} from "../../src/lib/pricingPlans.js";
import {
  calculatePricingGuidance,
  roundRecommendedPriceKobo,
} from "../../src/lib/pricingGuidance.js";

const catalog = [
  {
    plan_code: "individual_objective",
    plan_type: "single_module",
    display_name: "Objective Module",
    module_count: 1,
    durations: [
      { duration_months: 1, price_kobo: 250000, list_price_kobo: 250000, currency: "NGN", enabled: true },
      { duration_months: 2, price_kobo: 450000, list_price_kobo: 500000, currency: "NGN", enabled: true },
      { duration_months: 3, price_kobo: 650000, list_price_kobo: 750000, currency: "NGN", enabled: true },
    ],
  },
  {
    plan_code: "individual_oral",
    plan_type: "single_module",
    display_name: "Oral Module",
    module_count: 1,
    durations: [
      { duration_months: 1, price_kobo: 350000, list_price_kobo: 350000, currency: "NGN", enabled: true },
      { duration_months: 2, price_kobo: 650000, list_price_kobo: 700000, currency: "NGN", enabled: true },
      { duration_months: 3, price_kobo: 900000, list_price_kobo: 1050000, currency: "NGN", enabled: true },
    ],
  },
  {
    plan_code: "three_module_bundle",
    plan_type: "pick_n_modules",
    display_name: "Pick 3 Modules",
    module_count: 3,
    durations: [
      { duration_months: 1, price_kobo: 600000, list_price_kobo: 750000, currency: "NGN", enabled: true },
      { duration_months: 2, price_kobo: 1100000, list_price_kobo: 1200000, currency: "NGN", enabled: true },
      { duration_months: 3, price_kobo: 1550000, list_price_kobo: 1800000, currency: "NGN", enabled: true },
    ],
  },
  {
    plan_code: "complete_bundle",
    plan_type: "complete_bundle",
    display_name: "Complete Bundle",
    current_available_module_count: 11,
    durations: [
      { duration_months: 1, price_kobo: 1650000, list_price_kobo: 1650000, currency: "NGN", enabled: true },
      { duration_months: 2, price_kobo: 3100000, list_price_kobo: 3300000, currency: "NGN", enabled: true },
      { duration_months: 3, price_kobo: 4300000, list_price_kobo: 4950000, currency: "NGN", enabled: true },
    ],
  },
];

test("pricing guidance derives reference totals, recommendations, and actual savings", () => {
  assert.deepEqual(calculatePricingGuidance({
    actualPriceKobo: 450000,
    discountPercent: 7,
    durationMonths: 2,
    oneMonthPriceKobo: 250000,
  }), {
    actualSavingKobo: 50000,
    actualSavingPercent: 10,
    fullMonthlyTotalKobo: 500000,
    oneMonthPriceKobo: 250000,
    recommendedPriceKobo: 450000,
  });

  assert.equal(calculatePricingGuidance({
    discountPercent: 0,
    durationMonths: 1,
    oneMonthPriceKobo: 250000,
  }).recommendedPriceKobo, 250000);
  assert.equal(calculatePricingGuidance({
    discountPercent: 14,
    durationMonths: 3,
    oneMonthPriceKobo: 250000,
  }).recommendedPriceKobo, 650000);
});

test("pricing guidance uses clean NGN rounding without inventing arbitrary-duration policy", () => {
  assert.equal(roundRecommendedPriceKobo(465000), 450000);
  assert.equal(roundRecommendedPriceKobo(645000), 650000);
  assert.equal(calculatePricingGuidance({
    discountPercent: 12.5,
    durationMonths: 4,
    oneMonthPriceKobo: 250000,
  }).recommendedPriceKobo, 900000);
  assert.equal(calculatePricingGuidance({
    discountPercent: Number.NaN,
    durationMonths: 4,
    oneMonthPriceKobo: 250000,
  }), null);
});

test("Complete guidance follows its authoritative current one-month total", () => {
  const guidance = calculatePricingGuidance({
    actualPriceKobo: 3100000,
    discountPercent: 7,
    durationMonths: 2,
    oneMonthPriceKobo: 1650000,
  });

  assert.equal(guidance.fullMonthlyTotalKobo, 3300000);
  assert.equal(guidance.recommendedPriceKobo, 3050000);
  assert.equal(guidance.actualSavingKobo, 200000);
});

test("pricing catalog normalization accepts any backend-enabled positive whole-month duration", () => {
  const normalized = normalizePricingCatalog([
    {
      plan_code: "individual_objective",
      durations: [
        { duration_months: "1", price_kobo: "250000", currency: "" },
        { duration_months: 12, price_kobo: 2000000 },
        { duration_months: 2.5, price_kobo: 450000 },
        { duration_months: 3, price_kobo: 650000, enabled: false },
      ],
    },
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].durations.length, 2);
  assert.equal(normalized[0].durations[0].price_kobo, 250000);
  assert.equal(normalized[0].durations[0].currency, "NGN");
  assert.equal(normalized[0].durations[1].duration_months, 12);
});

test("individual plan code follows module practice type", () => {
  assert.equal(getIndividualPlanCodeForModule({ practice_type: "objective" }), PRICING_PLAN_CODES.INDIVIDUAL_OBJECTIVE);
  assert.equal(getIndividualPlanCodeForModule({ practice_type: "oral" }), PRICING_PLAN_CODES.INDIVIDUAL_ORAL);
  assert.equal(getIndividualPlanCodeForModule({}), PRICING_PLAN_CODES.INDIVIDUAL_OBJECTIVE);
});

test("access type maps to the correct pricing plan code", () => {
  assert.equal(getPlanCodeForAccessType({
    accessType: ACCESS_TYPE_CODES.INDIVIDUAL,
    selectedModule: { practice_type: "oral" },
  }), PRICING_PLAN_CODES.INDIVIDUAL_ORAL);
  assert.equal(getPlanCodeForAccessType({ accessType: ACCESS_TYPE_CODES.PICK_THREE }), PRICING_PLAN_CODES.THREE_MODULE_BUNDLE);
  assert.equal(getPlanCodeForAccessType({ accessType: ACCESS_TYPE_CODES.COMPLETE }), PRICING_PLAN_CODES.COMPLETE_BUNDLE);
});

test("duration helpers choose available durations and savings", () => {
  const plan = findPlan(catalog, "individual_objective");

  assert.equal(chooseDefaultDuration(plan, 6), 1);
  assert.equal(chooseDefaultDuration(plan, 2), 2);
  assert.equal(chooseDefaultDuration(plan, 3), 3);
  assert.equal(getDurationPrice(plan, 3).price_kobo, 650000);
  assert.equal(getSavingsAmountKobo(getDurationPrice(plan, 3)), 100000);
});

test("selection validation guides incomplete plan choices", () => {
  const individual = findPlan(catalog, "individual_objective");
  const bundle = findPlan(catalog, "three_module_bundle");
  const complete = findPlan(catalog, "complete_bundle");

  assert.deepEqual(validatePlanSelection({ plan: individual, selectedSlugs: [] }), {
    ok: false,
    message: "Choose a module",
  });
  assert.deepEqual(validatePlanSelection({ plan: bundle, selectedSlugs: ["civil"] }), {
    ok: false,
    message: "Select 2 more modules",
  });
  assert.deepEqual(validatePlanSelection({ plan: bundle, selectedSlugs: ["civil", "crime", "evidence"] }), {
    ok: true,
    message: "",
  });
  assert.deepEqual(validatePlanSelection({ plan: complete, selectedSlugs: [] }), {
    ok: true,
    message: "",
  });
});

test("checkout payloads include only the authoritative plan, duration, selection, and expected price", () => {
  const bundle = findPlan(catalog, "three_module_bundle");
  const complete = findPlan(catalog, "complete_bundle");

  assert.deepEqual(buildPlanCheckoutPayload({
    plan: bundle,
    durationMonths: 2,
    selectedSlugs: ["civil", "crime", "evidence"],
  }), {
    planCode: "three_module_bundle",
    durationMonths: 2,
    subjectSlugs: ["civil", "crime", "evidence"],
    expectedPriceKobo: 1100000,
  });

  assert.deepEqual(buildPlanCheckoutPayload({
    plan: complete,
    durationMonths: 3,
    selectedSlugs: ["ignored-by-backend"],
  }), {
    planCode: "complete_bundle",
    durationMonths: 3,
    subjectSlugs: [],
    expectedPriceKobo: 4300000,
  });
});

test("checkout CTA stays singular and instructional", () => {
  const bundle = findPlan(catalog, "three_module_bundle");
  const complete = findPlan(catalog, "complete_bundle");

  assert.equal(buildPlanCtaCopy({
    plan: bundle,
    durationMonths: 1,
    selectedSlugs: ["civil"],
  }), "Select 2 more modules");
  assert.equal(buildPlanCtaCopy({
    plan: bundle,
    durationMonths: 1,
    selectedSlugs: ["civil", "crime", "evidence"],
  }), "Continue to payment - ₦6,000");
  assert.equal(buildPlanCtaCopy({
    plan: complete,
    durationMonths: 3,
    selectedSlugs: [],
    paying: true,
  }), "Preparing payment...");
});
