export function buildLocationPath(location) {
  if (!location?.pathname) return "/dashboard";
  return `${location.pathname}${location.search ?? ""}${location.hash ?? ""}`;
}

export function getSafeReturnTo(value, fallback = "/dashboard") {
  if (typeof value !== "string") {
    return fallback;
  }

  try {
    const candidate = value.trim();
    if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
      return fallback;
    }

    let decoded = candidate;
    for (let index = 0; index < 2; index += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (decoded.startsWith("//") || /^(?:javascript|data):/i.test(decoded) || decoded.includes("\\")) {
      return fallback;
    }

    const url = new URL(candidate, "http://app.local");
    if (url.origin !== "http://app.local") return fallback;
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (url.pathname === "/auth" || url.pathname === "/auth/callback" || url.pathname === "/reset-password" || url.pathname === "/profile-setup") return fallback;

    for (const key of ["returnTo", "redirect", "redirectTo", "next"]) {
      const nested = url.searchParams.get(key);
      if (nested && getSafeReturnTo(nested, null) === null) return fallback;
    }
    return path;
  } catch {
    return fallback;
  }
}

export function withReturnTo(path, returnTo) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}returnTo=${encodeURIComponent(getSafeReturnTo(returnTo))}`;
}
