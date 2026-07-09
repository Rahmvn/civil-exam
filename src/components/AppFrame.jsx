import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import AuthPromptModal from "./AuthPromptModal";
import { supabase } from "../lib/supabaseClient";
import { formatServiceLevelLabel } from "../lib/serviceLevel";
import { useAuth } from "../lib/useAuth";

function appNavClassName({ isActive }) {
  return `authenticated-nav-link ${isActive ? "active" : ""}`;
}

export function PublicNav({ showBrand = true, sticky = true }) {
  const { user } = useAuth();
  const navCtaLabel = user ? "Open dashboard" : "Get started";
  const [authPromptOpen, setAuthPromptOpen] = useState(false);

  function handlePrimaryClick() {
    if (user) {
      window.location.href = "/dashboard";
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
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const accountMenuRef = useRef(null);
  const accountButtonRef = useRef(null);
  const levelBadge = formatServiceLevelLabel(profile?.service_level);
  const accountLabel = profile?.full_name?.trim() || "Your account";
  const accountInitials = useMemo(() => {
    const parts = accountLabel
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);

    if (parts.length === 0) return "A";
    return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
  }, [accountLabel]);

  useEffect(() => {
    if (!accountMenuOpen) return undefined;

    function handlePointerDown(event) {
      const target = event.target;

      if (
        accountMenuRef.current?.contains(target) ||
        accountButtonRef.current?.contains(target)
      ) {
        return;
      }

      setAccountMenuOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

  function closeAccountMenu() {
    setAccountMenuOpen(false);
  }

  function openSignOutConfirm() {
    closeAccountMenu();
    setShowSignOutConfirm(true);
  }

  async function signOut() {
    setShowSignOutConfirm(false);
    closeAccountMenu();
    await supabase.auth.signOut();
  }

  const isModulesActive =
    location.pathname === "/dashboard" && location.hash === "#modules";
  const isDashboardActive =
    location.pathname === "/dashboard" && location.hash !== "#modules";

  function bottomNavClassName(isActive) {
    return `authenticated-bottom-link ${isActive ? "active" : ""}`;
  }

  return (
    <>
      <main className="authenticated-shell">
        <div className="authenticated-frame">
          <header className="authenticated-header">
            <div className="authenticated-brand-row">
              <Link
                onClick={closeAccountMenu}
                to="/dashboard"
                className="brand-lockup authenticated-brand"
              >
                <strong>FPS Exam Practice</strong>
                <span>Federal public service promotion exam practice</span>
              </Link>
            </div>

            <nav className="authenticated-nav" aria-label="Primary">
              <NavLink className={appNavClassName} onClick={closeAccountMenu} to="/dashboard">
                Dashboard
              </NavLink>
              <NavLink className={appNavClassName} onClick={closeAccountMenu} to="/review">
                Review
              </NavLink>
              <NavLink className={appNavClassName} onClick={closeAccountMenu} to="/access">
                Access
              </NavLink>
              <NavLink className={appNavClassName} onClick={closeAccountMenu} to="/profile">
                Profile
              </NavLink>
              {isAdmin && (
                <NavLink className={appNavClassName} onClick={closeAccountMenu} to="/admin">
                  Admin
                </NavLink>
              )}
            </nav>

            <div className="authenticated-actions">
              {levelBadge && <span className="level-badge authenticated-level-badge">{levelBadge}</span>}
              <button
                className="authenticated-signout"
                onClick={openSignOutConfirm}
                type="button"
              >
                Sign out
              </button>
              <button
                ref={accountButtonRef}
                aria-controls="authenticated-account-menu"
                aria-expanded={accountMenuOpen}
                aria-label={accountMenuOpen ? "Close account menu" : "Open account menu"}
                className="authenticated-account-toggle"
                onClick={() => setAccountMenuOpen((value) => !value)}
                type="button"
              >
                <span>{accountInitials}</span>
              </button>
            </div>
          </header>

          {accountMenuOpen && (
            <div
              className="authenticated-account-menu"
              id="authenticated-account-menu"
              ref={accountMenuRef}
              role="menu"
            >
              <div className="authenticated-account-summary">
                <strong>{accountLabel}</strong>
                {levelBadge && <span>{levelBadge}</span>}
              </div>
              <Link
                className="authenticated-account-link"
                onClick={closeAccountMenu}
                role="menuitem"
                to="/profile"
              >
                Profile
              </Link>
              {isAdmin && (
                <Link
                  className="authenticated-account-link"
                  onClick={closeAccountMenu}
                  role="menuitem"
                  to="/admin"
                >
                  Admin
                </Link>
              )}
              <button
                className="authenticated-account-signout"
                onClick={openSignOutConfirm}
                role="menuitem"
                type="button"
              >
                Sign out
              </button>
            </div>
          )}

          <div className="authenticated-content">{children}</div>

          <footer className="authenticated-footer">
            <span>FPS Exam Practice</span>
            <Link onClick={closeAccountMenu} to="/access">
              Access and payment
            </Link>
          </footer>
        </div>

        <nav className="authenticated-bottom-nav" aria-label="Mobile primary">
          <Link className={bottomNavClassName(isDashboardActive)} onClick={closeAccountMenu} to="/dashboard">
            Dashboard
          </Link>
          <Link
            className={bottomNavClassName(isModulesActive)}
            onClick={closeAccountMenu}
            to="/dashboard#modules"
          >
            Modules
          </Link>
          <NavLink
            className={({ isActive }) => bottomNavClassName(isActive)}
            onClick={closeAccountMenu}
            to="/review"
          >
            Review
          </NavLink>
          <NavLink
            className={({ isActive }) => bottomNavClassName(isActive)}
            onClick={closeAccountMenu}
            to="/access"
          >
            Access
          </NavLink>
        </nav>
      </main>

      {showSignOutConfirm && (
        <div
          className="auth-modal-backdrop"
          role="presentation"
          onClick={() => setShowSignOutConfirm(false)}
        >
          <section
            aria-labelledby="signout-confirm-title"
            aria-modal="true"
            className="auth-modal-card signout-confirm-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h2 id="signout-confirm-title">Sign out?</h2>
            <p>You’ll need to sign in again to continue practising.</p>
            <div className="auth-modal-actions signout-confirm-actions">
              <button
                className="ghost-button"
                onClick={() => setShowSignOutConfirm(false)}
                type="button"
              >
                Cancel
              </button>
              <button className="primary-action" onClick={() => void signOut()} type="button">
                Sign out
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
