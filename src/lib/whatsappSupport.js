const WHATSAPP_NUMBER_PATTERN = /^[1-9]\d{7,14}$/;

export function normalizeWhatsAppNumber(value) {
  return String(value ?? "").replace(/[\s()+-]/g, "");
}

export function resolveWhatsAppSupportConfig(env) {
  const number = normalizeWhatsAppNumber(env?.VITE_WHATSAPP_SUPPORT_NUMBER);
  const enabled = env?.VITE_WHATSAPP_SUPPORT_ENABLED === "true";

  return {
    enabled: enabled && WHATSAPP_NUMBER_PATTERN.test(number),
    number,
  };
}

export function isWhatsAppSupportRoute(pathname) {
  return pathname === "/auth"
    || pathname === "/support"
    || pathname === "/reset-password"
    || pathname === "/access"
    || pathname === "/payment/verify";
}

export function getWhatsAppSupportTopic(pathname) {
  if (pathname === "/payment/verify") return "a payment";
  if (pathname === "/access") return "my module access";
  if (pathname === "/auth" || pathname === "/reset-password") return "signing in to my account";
  if (pathname === "/help") return "an issue on my account";
  return "using PromotionSure";
}

export function buildWhatsAppSupportUrl({ number, pathname, paymentReference = "" }) {
  if (!WHATSAPP_NUMBER_PATTERN.test(normalizeWhatsAppNumber(number))) return null;

  const safeReference = String(paymentReference ?? "").trim().slice(0, 120);
  const referenceCopy = pathname === "/payment/verify" && safeReference
    ? ` Reference: ${safeReference}.`
    : "";
  const message = `Hello PromotionSure. I need help with ${getWhatsAppSupportTopic(pathname)}.${referenceCopy}`;

  return `https://wa.me/${normalizeWhatsAppNumber(number)}?text=${encodeURIComponent(message)}`;
}
