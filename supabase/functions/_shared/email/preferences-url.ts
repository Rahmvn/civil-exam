export function getEmailPreferencesUrl() {
  return Deno.env.get("EMAIL_PREFERENCES_URL")?.trim() || "https://promotionsure.com.ng/profile#email-preferences";
}
