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
    || pathname === "/dashboard"
    || pathname === "/access"
    || pathname === "/profile"
    || pathname === "/payment/verify"
    || pathname.startsWith("/modules/");
}

export function getWhatsAppSupportTopic(pathname) {
  if (pathname === "/access" || pathname === "/payment/verify") return "a payment or module access";
  if (pathname === "/auth") return "signing in or recovering my account";
  if (pathname === "/profile") return "my account details";
  if (pathname.startsWith("/modules/")) return "a module";
  return "the dashboard";
}

export function buildWhatsAppSupportUrl({ number, pathname, paymentReference = "" }) {
  if (!WHATSAPP_NUMBER_PATTERN.test(normalizeWhatsAppNumber(number))) return null;

  const safeReference = String(paymentReference ?? "").trim().slice(0, 120);
  const referenceCopy = pathname === "/payment/verify" && safeReference
    ? ` PromotionSure payment reference: ${safeReference}.`
    : "";
  const message = `Hello PromotionSure Support. I need help with ${getWhatsAppSupportTopic(pathname)}.${referenceCopy} Please do not ask me for my password, OTP, or card details.`;

  return `https://wa.me/${normalizeWhatsAppNumber(number)}?text=${encodeURIComponent(message)}`;
}
