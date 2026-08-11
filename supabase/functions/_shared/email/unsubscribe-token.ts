const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function signingKey(secret: string, usage: KeyUsage[]) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}

function configuredSecret() {
  const secret = Deno.env.get("EMAIL_UNSUBSCRIBE_SECRET") || "";
  if (secret.length < 32) throw new Error("EMAIL_UNSUBSCRIBE_SECRET is not configured");
  return secret;
}

export async function createEngagementUnsubscribeToken(userId: string) {
  const payload = base64UrlEncode(encoder.encode(JSON.stringify({ v: 1, sub: userId, scope: "engagement" })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(configuredSecret(), ["sign"]), encoder.encode(payload)));
  return `${payload}.${base64UrlEncode(signature)}`;
}

export async function verifyEngagementUnsubscribeToken(token: string) {
  const [payload, signature, extra] = String(token || "").split(".");
  if (!payload || !signature || extra) return null;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await signingKey(configuredSecret(), ["verify"]),
      base64UrlDecode(signature),
      encoder.encode(payload),
    );
    if (!valid) return null;
    const decoded = JSON.parse(decoder.decode(base64UrlDecode(payload)));
    if (decoded?.v !== 1 || decoded?.scope !== "engagement" || !/^[0-9a-f-]{36}$/i.test(decoded?.sub || "")) return null;
    return { userId: String(decoded.sub), scope: "engagement" as const };
  } catch {
    return null;
  }
}

export function getUnsubscribeUrl(token: string) {
  const configured = Deno.env.get("EMAIL_UNSUBSCRIBE_URL")?.trim();
  const base = configured || `${Deno.env.get("SUPABASE_URL")}/functions/v1/email-unsubscribe`;
  const url = new URL(base);
  url.searchParams.set("token", token);
  return url.toString();
}
