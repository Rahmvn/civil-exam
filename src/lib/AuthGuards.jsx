import { Navigate, useLocation } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { buildLocationPath, withReturnTo } from "./navigation";
import { useAuth } from "./useAuth";

function ProfileRecovery({ user, profileError, profileLoading, refreshProfile }) {
  return (
    <main className="state-shell">
      <section className="state-card route-state-card">
        <h1>Account details could not be loaded</h1>
        <p>
          {profileError
            ? "Check your connection and try again. Your account and progress have not been changed."
            : "We are still preparing your account details."}
        </p>
        <div className="route-state-actions">
          <button
            className="primary-action"
            disabled={profileLoading}
            onClick={() => void refreshProfile(user.id)}
            type="button"
          >
            {profileLoading ? "Trying again..." : "Try again"}
          </button>
          <a className="text-action" href="/">Go to home</a>
        </div>
      </section>
    </main>
  );
}

export function RequireAuth({ children }) {
  const { loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingState fullPage />;
  }

  if (!user) {
    const returnTo = buildLocationPath(location);
    return (
      <Navigate
        to={withReturnTo("/auth?mode=sign-in", returnTo)}
        replace
        state={{ authMessage: "Please sign in to continue.", from: location }}
      />
    );
  }

  return children;
}

export function RequireCandidate({ children }) {
  const { isAdmin, loading, profile, profileError, profileLoading, refreshProfile, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingState fullPage />;
  }

  if (!user) {
    const returnTo = buildLocationPath(location);
    return (
      <Navigate
        to={withReturnTo("/auth?mode=sign-in", returnTo)}
        replace
        state={{ authMessage: "Please sign in to continue.", from: location }}
      />
    );
  }

  if (profileLoading || (!profile && !profileError)) {
    return <LoadingState fullPage />;
  }

  if (profileError) {
    return <ProfileRecovery profileError={profileError} profileLoading={profileLoading} refreshProfile={refreshProfile} user={user} />;
  }

  if (isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return children;
}

export function RequireAdmin({ children }) {
  const { isAdmin, loading, profile, profileError, profileLoading, refreshProfile, user } = useAuth();

  if (loading) {
    return <LoadingState fullPage />;
  }

  if (!user) {
    return (
      <Navigate
        to={withReturnTo("/auth?mode=sign-in", "/admin")}
        replace
        state={{ authMessage: "Please sign in to continue." }}
      />
    );
  }

  if (profileLoading || (!profile && !profileError)) {
    return <LoadingState fullPage />;
  }

  if (profileError) {
    return <ProfileRecovery profileError={profileError} profileLoading={profileLoading} refreshProfile={refreshProfile} user={user} />;
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
