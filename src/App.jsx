import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";
import "./App.css";
import { AuthProvider } from "./lib/AuthContext";
import { NetworkStatus } from "./components/NetworkStatus";
import { RequireAdmin, RequireCandidate } from "./lib/AuthGuards";
import Access from "./pages/Access";
import Admin from "./pages/Admin";
import Auth from "./pages/Auth";
import AuthCallback from "./pages/AuthCallback";
import Dashboard from "./pages/Dashboard";
import Landing from "./pages/Landing";
import { PrivacyPolicy, TermsOfService } from "./pages/Legal";
import ModuleDetail from "./pages/ModuleDetail";
import OralPractice from "./pages/OralPractice";
import OralReview from "./pages/OralReview";
import PaymentVerify from "./pages/PaymentVerify";
import Practice from "./pages/Practice";
import PracticeStart from "./pages/PracticeStart";
import PracticePreview from "./pages/PracticePreview";
import Profile from "./pages/Profile";
import Result from "./pages/Result";
import Review from "./pages/Review";
import ProfileSetup from "./pages/ProfileSetup";
import RouteState from "./pages/RouteState";
import ResetPassword from "./pages/ResetPassword";
import Support from "./pages/Support";
import PublicSupport from "./pages/PublicSupport";

function AppProviders() {
  return (
    <AuthProvider>
      <NetworkStatus />
      <Outlet />
    </AuthProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <AppProviders />,
    errorElement: <RouteState isError />,
    children: [
      { path: "/", element: <Landing /> },
      { path: "/privacy", element: <PrivacyPolicy /> },
      { path: "/terms", element: <TermsOfService /> },
      { path: "/support", element: <PublicSupport /> },
      { path: "/profile-setup", element: <RequireCandidate><ProfileSetup /></RequireCandidate> },
      { path: "/practice-preview", element: <PracticePreview /> },
      { path: "/auth", element: <Auth /> },
      { path: "/auth/callback", element: <AuthCallback /> },
      { path: "/reset-password", element: <ResetPassword /> },
      {
        path: "/dashboard",
        element: <RequireCandidate><Dashboard /></RequireCandidate>,
      },
      { path: "/modules", element: <RequireCandidate><Navigate to="/dashboard#modules" replace /></RequireCandidate> },
      {
        path: "/modules/:subjectSlug",
        element: <RequireCandidate><ModuleDetail /></RequireCandidate>,
      },
      {
        path: "/practice",
        element: <RequireCandidate><PracticeStart /></RequireCandidate>,
      },
      {
        path: "/practice/:subjectSlug",
        element: <RequireCandidate><Practice /></RequireCandidate>,
      },
      {
        path: "/oral-practice/:subjectSlug",
        element: <RequireCandidate><OralPractice /></RequireCandidate>,
      },
      {
        path: "/oral-review",
        element: <RequireCandidate><OralReview /></RequireCandidate>,
      },
      {
        path: "/result",
        element: <RequireCandidate><Result /></RequireCandidate>,
      },
      {
        path: "/review",
        element: <RequireCandidate><Review /></RequireCandidate>,
      },
      {
        path: "/profile",
        element: <RequireCandidate><Profile /></RequireCandidate>,
      },
      {
        path: "/access",
        element: <RequireCandidate><Access /></RequireCandidate>,
      },
      {
        path: "/help",
        element: <RequireCandidate><Support /></RequireCandidate>,
      },
      {
        path: "/payment/verify",
        element: <RequireCandidate><PaymentVerify /></RequireCandidate>,
      },
      {
        path: "/admin",
        element: <RequireAdmin><Admin /></RequireAdmin>,
      },
      {
        path: "/admin/activity",
        element: <RequireAdmin><Admin /></RequireAdmin>,
      },
      {
        path: "/admin/guide",
        element: <RequireAdmin><Admin /></RequireAdmin>,
      },
      {
        path: "/admin/help",
        element: <RequireAdmin><Admin /></RequireAdmin>,
      },
      {
        path: "/admin/payments",
        element: <RequireAdmin><Admin /></RequireAdmin>,
      },
      {
        path: "/admin/modules/:moduleId",
        element: <RequireAdmin><Admin /></RequireAdmin>,
      },
      {
        path: "/admin/modules/:moduleId/sets/:setId",
        element: <RequireAdmin><Admin /></RequireAdmin>,
      },
      { path: "*", element: <RouteState /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
