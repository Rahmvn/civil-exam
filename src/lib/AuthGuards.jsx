import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth";

export function RequireAuth({ children }) {
  const { loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return <main className="state-shell">Loading your exam workspace...</main>;
  }

  if (!user) {
    return (
      <Navigate
        to="/auth?mode=sign-in"
        replace
        state={{ authMessage: "Please sign in to continue.", from: location }}
      />
    );
  }

  return children;
}

export function RequireCompletedProfile({ children }) {
  const { loading, profileComplete, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return <main className="state-shell">Preparing your account...</main>;
  }

  if (!user) {
    return (
      <Navigate
        to="/auth?mode=sign-in"
        replace
        state={{ authMessage: "Please sign in to continue.", from: location }}
      />
    );
  }

  if (!profileComplete) {
    return <Navigate to="/profile-setup" replace state={{ from: location }} />;
  }

  return children;
}

export function RequireAdmin({ children }) {
  const { isAdmin, loading, user } = useAuth();

  if (loading) {
    return <main className="state-shell">Checking admin access...</main>;
  }

  if (!user) {
    return (
      <Navigate
        to="/auth?mode=sign-in"
        replace
        state={{ authMessage: "Please sign in to continue." }}
      />
    );
  }

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
