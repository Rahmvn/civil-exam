function decodeSecret(secret: string) {
  const encoded = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  try {
    return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
  } catch {
    throw new Error("Webhook signing secret is invalid");
  }
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function verifySvixWebhook(rawBody: string, headers: Headers, secret: string) {
  const id = headers.get("svix-id") || headers.get("webhook-id");
  const timestamp = headers.get("svix-timestamp") || headers.get("webhook-timestamp");
  const signature = headers.get("svix-signature") || headers.get("webhook-signature");
  if (!id || !timestamp || !signature) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isInteger(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    decodeSecret(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return signature.split(" ").some((candidate) => {
    const [version, value] = candidate.split(",");
    return version === "v1" && Boolean(value) && constantTimeEqual(value, expected);
  });
}
