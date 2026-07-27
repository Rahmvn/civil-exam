import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWhatsAppSupportUrl,
  isWhatsAppSupportRoute,
  normalizeWhatsAppNumber,
  resolveWhatsAppSupportConfig,
} from "../../src/lib/whatsappSupport.js";

test("WhatsApp support stays disabled until both launch settings are valid", () => {
  assert.deepEqual(resolveWhatsAppSupportConfig({
    VITE_WHATSAPP_SUPPORT_ENABLED: "false",
    VITE_WHATSAPP_SUPPORT_NUMBER: "+234 800 000 0000",
  }), { enabled: false, number: "2348000000000" });
  assert.equal(resolveWhatsAppSupportConfig({
    VITE_WHATSAPP_SUPPORT_ENABLED: "true",
    VITE_WHATSAPP_SUPPORT_NUMBER: "not-a-number",
  }).enabled, false);
  assert.equal(resolveWhatsAppSupportConfig({
    VITE_WHATSAPP_SUPPORT_ENABLED: "true",
    VITE_WHATSAPP_SUPPORT_NUMBER: "+234 800 000 0000",
  }).enabled, true);
  assert.equal(normalizeWhatsAppNumber("+234 (800) 000-0000"), "2348000000000");
});

test("WhatsApp support appears only on approved non-practice routes", () => {
  for (const pathname of ["/auth", "/reset-password", "/access", "/payment/verify", "/support"]) {
    assert.equal(isWhatsAppSupportRoute(pathname), true, pathname);
  }
  for (const pathname of ["/", "/dashboard", "/profile", "/modules/example", "/practice", "/practice/example", "/oral-practice/example", "/review", "/admin", "/help"]) {
    assert.equal(isWhatsAppSupportRoute(pathname), false, pathname);
  }
});

test("WhatsApp links use HTTPS and include only page context and a bounded payment reference", () => {
  const url = new URL(buildWhatsAppSupportUrl({
    number: "+234 800 000 0000",
    pathname: "/payment/verify",
    paymentReference: `PS-${"A".repeat(200)}`,
  }));
  assert.equal(url.origin, "https://wa.me");
  assert.equal(url.pathname, "/2348000000000");
  assert.match(url.searchParams.get("text"), /help with a payment/);
  assert.match(url.searchParams.get("text"), /Reference: PS-/);
  assert.equal(url.searchParams.get("text").includes("A".repeat(121)), false);
  assert.equal(url.searchParams.get("text").includes("password"), false);
  assert.equal(url.searchParams.get("text").includes("OTP"), false);
  assert.equal(url.searchParams.get("text").includes("card details"), false);
  assert.equal(buildWhatsAppSupportUrl({ number: "invalid", pathname: "/access" }), null);
});

test("WhatsApp default messages stay short and route-specific", () => {
  const cases = [
    ["/auth", "Hello PromotionSure. I need help with signing in to my account."],
    ["/reset-password", "Hello PromotionSure. I need help with signing in to my account."],
    ["/access", "Hello PromotionSure. I need help with my module access."],
    ["/support", "Hello PromotionSure. I need help with using PromotionSure."],
    ["/help", "Hello PromotionSure. I need help with an issue on my account."],
  ];

  for (const [pathname, expectedMessage] of cases) {
    const url = new URL(buildWhatsAppSupportUrl({
      number: "+234 800 000 0000",
      pathname,
    }));
    assert.equal(url.searchParams.get("text"), expectedMessage);
  }
});
