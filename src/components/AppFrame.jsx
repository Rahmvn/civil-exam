import { useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import AuthPromptModal from "./AuthPromptModal";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";

function appNavClassName({ isActive }) {
  return `app-nav-link ${isActive ? "active" : ""}`;
}

export function PublicNav({ showBrand = true, sticky = true }) {
  const { user } = useAuth();
  const navCtaLabel = user ? "Open dashboard" : "Get started";
  const navigate = useNavigate();
  const [authPromptOpen, setAuthPromptOpen] = useState(false);

  function handlePrimaryClick() {
    if (user) {
      navigate("/dashboard");
      return;
    }

    setAuthPromptOpen(true);
  }

  return (
    <>
      <nav className={`top-nav public-top-nav ${sticky ? "" : "public-top-nav-static"} ${showBrand ? "" : "public-top-nav-minimal"}`}>
        {showBrand ? (
          <Link to="/" className="brand-lockup">
            <strong>Federal Public Service Exam Practice</strong>
            <span>Levels 07 to 17 and Permanent Secretary</span>
          </Link>
        ) : (
          <Link to="/" className="brand-lockup compact-brand-lockup">
            <strong>Civil Service Exam Practice</strong>
          </Link>
        )}
        <div className="nav-actions">
          <button className="ghost-button" onClick={handlePrimaryClick} type="button">
            {navCtaLabel}
          </button>
        </div>
      </nav>
      <AuthPromptModal
        onClose={() => setAuthPromptOpen(false)}
        open={authPromptOpen}
      />
    </>
  );
}

export function AppFrame({ children }) {
  const { profile, isAdmin } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const levelBadge = profile?.service_level ?? "Account";
  const practiceLink = location.pathname.startsWith("/practice") ? location.pathname : "/dashboard#modules";
  const practiceNavClass = `app-nav-link ${location.pathname.startsWith("/practice") ? "active" : ""}`;
  const accessNavClass = `app-nav-link ${location.pathname === "/access" ? "active" : ""}`;

  async function signOut() {
    closeMenu();
    await supabase.auth.signOut();
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <main className="app-shell">
      <div className="app-layout">
        <aside className="app-sidebar">
          <div className="app-sidebar-brand">
            <Link to="/dashboard" className="brand-lockup">
              <strong>FPS Exam Practice</strong>
              <span>Civil service exam prep</span>
            </Link>
            <span className="level-badge">{levelBadge}</span>
          </div>

          <nav className="app-sidebar-nav" aria-label="Primary">
            <NavLink className={appNavClassName} to="/dashboard">
              Dashboard
            </NavLink>
            <Link className={practiceNavClass} to={practiceLink}>
              Practice
            </Link>
            <NavLink className={appNavClassName} to="/review">
              Review
            </NavLink>
            <Link className={accessNavClass} to="/access">
              Access
            </Link>
            <NavLink className={appNavClassName} to="/profile">
              Profile
            </NavLink>
            {isAdmin && (
              <Link className="app-nav-link" to="/admin">
                Admin
              </Link>
            )}
          </nav>

          <div className="app-sidebar-footer">
            <button className="ghost-button app-sidebar-signout" type="button" onClick={signOut}>
              Sign out
            </button>
          </div>
        </aside>

        <div className="app-main">
          <header className="mobile-app-header">
            <div className="mobile-brand">
              <Link to="/dashboard" className="brand-lockup">
                <strong>FPS Exam Practice</strong>
                <span>Civil service exam prep</span>
              </Link>
            </div>
            <span className="level-badge mobile-level-badge">{levelBadge}</span>
            <button
              aria-controls="mobile-app-menu"
              aria-expanded={menuOpen}
              aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
              className={`mobile-menu-button ${menuOpen ? "is-open" : ""}`}
              onClick={() => setMenuOpen((value) => !value)}
              type="button"
            >
              <span />
              <span />
              <span />
            </button>
          </header>
          {menuOpen && (
            <nav className="mobile-app-menu" id="mobile-app-menu" aria-label="Mobile">
              <NavLink className={appNavClassName} onClick={closeMenu} to="/dashboard">
                Dashboard
              </NavLink>
              <Link className={practiceNavClass} onClick={closeMenu} to={practiceLink}>
                Practice
              </Link>
              <NavLink className={appNavClassName} onClick={closeMenu} to="/review">
                Review
              </NavLink>
              <Link className={accessNavClass} onClick={closeMenu} to="/access">
                Access
              </Link>
              <NavLink className={appNavClassName} onClick={closeMenu} to="/profile">
                Profile
              </NavLink>
              {isAdmin && (
                <Link className="app-nav-link" onClick={closeMenu} to="/admin">
                  Admin
                </Link>
              )}
              <button className="mobile-signout-button sign-out" type="button" onClick={signOut}>
                Sign out
              </button>
            </nav>
          )}
          {children}
          <footer className="app-footer">
            <span>FPS Exam Practice</span>
          </footer>
        </div>
      </div>
    </main>
  );
}
