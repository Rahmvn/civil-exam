import {
  AUTH_PROBLEM_CODES,
  createSanitizedAuthProblem,
  getSafeCallbackCategory,
  getSafeCallbackErrorCode,
} from "./authFlow.js";

export function createAuthInitializationCoordinator(auth, {
  locationHref = typeof window !== "undefined" ? window.location.href : "http://app.local/",
  appVersion = "unknown",
} = {}) {
  const flowCategory = getSafeCallbackCategory(locationHref);
  const callbackErrorCode = getSafeCallbackErrorCode(locationHref);
  if (callbackErrorCode) {
    return Promise.resolve(Object.freeze({
      status: "initialization_failed",
      sessionEstablished: false,
      flowCategory,
      problem: createSanitizedAuthProblem({ details: { code: callbackErrorCode } }, {
        purpose: flowCategory === "recovery" ? "recovery" : "callback",
        route: "/auth/callback",
        appVersion,
      }),
    }));
  }

  return Promise.resolve(auth.getSession()).then(async (sessionResult) => {
    const session = sessionResult?.data?.session ?? null;
    const rawError = sessionResult?.error ?? null;

    if (rawError) {
      return Object.freeze({
        status: "initialization_failed",
        sessionEstablished: Boolean(session),
        flowCategory,
        problem: createSanitizedAuthProblem(rawError, {
          purpose: flowCategory === "recovery" ? "recovery" : "callback",
          route: "/auth/callback",
          appVersion,
        }),
      });
    }

    if (session) {
      return Object.freeze({
        status: "initialized_with_session",
        sessionEstablished: true,
        flowCategory,
        problem: null,
      });
    }

    return Object.freeze({
      status: flowCategory === "none" ? "no_callback_present" : "initialized_without_session",
      sessionEstablished: false,
      flowCategory,
      problem: flowCategory === "none" ? null : createSanitizedAuthProblem(
        AUTH_PROBLEM_CODES.CALLBACK_SESSION_MISSING,
        { purpose: "callback", route: "/auth/callback", appVersion },
      ),
    });
  }).catch(() => Object.freeze({
    status: "initialization_failed",
    sessionEstablished: false,
    flowCategory,
    problem: createSanitizedAuthProblem(AUTH_PROBLEM_CODES.SERVICE_UNAVAILABLE, {
      purpose: "callback",
      route: "/auth/callback",
      appVersion,
    }),
  }));
}
