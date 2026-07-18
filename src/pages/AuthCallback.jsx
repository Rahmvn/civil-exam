import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import {
  AUTH_PROBLEM_CODES,
  cleanAuthCallbackUrl,
  createSanitizedAuthProblem,
  markRecoveryAuthorized,
} from "../lib/authFlow";
import { logSanitizedAuthProblem } from "../lib/errors";
import { getSafeReturnTo, withReturnTo } from "../lib/navigation";
import { authInitialization, supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";

const CALLBACK_TIMEOUT_MS = 12_000;

function awaitWithTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((resolve) => window.setTimeout(() => resolve({
      status: "initialization_failed",
      sessionEstablished: false,
      flowCategory: "callback",
      problem: createSanitizedAuthProblem(AUTH_PROBLEM_CODES.SERVICE_UNAVAILABLE, {
        purpose: "callback",
        route: "/auth/callback",
      }),
    }), CALLBACK_TIMEOUT_MS)),
  ]);
}

export default function AuthCallback() {
  const { isAdmin, loading, profileError, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [returnTo] = useState(() => getSafeReturnTo(searchParams.get("returnTo"), "/dashboard"));
  const [isRecovery] = useState(() => searchParams.get("mode") === "recovery");
  const completionPromiseRef = useRef(null);
  const navigationRef = useRef(false);
  const [callbackUserId, setCallbackUserId] = useState(null);
  const [problem, setProblem] = useState(null);

  useEffect(() => {
    let active = true;

    if (!completionPromiseRef.current) {
      completionPromiseRef.current = (async () => {
        const initialization = await awaitWithTimeout(authInitialization);
        cleanAuthCallbackUrl(window.history, window.location.href);
        if (initialization.problem) return { problem: initialization.problem, userId: null };

        const { data, error } = await supabase.auth.getSession();
        if (error || !data?.session?.user) {
          return {
            problem: createSanitizedAuthProblem(
              error || AUTH_PROBLEM_CODES.CALLBACK_SESSION_MISSING,
              { purpose: isRecovery ? "recovery" : "callback", route: "/auth/callback" },
            ),
            userId: null,
          };
        }

        if (isRecovery) markRecoveryAuthorized(window.sessionStorage, data.session.user);
        return { problem: null, userId: data.session.user.id };
      })();
    }

    void completionPromiseRef.current.then((outcome) => {
      if (!active) return;
      if (outcome.problem) {
        logSanitizedAuthProblem("Auth callback completion", outcome.problem);
        setProblem(outcome.problem);
      } else {
        setCallbackUserId(outcome.userId);
      }
    });
    return () => {
      active = false;
    };
  }, [isRecovery]);

  useEffect(() => {
    if (!callbackUserId || loading || navigationRef.current || problem) return;
    if (!user || user.id !== callbackUserId || profileError) {
      const nextProblem = createSanitizedAuthProblem(
        profileError ? AUTH_PROBLEM_CODES.PROFILE_RECOVERY_FAILED : AUTH_PROBLEM_CODES.CALLBACK_SESSION_MISSING,
        { purpose: isRecovery ? "recovery" : "callback", route: "/auth/callback" },
      );
      const timer = window.setTimeout(() => {
        logSanitizedAuthProblem("Auth callback completion", nextProblem);
        setProblem(nextProblem);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    navigationRef.current = true;
    navigate(isRecovery ? "/reset-password" : isAdmin ? "/admin" : returnTo, { replace: true });
    return undefined;
  }, [callbackUserId, isAdmin, isRecovery, loading, navigate, problem, profileError, returnTo, user]);

  if (!problem) return <LoadingState fullPage />;

  return (
    <main className="state-shell">
      <section className="state-card route-state-card">
        <h1>{isRecovery ? "Recovery request unavailable" : "Sign-in request unavailable"}</h1>
        <p>{problem.message}</p>
        <Link className="primary-action" to={isRecovery ? "/auth?mode=forgot" : withReturnTo("/auth?mode=sign-in", returnTo)}>{isRecovery ? "Start password recovery again" : "Return to sign in"}</Link>
      </section>
    </main>
  );
}
