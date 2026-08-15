export const CLEAN_NGN_ROUNDING_INCREMENT_KOBO = 50000;

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function roundRecommendedPriceKobo(
  amountKobo,
  incrementKobo = CLEAN_NGN_ROUNDING_INCREMENT_KOBO,
) {
  const amount = positiveInteger(Math.round(Number(amountKobo)));
  const increment = positiveInteger(Math.round(Number(incrementKobo)));
  if (!amount || !increment) return null;
  return Math.max(Math.round(amount / increment) * increment, increment);
}

export function calculatePricingGuidance({
  actualPriceKobo,
  discountPercent,
  durationMonths,
  oneMonthPriceKobo,
  roundingIncrementKobo = CLEAN_NGN_ROUNDING_INCREMENT_KOBO,
}) {
  const months = positiveInteger(Number(durationMonths));
  const monthlyPrice = positiveInteger(Number(oneMonthPriceKobo));
  const discount = Number(discountPercent);
  if (!months || !monthlyPrice || !Number.isFinite(discount) || discount < 0 || discount >= 100) return null;

  const fullMonthlyTotalKobo = monthlyPrice * months;
  const recommendedPriceKobo = roundRecommendedPriceKobo(
    fullMonthlyTotalKobo * (1 - (discount / 100)),
    roundingIncrementKobo,
  );
  const actualPrice = positiveInteger(Number(actualPriceKobo));
  const actualSavingKobo = actualPrice == null ? null : fullMonthlyTotalKobo - actualPrice;
  const actualSavingPercent = actualSavingKobo == null
    ? null
    : (actualSavingKobo * 100) / fullMonthlyTotalKobo;

  return {
    actualSavingKobo,
    actualSavingPercent,
    fullMonthlyTotalKobo,
    oneMonthPriceKobo: monthlyPrice,
    recommendedPriceKobo,
  };
}
