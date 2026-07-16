const LOCAL_HTTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function configurationError(message) {
  return new Error(`Payment callback configuration error: ${message}`);
}

export function getPaymentCallbackUrl(configuredAppUrl) {
  if (typeof configuredAppUrl !== "string" || !configuredAppUrl.trim()) {
    throw configurationError("APP_URL is required");
  }

  let appUrl;
  try {
    appUrl = new URL(configuredAppUrl.trim());
  } catch {
    throw configurationError("APP_URL must be an absolute HTTP or HTTPS URL");
  }

  if (appUrl.protocol !== "https:" && appUrl.protocol !== "http:") {
    throw configurationError("APP_URL must use HTTP or HTTPS");
  }

  if (appUrl.username || appUrl.password) {
    throw configurationError("APP_URL must not include credentials");
  }

  if (appUrl.protocol === "http:" && !LOCAL_HTTP_HOSTS.has(appUrl.hostname)) {
    throw configurationError("HTTP APP_URL values are limited to localhost development");
  }

  if (appUrl.search || appUrl.hash) {
    throw configurationError("APP_URL must not include a query string or fragment");
  }

  appUrl.pathname = `${appUrl.pathname.replace(/\/+$/, "")}/`;
  return new URL("payment/verify", appUrl).toString();
}
