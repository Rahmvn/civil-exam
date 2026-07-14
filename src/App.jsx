import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";
import "./App.css";
import { AuthProvider } from "./lib/AuthContext";
import { RequireAdmin, RequireAuth } from "./lib/AuthGuards";
import Access from "./pages/Access";
import Admin from "./pages/Admin";
import Auth from "./pages/Auth";
import AuthCallback from "./pages/AuthCallback";
import Dashboard from "./pages/Dashboard";
import Landing from "./pages/Landing";
import ModuleDetail from "./pages/ModuleDetail";
import PaymentVerify from "./pages/PaymentVerify";
import Practice from "./pages/Practice";
import PracticeStart from "./pages/PracticeStart";
import PracticePreview from "./pages/PracticePreview";
import Profile from "./pages/Profile";
import Result from "./pages/Result";
import Review from "./pages/Review";
import ProfileSetup from "./pages/ProfileSetup";
import RouteState from "./pages/RouteState";

function AppProviders() {
  return (
    <AuthProvider>
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
      { path: "/profile-setup", element: <RequireAuth><ProfileSetup /></RequireAuth> },
      { path: "/practice-preview", element: <PracticePreview /> },
      { path: "/auth", element: <Auth /> },
      { path: "/auth/callback", element: <AuthCallback /> },
      {
        path: "/dashboard",
        element: <RequireAuth><Dashboard /></RequireAuth>,
      },
      { path: "/modules", element: <Navigate to="/dashboard#modules" replace /> },
      {
        path: "/modules/:subjectSlug",
        element: <RequireAuth><ModuleDetail /></RequireAuth>,
      },
      {
        path: "/practice",
        element: <RequireAuth><PracticeStart /></RequireAuth>,
      },
      {
        path: "/practice/:subjectSlug",
        element: <RequireAuth><Practice /></RequireAuth>,
      },
      {
        path: "/result",
        element: <RequireAuth><Result /></RequireAuth>,
      },
      {
        path: "/review",
        element: <RequireAuth><Review /></RequireAuth>,
      },
      {
        path: "/profile",
        element: <RequireAuth><Profile /></RequireAuth>,
      },
      {
        path: "/access",
        element: <RequireAuth><Access /></RequireAuth>,
      },
      {
        path: "/payment/verify",
        element: <RequireAuth><PaymentVerify /></RequireAuth>,
      },
      {
        path: "/admin",
        element: <RequireAdmin><Admin /></RequireAdmin>,
      },
      { path: "*", element: <RouteState /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
