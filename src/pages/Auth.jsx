import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { AuthCaptcha } from "../components/auth/AuthCaptcha";
import { OtpInput } from "../components/auth/OtpInput";
import { BrandLogo } from "../components/BrandLogo";
import { LoadingState } from "../components/LoadingState";
import {
  AUTH_PROBLEM_CODES,
  AUTH_PURPOSES,
  clearPendingAuthState,
  classifySignUpOutcome,
  createPendingAuthState,
  createSanitizedAuthProblem,
  getResendSeconds,
  isCompleteOtp,
  markRecoveryAuthorized,
  maskEmail,
  normalizeAuthEmail,
  readPendingAuthState,
  writePendingAuthState,
} from "../lib/authFlow";
import { BRAND_DESCRIPTOR, BRAND_NAME } from "../lib/brand";
import { logSanitizedAuthProblem } from "../lib/errors";
import { buildLocationPath, getSafeReturnTo } from "../lib/navigation";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";

const GOOGLE_ENABLED = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || "";
const TURNSTILE_ENABLED = import.meta.env.VITE_TURNSTILE_ENABLED === "true" && Boolean(TURNSTILE_SITE_KEY);

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

function getInitialPending(mode) {
  if (typeof window === "undefined") return null;
  if (mode === "verify-signup") return readPendingAuthState(window.sessionStorage, AUTH_PURPOSES.SIGNUP);
  if (mode === "verify-recovery") return readPendingAuthState(window.sessionStorage, AUTH_PURPOSES.RECOVERY);
  return null;
}

export default function Auth() {
  const { isAdmin, loading, user } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMode = searchParams.get("mode");
  const supportedModes = ["sign-up", "forgot", "verify-signup", "verify-recovery"];
  const mode = supportedModes.includes(requestedMode) ? requestedMode : "sign-in";
  const initialPending = getInitialPending(mode);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(initialPending?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [pending, setPending] = useState(initialPending);
  const [showPassword, setShowPassword] = useState(false);
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [signUpStep, setSignUpStep] = useState(1);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("error");
  const [busyMethod, setBusyMethod] = useState("");
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaResetKey, setCaptchaResetKey] = useState(0);
  const [now, setNow] = useState(initialPending?.requestedAt ?? 0);
  const stateReturnTo = location.state?.from ? buildLocationPath(location.state.from) : null;
  const redirectTo = getSafeReturnTo(searchParams.get("returnTo") || pending?.returnTo || stateReturnTo, "/dashboard");
  const authNotice = location.state?.authMessage ?? "";
  const verificationPurpose = mode === "verify-signup" ? AUTH_PURPOSES.SIGNUP : mode === "verify-recovery" ? AUTH_PURPOSES.RECOVERY : null;
  const handleCaptchaProblem = useCallback((value) => {
    setMessageTone("error");
    setMessage(value);
  }, []);
  const handleCaptchaToken = useCallback((value) => setCaptchaToken(value), []);

  useEffect(() => {
    if (!verificationPurpose) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [verificationPurpose]);

  if (loading) return <LoadingState fullPage />;

  if (user) {
    if (mode === "verify-recovery") return <Navigate to="/reset-password" replace />;
    return <Navigate to={isAdmin ? "/admin" : redirectTo} replace />;
  }

  function reportAuthError(error, purpose, fallbackCode) {
    const problem = createSanitizedAuthProblem(error, {
      purpose,
      route: "/auth",
      appVersion: import.meta.env.VITE_APP_VERSION || "local",
    });
    const displayProblem = problem.code === AUTH_PROBLEM_CODES.UNKNOWN && fallbackCode
      ? createSanitizedAuthProblem(fallbackCode, { purpose, route: "/auth" })
      : problem;
    logSanitizedAuthProblem("Authentication flow", displayProblem);
    setMessageTone("error");
    setMessage(displayProblem.message);
  }

  function resetCaptcha() {
    setCaptchaToken("");
    setCaptchaResetKey((value) => value + 1);
  }

  function switchMode(nextMode) {
    const nextParams = new URLSearchParams();
    nextParams.set("mode", nextMode);
    if (redirectTo !== "/dashboard") nextParams.set("returnTo", redirectTo);
    setSearchParams(nextParams);
    setPassword("");
    setConfirmPassword("");
    setOtp("");
    setShowPassword(false);
    setLegalAccepted(false);
    setSignUpStep(1);
    setMessage("");
    setMessageTone("error");
  }

  async function continueWithGoogle() {
    if (!GOOGLE_ENABLED) return;
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
      reportAuthError(error, "oauth");
      setBusyMethod("");
    }
  }

  async function requestRecovery() {
    const normalizedEmail = normalizeAuthEmail(email);
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("mode", "recovery");
    const options = { redirectTo: callbackUrl.toString() };
    if (captchaToken) options.captchaToken = captchaToken;
    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, options);
    if (error) throw error;

    const nextPending = createPendingAuthState({
      purpose: AUTH_PURPOSES.RECOVERY,
      email: normalizedEmail,
      returnTo: "/reset-password",
    });
    writePendingAuthState(window.sessionStorage, nextPending);
    setPending(nextPending);
    setNow(Date.now());
    switchMode("verify-recovery");
    setEmail(normalizedEmail);
    setMessageTone("success");
    setMessage("If an account uses this email, recovery instructions have been sent.");
  }

  async function createAccount() {
    if (!legalAccepted) {
      throw Object.assign(new Error("Legal acceptance is required"), { code: "legal_acceptance_required" });
    }
    const normalizedEmail = normalizeAuthEmail(email);
    const options = {
      data: {
        full_name: fullName.trim(),
        legal_acceptance: true,
        legal_acceptance_source: "email_signup",
      },
    };
    if (captchaToken) options.captchaToken = captchaToken;
    const { data, error } = await supabase.auth.signUp({ email: normalizedEmail, password, options });
    if (error) throw error;

    const outcome = classifySignUpOutcome(data);
    if (outcome === "immediate_session") {
      clearPendingAuthState(window.sessionStorage, AUTH_PURPOSES.SIGNUP);
      setPending(null);
      setPassword("");
      setConfirmPassword("");
      setMessageTone("success");
      setMessage("Account created. Loading your account...");
      return;
    }

    if (outcome === "verification_pending") {
      const nextPending = createPendingAuthState({
        purpose: AUTH_PURPOSES.SIGNUP,
        email: normalizedEmail,
        returnTo: redirectTo,
      });
      writePendingAuthState(window.sessionStorage, nextPending);
      setPending(nextPending);
      setPassword("");
      setConfirmPassword("");
      setNow(Date.now());
      switchMode("verify-signup");
      setEmail(normalizedEmail);
      setMessageTone("success");
      setMessage("If this email can be registered, a six-digit verification code has been sent.");
      return;
    }

    throw Object.assign(new Error("Invalid signup response"), { code: "signup_response_invalid" });
  }

  async function verifyCode() {
    if (!pending || !verificationPurpose || !isCompleteOtp(otp)) {
      setMessageTone("error");
      setMessage("Enter the complete six-digit code.");
      return;
    }

    const type = verificationPurpose === AUTH_PURPOSES.RECOVERY ? "recovery" : "email";
    const { data, error } = await supabase.auth.verifyOtp({ email: pending.email, token: otp, type });
    if (error) throw error;
    if (!data?.session?.user) throw Object.assign(new Error("Recovery session unavailable"), { code: "session_not_found" });

    if (normalizeAuthEmail(data.user.email) !== pending.email) {
      await supabase.auth.signOut();
      throw Object.assign(new Error("Recovery session mismatch"), { code: "session_not_found" });
    }

    clearPendingAuthState(window.sessionStorage, verificationPurpose);
    setPending(null);
    setOtp("");
    if (verificationPurpose === AUTH_PURPOSES.RECOVERY) {
      markRecoveryAuthorized(window.sessionStorage, data.user);
    }
  }

  async function resendCode() {
    if (!pending || getResendSeconds(pending.cooldownUntil) > 0) return;
    if (verificationPurpose === AUTH_PURPOSES.SIGNUP) {
      const options = {};
      if (captchaToken) options.captchaToken = captchaToken;
      const { error } = await supabase.auth.resend({ type: "signup", email: pending.email, options });
      if (error) throw error;
    } else {
      const callbackUrl = new URL("/auth/callback", window.location.origin);
      callbackUrl.searchParams.set("mode", "recovery");
      const options = { redirectTo: callbackUrl.toString() };
      if (captchaToken) options.captchaToken = captchaToken;
      const { error } = await supabase.auth.resetPasswordForEmail(pending.email, options);
      if (error) throw error;
    }

    const nextPending = createPendingAuthState({
      purpose: pending.purpose,
      email: pending.email,
      returnTo: pending.returnTo,
    });
    writePendingAuthState(window.sessionStorage, nextPending);
    setPending(nextPending);
    setNow(Date.now());
    setMessageTone("success");
    setMessage(
      verificationPurpose === AUTH_PURPOSES.SIGNUP
        ? "If this email can be registered, a new code has been sent. Only the latest code will work."
        : "A new code was sent. Only the latest code will work.",
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setMessageTone("error");

    if (mode === "sign-up" && signUpStep === 1) {
      setSignUpStep(2);
      return;
    }
    if (mode === "sign-up" && password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }
    if (mode === "sign-up" && !legalAccepted) {
      setMessage("Accept the Terms of Service and acknowledge the Privacy Policy to create your account.");
      return;
    }

    setBusyMethod("email");
    try {
      if (mode === "forgot") await requestRecovery();
      else if (mode === "sign-up") await createAccount();
      else if (verificationPurpose) await verifyCode();
      else {
        const { error } = await supabase.auth.signInWithPassword({ email: normalizeAuthEmail(email), password });
        if (error) throw error;
      }
    } catch (error) {
      reportAuthError(error, verificationPurpose || mode, mode === "sign-up" ? AUTH_PROBLEM_CODES.SIGNUP_FAILED : undefined);
    } finally {
      setBusyMethod("");
      resetCaptcha();
    }
  }

  async function handleResend() {
    setBusyMethod("resend");
    setMessage("");
    try {
      await resendCode();
    } catch (error) {
      reportAuthError(error, verificationPurpose || "auth");
    } finally {
      setBusyMethod("");
      resetCaptcha();
    }
  }

  const isBusy = Boolean(busyMethod);
  const isSignUpDetailsStep = mode === "sign-up" && signUpStep === 1;
  const isSignUpPasswordStep = mode === "sign-up" && signUpStep === 2;
  const isForgotPassword = mode === "forgot";
  const isVerification = Boolean(verificationPurpose);
  const resendSeconds = pending ? getResendSeconds(pending.cooldownUntil, now) : 0;
  const captchaBlocksSubmit = TURNSTILE_ENABLED && !captchaToken;

  function updateField(setter, value) {
    setter(value);
    if (message) setMessage("");
  }

  return (
    <main className="auth-page-v2">
      <Link aria-label={`${BRAND_NAME} ${BRAND_DESCRIPTOR}`} className="auth-page-brand" to="/">
        <BrandLogo showDescriptor />
      </Link>

      <section className="auth-card-v2">
        {!isForgotPassword && !isVerification && (
          <div aria-label="Authentication mode" className="auth-mode-switch">
            <button className={`auth-mode-option ${mode === "sign-in" ? "is-active" : ""}`} onClick={() => switchMode("sign-in")} type="button">Sign in</button>
            <button className={`auth-mode-option ${mode === "sign-up" ? "is-active" : ""}`} onClick={() => switchMode("sign-up")} type="button">Create account</button>
          </div>
        )}

        <header className="auth-card-heading">
          <h1>{isVerification ? (verificationPurpose === AUTH_PURPOSES.SIGNUP ? "Verify your email" : "Enter your recovery code") : isForgotPassword ? "Reset your password" : mode === "sign-up" ? "Create your account" : "Welcome back"}</h1>
          <p>{isVerification ? (verificationPurpose === AUTH_PURPOSES.SIGNUP ? `Enter the latest code if one was sent to ${maskEmail(pending?.email)}.` : `Use the latest code sent to ${maskEmail(pending?.email)}.`) : isForgotPassword ? "Enter your email and we will send secure recovery instructions." : mode === "sign-up" ? (isSignUpDetailsStep ? "First, tell us how to identify your account." : "Now create a password to secure your account.") : "Sign in to continue your preparation."}</p>
        </header>

        {authNotice && <p className="auth-inline-notice">{authNotice}</p>}

        {GOOGLE_ENABLED && !isSignUpPasswordStep && !isForgotPassword && !isVerification && (
          <>
            <button className="auth-google-button" disabled={isBusy} onClick={() => void continueWithGoogle()} type="button">
              <GoogleMark />
              <span>{busyMethod === "google" ? "Connecting..." : "Continue with Google"}</span>
            </button>
            <div className="auth-divider"><span>or continue with email</span></div>
          </>
        )}

        <form className="auth-form-v2" onSubmit={handleSubmit}>
          {isVerification ? (
            <OtpInput disabled={isBusy} id={`${verificationPurpose}-otp`} label="Six-digit verification code" onChange={(value) => updateField(setOtp, value)} value={otp} />
          ) : isSignUpPasswordStep ? (
            <>
              <label><span>Password</span><div className="auth-password-field"><input aria-label="Password" autoComplete="new-password" disabled={isBusy} minLength={8} name="password" onChange={(event) => updateField(setPassword, event.target.value)} placeholder="Create a password" required type={showPassword ? "text" : "password"} value={password} /><button aria-label={showPassword ? "Hide password" : "Show password"} className="auth-password-toggle" disabled={isBusy} onClick={() => setShowPassword((value) => !value)} type="button">{showPassword ? "Hide" : "Show"}</button></div><small>Use 8 or more characters.</small></label>
              <label><span>Confirm password</span><input aria-label="Confirm password" autoComplete="new-password" disabled={isBusy} minLength={8} name="confirm-password" onChange={(event) => updateField(setConfirmPassword, event.target.value)} placeholder="Enter your password again" required type={showPassword ? "text" : "password"} value={confirmPassword} /></label>
              <label className="auth-legal-consent">
                <input
                  checked={legalAccepted}
                  disabled={isBusy}
                  onChange={(event) => updateField(setLegalAccepted, event.target.checked)}
                  required
                  type="checkbox"
                />
                <span>
                  I agree to the <Link onClick={(event) => event.stopPropagation()} rel="noopener noreferrer" target="_blank" to="/terms">Terms of Service</Link> and acknowledge the <Link onClick={(event) => event.stopPropagation()} rel="noopener noreferrer" target="_blank" to="/privacy">Privacy Policy</Link>.
                </span>
              </label>
            </>
          ) : (
            <>
              {mode === "sign-up" && <label><span>Full name</span><input autoComplete="name" disabled={isBusy} name="name" onChange={(event) => updateField(setFullName, event.target.value)} placeholder="Your full name" required value={fullName} /></label>}
              <label><span>Email address</span><input autoCapitalize="none" autoComplete="email" disabled={isBusy} inputMode="email" name="email" onChange={(event) => updateField(setEmail, event.target.value)} placeholder="you@example.com" required type="email" value={email} /></label>
              {mode === "sign-in" && <label><span>Password</span><div className="auth-password-field"><input aria-label="Password" autoComplete="current-password" disabled={isBusy} minLength={6} name="password" onChange={(event) => updateField(setPassword, event.target.value)} placeholder="Your password" required type={showPassword ? "text" : "password"} value={password} /><button aria-label={showPassword ? "Hide password" : "Show password"} className="auth-password-toggle" disabled={isBusy} onClick={() => setShowPassword((value) => !value)} type="button">{showPassword ? "Hide" : "Show"}</button></div><button className="auth-forgot-link" onClick={() => switchMode("forgot")} type="button">Forgot password?</button></label>}
            </>
          )}

          {(mode === "sign-up" || isForgotPassword || isVerification) && <AuthCaptcha enabled={TURNSTILE_ENABLED} onProblem={handleCaptchaProblem} onTokenChange={handleCaptchaToken} resetKey={captchaResetKey} siteKey={TURNSTILE_SITE_KEY} />}
          {message && <p className={`auth-form-message is-${messageTone}`} role={messageTone === "error" ? "alert" : "status"}>{message}</p>}

          {isVerification ? (
            <>
              <button className="auth-email-submit" disabled={isBusy || !isCompleteOtp(otp) || captchaBlocksSubmit} type="submit">{busyMethod === "email" ? "Verifying..." : "Verify code"}</button>
              <div className="auth-verification-actions">
                <button className="auth-step-back" disabled={isBusy} onClick={() => { clearPendingAuthState(window.sessionStorage, verificationPurpose); setPending(null); switchMode(verificationPurpose === AUTH_PURPOSES.SIGNUP ? "sign-up" : "forgot"); }} type="button">Start again</button>
                <button className="auth-resend-button" disabled={isBusy || resendSeconds > 0 || captchaBlocksSubmit} onClick={() => void handleResend()} type="button">{busyMethod === "resend" ? "Sending..." : resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}</button>
              </div>
            </>
          ) : isSignUpPasswordStep ? (
            <div className="auth-step-actions"><button className="auth-step-back" disabled={isBusy} onClick={() => { setPassword(""); setConfirmPassword(""); setSignUpStep(1); }} type="button">Back</button><button className="auth-email-submit" disabled={isBusy || !legalAccepted || captchaBlocksSubmit} type="submit">{busyMethod === "email" ? "Creating..." : "Create account"}</button></div>
          ) : isForgotPassword ? (
            <div className="auth-step-actions"><button className="auth-step-back" disabled={isBusy} onClick={() => switchMode("sign-in")} type="button">Back</button><button className="auth-email-submit" disabled={isBusy || captchaBlocksSubmit} type="submit">{busyMethod === "email" ? "Sending..." : "Send recovery code"}</button></div>
          ) : (
            <button className="auth-email-submit" disabled={isBusy} type="submit">{busyMethod === "email" ? "Signing in..." : mode === "sign-up" ? "Next" : "Sign in"}</button>
          )}
        </form>
      </section>
      <nav aria-label="Legal" className="auth-legal-links">
        <Link to="/privacy">Privacy</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/support">Support</Link>
      </nav>
    </main>
  );
}
