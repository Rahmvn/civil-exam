import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";
import "./App.css";
import { AuthProvider } from "./lib/AuthContext";
import { NetworkStatus } from "./components/NetworkStatus";
import { DocumentMetadata } from "./components/DocumentMetadata";
import { PurchaseModalProvider } from "./components/purchase/PurchaseModalProvider";
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
      <DocumentMetadata />
      <NetworkStatus />
      <Outlet />
    </AuthProvider>
  );
}

function CandidateRoutes() {
  return (
    <RequireCandidate>
      <PurchaseModalProvider>
        <Outlet />
      </PurchaseModalProvider>
    </RequireCandidate>
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
        element: <CandidateRoutes />,
        children: [
          { path: "/dashboard", element: <Dashboard /> },
          { path: "/modules", element: <Navigate to="/dashboard#modules" replace /> },
          { path: "/modules/:subjectSlug", element: <ModuleDetail /> },
          { path: "/practice", element: <PracticeStart /> },
          { path: "/practice/:subjectSlug", element: <Practice /> },
          { path: "/oral-practice/:subjectSlug", element: <OralPractice /> },
          { path: "/oral-review", element: <OralReview /> },
          { path: "/result", element: <Result /> },
          { path: "/review", element: <Review /> },
          { path: "/profile", element: <Profile /> },
          { path: "/access", element: <Access /> },
          { path: "/help", element: <Support /> },
          { path: "/payment/verify", element: <PaymentVerify /> },
        ],
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
        path: "/admin/users",
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
        path: "/admin/email",
        element: <RequireAdmin><Admin /></RequireAdmin>,
      },
      {
        path: "/admin/email/campaigns/:campaignId",
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
