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
  for (const pathname of ["/auth", "/dashboard", "/access", "/profile", "/payment/verify", "/modules/example"]) {
    assert.equal(isWhatsAppSupportRoute(pathname), true, pathname);
  }
  for (const pathname of ["/", "/practice", "/practice/example", "/oral-practice/example", "/review", "/admin", "/help"]) {
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
  assert.match(url.searchParams.get("text"), /payment or module access/);
  assert.match(url.searchParams.get("text"), /PromotionSure payment reference: PS-/);
  assert.equal(url.searchParams.get("text").includes("A".repeat(121)), false);
  assert.match(url.searchParams.get("text"), /password, OTP, or card details/);
  assert.equal(buildWhatsAppSupportUrl({ number: "invalid", pathname: "/dashboard" }), null);
});
