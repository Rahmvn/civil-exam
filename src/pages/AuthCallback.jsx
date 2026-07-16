import { Link, Navigate, useSearchParams } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { getSafeReturnTo, withReturnTo } from "../lib/navigation";
import { useAuth } from "../lib/useAuth";

export default function AuthCallback() {
  const { isAdmin, loading, user } = useAuth();
  const [searchParams] = useSearchParams();
  const returnTo = getSafeReturnTo(searchParams.get("returnTo"), "/dashboard");
  const isRecovery = searchParams.get("mode") === "recovery";
  const providerError = searchParams.get("error_description") || searchParams.get("error");

  if (loading) {
    return <LoadingState fullPage />;
  }

  if (user) {
    return <Navigate to={isRecovery ? "/reset-password" : isAdmin ? "/admin" : returnTo} replace />;
  }

  return (
    <main className="state-shell">
      <section className="state-card route-state-card">
        <h1>{isRecovery ? "Reset link could not be opened" : "Google sign-in was not completed"}</h1>
        <p>{isRecovery ? "The link may have expired or already been used. Request a new reset link." : providerError ? "Return to sign in and try again, or continue with email." : "We could not finish signing you in. Please try again."}</p>
        <Link className="primary-action" to={isRecovery ? "/auth?mode=forgot" : withReturnTo("/auth?mode=sign-in", returnTo)}>{isRecovery ? "Request a new link" : "Return to sign in"}</Link>
      </section>
    </main>
  );
}
