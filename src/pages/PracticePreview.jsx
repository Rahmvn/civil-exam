import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/useAuth";

export default function PracticePreview() {
  const { user } = useAuth();

  return <Navigate to={user ? "/dashboard" : "/auth?mode=sign-up"} replace />;
}
