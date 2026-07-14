export function buildLocationPath(location) {
  if (!location?.pathname) return "/dashboard";
  return `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`;
}

export function getSafeReturnTo(value, fallback = "/dashboard") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return fallback;
  }

  try {
    const url = new URL(value, "http://app.local");
    if (url.origin !== "http://app.local") return fallback;
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (url.pathname === "/auth" || url.pathname === "/profile-setup") return fallback;
    return path;
  } catch {
    return fallback;
  }
}

export function withReturnTo(path, returnTo) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}returnTo=${encodeURIComponent(getSafeReturnTo(returnTo))}`;
}
