import { useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { LoadingState } from "../components/LoadingState";
import { BRAND_DESCRIPTOR, BRAND_NAME } from "../lib/brand";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { buildLocationPath, getSafeReturnTo } from "../lib/navigation";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="auth-google-mark" viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.205c0-.638-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.797 2.716v2.258h2.909c1.702-1.567 2.684-3.875 2.684-6.614Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.468-.806 5.956-2.181l-2.909-2.258c-.806.54-1.835.859-3.047.859-2.344 0-4.328-1.585-5.037-3.714H.956v2.332A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.963 10.706A5.41 5.41 0 0 1 3.682 9c0-.592.102-1.168.281-1.706V4.962H.956A9 9 0 0 0 0 9c0 1.452.347 2.827.956 4.038l3.007-2.332Z" />
      <path fill="#EA4335" d="M9 3.58c1.322 0 2.508.454 3.441 1.346l2.581-2.581C13.464.892 11.426 0 9 0A9 9 0 0 0 .956 4.962l3.007 2.332C4.672 5.165 6.656 3.58 9 3.58Z" />
    </svg>
  );
}

function getAuthMessage(error, mode) {
  const message = String(error?.message ?? "").toLowerCase();
  if (message.includes("invalid login credentials")) return "Email or password is incorrect.";
  if (message.includes("password") && (message.includes("weak") || message.includes("characters"))) {
    return "Use a password with at least 8 characters.";
  }
  if (message.includes("provider") || message.includes("oauth")) {
    return "Google sign-in is not available right now. Continue with email instead.";
  }
  return friendlyErrorMessage(
    error,
    mode === "sign-up"
      ? "We could not create your account. Check the details and try again."
      : "We could not sign you in. Please try again.",
  );
}

export default function Auth() {
  const { isAdmin, loading, user } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMode = searchParams.get("mode");
  const mode = requestedMode === "sign-up" || requestedMode === "forgot" ? requestedMode : "sign-in";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [signUpStep, setSignUpStep] = useState(1);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("error");
  const [busyMethod, setBusyMethod] = useState("");
  const stateReturnTo = location.state?.from ? buildLocationPath(location.state.from) : null;
  const redirectTo = getSafeReturnTo(searchParams.get("returnTo") || stateReturnTo, "/dashboard");
  const authNotice = location.state?.authMessage ?? "";

  if (loading) {
    return <LoadingState fullPage />;
  }

  if (user) {
    return <Navigate to={isAdmin ? "/admin" : redirectTo} replace />;
  }

  function switchMode(nextMode) {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("mode", nextMode);
    setSearchParams(nextParams);
    setPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setSignUpStep(1);
    setMessage("");
    setMessageTone("error");
  }

  async function continueWithGoogle() {
    setBusyMethod("google");
    setMessage("");

    try {
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("returnTo", redirectTo);
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: callbackUrl.toString() },
      });
      if (error) throw error;
    } catch (error) {
      logAppError("Google auth", error);
      setMessage(getAuthMessage(error, mode));
      setBusyMethod("");
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (mode === "forgot") {
      setBusyMethod("email");
      setMessage("");
      setMessageTone("error");

      try {
        const callbackUrl = new URL("/auth/callback", window.location.origin);
        callbackUrl.searchParams.set("mode", "recovery");
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: callbackUrl.toString(),
        });
        if (error) throw error;
        setMessageTone("success");
        setMessage("If an account uses this email, a password reset link has been sent.");
      } catch (error) {
        logAppError("Password reset request", error);
        setMessage(getAuthMessage(error, mode));
      } finally {
        setBusyMethod("");
      }
      return;
    }

    if (mode === "sign-up" && signUpStep === 1) {
      setMessage("");
      setSignUpStep(2);
      return;
    }

    if (mode === "sign-up" && password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setBusyMethod("email");
    setMessage("");

    try {
      if (mode === "sign-up") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) throw error;
        if (!data.session) {
          switchMode("sign-in");
          setMessageTone("success");
          setMessage("Account created. Sign in with your email and password to continue.");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (error) {
      logAppError("Auth submit", error);
      setMessage(getAuthMessage(error, mode));
    } finally {
      setBusyMethod("");
    }
  }

  const isBusy = Boolean(busyMethod);
  const isSignUpDetailsStep = mode === "sign-up" && signUpStep === 1;
  const isSignUpPasswordStep = mode === "sign-up" && signUpStep === 2;
  const isForgotPassword = mode === "forgot";

  function updateField(setter, value) {
    setter(value);
    if (message) setMessage("");
  }

  return (
    <main className="auth-page-v2">
      <Link
        aria-label={`${BRAND_NAME} ${BRAND_DESCRIPTOR}`}
        className="auth-page-brand"
        to="/"
      >
        <BrandLogo showDescriptor />
      </Link>

      <section className="auth-card-v2">
        {!isForgotPassword && (
          <div className="auth-mode-switch" aria-label="Authentication mode">
            <button className={`auth-mode-option ${mode === "sign-in" ? "is-active" : ""}`} onClick={() => switchMode("sign-in")} type="button">Sign in</button>
            <button className={`auth-mode-option ${mode === "sign-up" ? "is-active" : ""}`} onClick={() => switchMode("sign-up")} type="button">Create account</button>
          </div>
        )}

        <header className="auth-card-heading">
          <h1>{isForgotPassword ? "Reset your password" : mode === "sign-up" ? "Create your account" : "Welcome back"}</h1>
          <p>{isForgotPassword ? "Enter your email and we will send you a secure reset link." : mode === "sign-up" ? (isSignUpDetailsStep ? "First, tell us how to identify your account." : "Now create a password to secure your account.") : "Sign in to continue your preparation."}</p>
        </header>

        {authNotice && <p className="auth-inline-notice">{authNotice}</p>}

        {!isSignUpPasswordStep && !isForgotPassword && (
          <>
            <button className="auth-google-button" disabled={isBusy} onClick={() => void continueWithGoogle()} type="button">
              <GoogleMark />
              <span>{busyMethod === "google" ? "Connecting..." : "Continue with Google"}</span>
            </button>

            <div className="auth-divider"><span>or continue with email</span></div>
          </>
        )}

        <form className="auth-form-v2" onSubmit={handleSubmit}>
          {isSignUpPasswordStep ? (
            <>
              <label>
                <span>Password</span>
                <div className="auth-password-field">
                  <input
                    autoComplete="new-password"
                    disabled={isBusy}
                    minLength={8}
                    name="password"
                    onChange={(event) => updateField(setPassword, event.target.value)}
                    placeholder="Create a password"
                    required
                    type={showPassword ? "text" : "password"}
                    value={password}
                  />
                  <button className="auth-password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} disabled={isBusy} onClick={() => setShowPassword((value) => !value)} type="button">
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <small>Use 8 or more characters.</small>
              </label>
              <label>
                <span>Confirm password</span>
                <input
                  autoComplete="new-password"
                  disabled={isBusy}
                  minLength={8}
                  name="confirm-password"
                  onChange={(event) => updateField(setConfirmPassword, event.target.value)}
                  placeholder="Enter your password again"
                  required
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                />
              </label>
            </>
          ) : (
            <>
              {mode === "sign-up" && (
                <label>
                  <span>Full name</span>
                  <input autoComplete="name" disabled={isBusy} name="name" onChange={(event) => updateField(setFullName, event.target.value)} placeholder="Your full name" required value={fullName} />
                </label>
              )}
              <label>
                <span>Email address</span>
                <input autoCapitalize="none" autoComplete="email" disabled={isBusy} inputMode="email" name="email" onChange={(event) => updateField(setEmail, event.target.value)} placeholder="you@example.com" required type="email" value={email} />
              </label>
              {mode === "sign-in" && (
                <label>
                  <span>Password</span>
                  <div className="auth-password-field">
                    <input autoComplete="current-password" disabled={isBusy} minLength={6} name="password" onChange={(event) => updateField(setPassword, event.target.value)} placeholder="Your password" required type={showPassword ? "text" : "password"} value={password} />
                    <button className="auth-password-toggle" aria-label={showPassword ? "Hide password" : "Show password"} disabled={isBusy} onClick={() => setShowPassword((value) => !value)} type="button">{showPassword ? "Hide" : "Show"}</button>
                  </div>
                  <button className="auth-forgot-link" onClick={() => switchMode("forgot")} type="button">Forgot password?</button>
                </label>
              )}
            </>
          )}

          {message && <p className={`auth-form-message is-${messageTone}`} role={messageTone === "error" ? "alert" : "status"}>{message}</p>}

          {isSignUpPasswordStep ? (
            <div className="auth-step-actions">
              <button className="auth-step-back" disabled={isBusy} onClick={() => { setPassword(""); setConfirmPassword(""); setSignUpStep(1); }} type="button">Back</button>
              <button className="auth-email-submit" disabled={isBusy} type="submit">{busyMethod === "email" ? "Creating..." : "Create account"}</button>
            </div>
          ) : isForgotPassword ? (
            <div className="auth-step-actions">
              <button className="auth-step-back" disabled={isBusy} onClick={() => switchMode("sign-in")} type="button">Back</button>
              <button className="auth-email-submit" disabled={isBusy} type="submit">{busyMethod === "email" ? "Sending..." : "Send reset link"}</button>
            </div>
          ) : (
            <button className="auth-email-submit" disabled={isBusy} type="submit">
              {busyMethod === "email" ? "Signing in..." : mode === "sign-up" ? "Next" : "Sign in"}
            </button>
          )}
        </form>

      </section>
    </main>
  );
}
