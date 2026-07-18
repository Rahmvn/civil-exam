const PLACEHOLDER_MARKERS = [
  "example",
  "placeholder",
  "redacted",
  "your_",
  "your-",
  "<",
  "env(",
  "changeme",
  "test-value",
];

export const KNOWN_SECRET_PATTERNS = Object.freeze([
  { label: "Supabase secret key", expression: /sb_secret_[A-Za-z0-9_-]{20,}/g },
  { label: "Supabase service-role JWT", expression: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { label: "Paystack secret", expression: /sk_(?:live|test)_[A-Za-z0-9]{20,}/g },
  { label: "Resend API key", expression: /\bre_(?=[A-Za-z0-9_-]{20,})(?=[A-Za-z0-9_-]*[A-Z0-9])[A-Za-z0-9_-]+/g },
  { label: "Google OAuth client secret", expression: /GOCSPX-[A-Za-z0-9_-]{16,}/g },
  { label: "Private key", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
]);

const CREDENTIAL_NAMES = [
  "RESEND_API_KEY",
  "SMTP_PASSWORD",
  "SMTP_PASS",
  "GOOGLE_CLIENT_SECRET",
  "TURNSTILE_SECRET_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AUTH_PROVIDER_SECRET",
  "JWT_SECRET",
];

function isPlaceholder(value) {
  const normalized = String(value).trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  return !normalized || PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker));
}

export function scanTrackedContent(path, content) {
  const findings = [];

  for (const { label, expression } of KNOWN_SECRET_PATTERNS) {
    expression.lastIndex = 0;
    if (expression.test(content)) findings.push(label);
  }

  const assignment = new RegExp(`(?<![A-Z0-9_])(?:${CREDENTIAL_NAMES.join("|")})\\s*(?:=|:)\\s*([^\\s,}]+)`, "gi");
  for (const match of content.matchAll(assignment)) {
    const value = match[1];
    const isSourceExpression = /\.[cm]?[jt]sx?$/i.test(path)
      && /^[A-Za-z_$][A-Za-z0-9_$]*[;)]?$/.test(value);
    if (!isPlaceholder(value) && !isSourceExpression) findings.push("Credential assignment");
  }

  const callbackValue = /(?:[?&](?:code|authorization_code|oauth_code)=|(?:authorization_code|oauth_code)\s*=\s*["'])([^\s&#"']{16,})/gi;
  for (const match of content.matchAll(callbackValue)) {
    if (!isPlaceholder(match[1])) findings.push("OAuth callback credential");
  }

  return [...new Set(findings)].map((label) => `${label}: ${path}`);
}
