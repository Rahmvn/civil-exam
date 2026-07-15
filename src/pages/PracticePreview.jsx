import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/useAuth";

export default function PracticePreview() {
  const { isAdmin, user } = useAuth();

  return <Navigate to={user ? (isAdmin ? "/admin" : "/dashboard") : "/auth?mode=sign-up"} replace />;
}
