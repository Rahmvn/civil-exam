import { Link, Navigate, useSearchParams } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { getSafeReturnTo, withReturnTo } from "../lib/navigation";
import { useAuth } from "../lib/useAuth";

export default function AuthCallback() {
  const { loading, user } = useAuth();
  const [searchParams] = useSearchParams();
  const returnTo = getSafeReturnTo(searchParams.get("returnTo"), "/dashboard");
  const providerError = searchParams.get("error_description") || searchParams.get("error");

  if (loading) {
    return <LoadingState fullPage />;
  }

  if (user) {
    return <Navigate to={returnTo} replace />;
  }

  return (
    <main className="state-shell">
      <section className="state-card route-state-card">
        <h1>Google sign-in was not completed</h1>
        <p>{providerError ? "Return to sign in and try again, or continue with email." : "We could not finish signing you in. Please try again."}</p>
        <Link className="primary-action" to={withReturnTo("/auth?mode=sign-in", returnTo)}>Return to sign in</Link>
      </section>
    </main>
  );
}
