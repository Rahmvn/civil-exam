import { Navigate, useLocation } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { buildLocationPath, withReturnTo } from "./navigation";
import { useAuth } from "./useAuth";

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
  const { isAdmin, loading, user } = useAuth();
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

  if (isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  return children;
}

export function RequireAdmin({ children }) {
  const { isAdmin, loading, user } = useAuth();

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

  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
