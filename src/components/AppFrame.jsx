import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BrandLogo } from "./BrandLogo";
import { BRAND_NAME } from "../lib/brand";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";

function appNavClassName(isActive) {
  return `authenticated-nav-link ${isActive ? "active" : ""}`;
}

export function PublicNav({ showBrand = true, sticky = true }) {
  return (
    <nav
      className={`top-nav public-top-nav ${sticky ? "" : "public-top-nav-static"} ${showBrand ? "" : "public-top-nav-minimal"}`}
    >
      <Link
        aria-label={BRAND_NAME}
        to="/"
        className={`brand-lockup ${showBrand ? "" : "compact-brand-lockup"}`}
      >
        <BrandLogo />
      </Link>
      <div className="nav-actions">
        <Link className="landing-nav-signin" to="/auth?mode=sign-in">Sign in</Link>
      </div>
    </nav>
  );
}

export function PublicFooter() {
  return (
    <footer className="public-legal-footer">
      <span>PromotionSure</span>
      <nav aria-label="Legal">
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/support">Support</Link>
      </nav>
    </footer>
  );
}

export function AppFrame({
  children,
  showBottomNav = true,
  showHeader = true,
  showFooter = true,
}) {
  const { profile, isAdmin } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const accountMenuRef = useRef(null);
  const accountButtonRef = useRef(null);
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
    setSignOutError("");
    setShowSignOutConfirm(true);
  }

  async function signOut() {
    setSignOutBusy(true);
    setSignOutError("");

    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setShowSignOutConfirm(false);
      closeAccountMenu();
      navigate("/", { replace: true });
    } catch {
      setSignOutError("We could not sign you out. Please check your connection and try again.");
    } finally {
      setSignOutBusy(false);
    }
  }

  const isModulesActive =
    (location.pathname === "/dashboard" && location.hash === "#modules") ||
    location.pathname.startsWith("/modules");
  const isDashboardActive =
    location.pathname === "/dashboard" && location.hash !== "#modules";
  const isPracticeActive = location.pathname.startsWith("/practice")
    || location.pathname.startsWith("/oral-practice")
    || location.pathname === "/oral-review";
  const isReviewActive = location.pathname === "/review";
  const isAccessActive = location.pathname === "/access";
  const isAccountActive = location.pathname === "/profile";
  const practiceTarget = "/practice";

  function bottomNavClassName(isActive) {
    return `authenticated-bottom-link ${isActive ? "active" : ""}`;
  }

  return (
    <>
      <main
        className={`authenticated-shell ${showBottomNav ? "has-bottom-nav" : "no-bottom-nav"} ${showHeader ? "" : "no-header"} ${showFooter ? "" : "no-footer"}`.trim()}
      >
        <div className="authenticated-frame">
          {showHeader && (
            <header className="authenticated-header">
              <div className="authenticated-brand-row">
                <Link
                  onClick={closeAccountMenu}
                  to="/dashboard"
                  className="brand-lockup authenticated-brand"
                  aria-label={BRAND_NAME}
                >
                  <BrandLogo />
                </Link>
              </div>

              <nav className="authenticated-nav" aria-label="Primary">
                <Link
                  className={appNavClassName(isDashboardActive)}
                  onClick={closeAccountMenu}
                  to="/dashboard"
                >
                  Home
                </Link>
                <Link
                  className={appNavClassName(isModulesActive)}
                  onClick={closeAccountMenu}
                  to="/dashboard#modules"
                >
                  Modules
                </Link>
                <Link
                  className={appNavClassName(isPracticeActive)}
                  onClick={closeAccountMenu}
                  to={practiceTarget}
                >
                  Practice
                </Link>
                <Link
                  className={appNavClassName(isReviewActive)}
                  onClick={closeAccountMenu}
                  to="/review"
                >
                  Review
                </Link>
                <Link
                  className={appNavClassName(isAccountActive)}
                  onClick={closeAccountMenu}
                  to="/profile"
                >
                  Account
                </Link>
                {isAdmin && (
                  <Link
                    className={appNavClassName(location.pathname === "/admin")}
                    onClick={closeAccountMenu}
                    to="/admin"
                  >
                    Admin
                  </Link>
                )}
              </nav>

              <div className="authenticated-actions">
                <Link
                  className={`authenticated-utility-link ${isAccessActive ? "active" : ""}`}
                  onClick={closeAccountMenu}
                  to="/access"
                >
                  Access
                </Link>
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
          )}

          {accountMenuOpen && (
            <div
              className="authenticated-account-menu"
              id="authenticated-account-menu"
              ref={accountMenuRef}
              role="menu"
            >
              <div className="authenticated-account-summary">
                <strong>{accountLabel}</strong>
                <span>{profile?.email || "Signed-in account"}</span>
              </div>
              <Link
                className="authenticated-account-link"
                onClick={closeAccountMenu}
                role="menuitem"
                to="/access"
              >
                Access
              </Link>
              <Link
                className="authenticated-account-link"
                onClick={closeAccountMenu}
                role="menuitem"
                to="/profile"
              >
                Account
              </Link>
              <Link
                className="authenticated-account-link"
                onClick={closeAccountMenu}
                role="menuitem"
                to="/help"
              >
                Help and support
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

          {showFooter && (
            <footer className="authenticated-footer">
              <span>{BRAND_NAME}</span>
              <div className="authenticated-footer-links">
                <Link onClick={closeAccountMenu} to="/access">Access and payment</Link>
                <Link onClick={closeAccountMenu} to="/help">Help</Link>
                <Link onClick={closeAccountMenu} to="/privacy">Privacy</Link>
                <Link onClick={closeAccountMenu} to="/terms">Terms</Link>
              </div>
            </footer>
          )}
        </div>

        {showBottomNav && (
          <nav className="authenticated-bottom-nav" aria-label="Mobile primary">
            <Link
              className={bottomNavClassName(isDashboardActive)}
              onClick={closeAccountMenu}
              to="/dashboard"
            >
              Home
            </Link>
            <Link
              className={bottomNavClassName(isModulesActive)}
              onClick={closeAccountMenu}
              to="/dashboard#modules"
            >
              Modules
            </Link>
            <Link
              className={bottomNavClassName(isPracticeActive)}
              onClick={closeAccountMenu}
              to={practiceTarget}
            >
              Practice
            </Link>
            <Link
              className={bottomNavClassName(isReviewActive)}
              onClick={closeAccountMenu}
              to="/review"
            >
              Review
            </Link>
            <Link
              className={bottomNavClassName(isAccountActive)}
              onClick={closeAccountMenu}
              to="/profile"
            >
              Account
            </Link>
          </nav>
        )}
      </main>

      {showSignOutConfirm && (
        <div
          className="auth-modal-backdrop"
          role="presentation"
          onClick={signOutBusy ? undefined : () => setShowSignOutConfirm(false)}
        >
          <section
            aria-labelledby="signout-confirm-title"
            aria-modal="true"
            className="auth-modal-card signout-confirm-modal"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h2 id="signout-confirm-title">Sign out?</h2>
            <p>You'll need to sign in again to continue practising.</p>
            {signOutError && <p className="action-error" role="alert">{signOutError}</p>}
            <div className="auth-modal-actions signout-confirm-actions">
              <button
                className="ghost-button"
                disabled={signOutBusy}
                onClick={() => setShowSignOutConfirm(false)}
                type="button"
              >
                Cancel
              </button>
              <button className="primary-action" disabled={signOutBusy} onClick={() => void signOut()} type="button">
                {signOutBusy ? "Signing out..." : "Sign out"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
