import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import { AuthProvider } from "./lib/AuthContext";
import { RequireAdmin, RequireAuth, RequireCompletedProfile } from "./lib/AuthGuards";
import Access from "./pages/Access";
import Admin from "./pages/Admin";
import Auth from "./pages/Auth";
import Dashboard from "./pages/Dashboard";
import Landing from "./pages/Landing";
import ModuleDetail from "./pages/ModuleDetail";
import PaymentVerify from "./pages/PaymentVerify";
import Practice from "./pages/Practice";
import PracticePreview from "./pages/PracticePreview";
import Profile from "./pages/Profile";
import Result from "./pages/Result";
import Review from "./pages/Review";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/profile-setup" element={<Navigate to="/dashboard" replace />} />
          <Route path="/practice-preview" element={<PracticePreview />} />
          <Route path="/auth" element={<Auth />} />
          <Route
            path="/dashboard"
            element={
              <RequireAuth>
                <Dashboard />
              </RequireAuth>
            }
          />
          <Route path="/modules" element={<Navigate to="/dashboard#modules" replace />} />
          <Route
            path="/modules/:subjectSlug"
            element={
              <RequireAuth>
                <ModuleDetail />
              </RequireAuth>
            }
          />
          <Route
            path="/practice/:subjectSlug"
            element={
              <RequireAuth>
                <Practice />
              </RequireAuth>
            }
          />
          <Route
            path="/result"
            element={
              <RequireCompletedProfile>
                <Result />
              </RequireCompletedProfile>
            }
          />
          <Route
            path="/review"
            element={
              <RequireCompletedProfile>
                <Review />
              </RequireCompletedProfile>
            }
          />
          <Route
            path="/profile"
            element={
              <RequireAuth>
                <Profile />
              </RequireAuth>
            }
          />
          <Route
            path="/access"
            element={
              <RequireCompletedProfile>
                <Access />
              </RequireCompletedProfile>
            }
          />
          <Route
            path="/payment/verify"
            element={
              <RequireAuth>
                <PaymentVerify />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <Admin />
              </RequireAdmin>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
