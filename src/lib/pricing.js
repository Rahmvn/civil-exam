const MONEY_FORMATTERS = new Map();

export function formatModuleMoney(kobo, currency = "NGN") {
  const code = currency || "NGN";
  if (!MONEY_FORMATTERS.has(code)) {
    MONEY_FORMATTERS.set(code, new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }));
  }
  return MONEY_FORMATTERS.get(code).format(Number(kobo ?? 0) / 100);
}

export function formatLaunchOfferEnd(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos",
  }).format(new Date(value));
}

export function formatLaunchOfferSavings(offer) {
  const regularPrice = Number(offer?.regular_price_kobo);
  const discountedPrice = Number(offer?.discounted_price_kobo);

  if (!Number.isFinite(regularPrice) || !Number.isFinite(discountedPrice) || regularPrice <= discountedPrice) {
    return "Launch price";
  }

  const percent = Math.round(((regularPrice - discountedPrice) / regularPrice) * 100);

  if (percent <= 0) {
    return "Launch price";
  }

  return `${offer?.has_uniform_regular_price ? "Save" : "Save up to"} ${percent}%`;
}
