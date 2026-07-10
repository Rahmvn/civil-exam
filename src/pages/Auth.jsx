import { useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { PublicNav } from "../components/AppFrame";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";

function buildRedirectPath(locationLike) {
  if (!locationLike?.pathname) return "/dashboard";
  return `${locationLike.pathname}${locationLike.search ?? ""}${locationLike.hash ?? ""}`;
}

export default function Auth() {
  const { user } = useAuth();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const mode = searchParams.get("mode") === "sign-up" ? "sign-up" : "sign-in";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const redirectTo = buildRedirectPath(location.state?.from);
  const authNotice = location.state?.authMessage ?? "";

  if (user) {
    return <Navigate to={redirectTo} replace />;
  }

  function switchMode(nextMode) {
    setSearchParams({ mode: nextMode });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      if (mode === "sign-up") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        });

        if (error) throw error;

        if (data.session) {
          setMessage("Account created. Redirecting to your dashboard.");
        } else {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (signInError) {
            setMessage("Check your email to confirm your account, then sign in.");
          } else {
            setMessage("Account created. Redirecting to your dashboard.");
          }
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) throw error;
      }
    } catch (error) {
      logAppError("Auth submit", error);
      setMessage(friendlyErrorMessage(error, "We could not complete that action. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="marketing-shell">
      <PublicNav sticky={false} />

      <section className="auth-shell auth-shell-phase-one">
        <section className="auth-layout">
          <section className="auth-panel auth-panel-phase-one">
            <div className="auth-copy-stack">
              <p className="eyebrow">{mode === "sign-up" ? "Create account" : "Sign in"}</p>
              <h1>{mode === "sign-up" ? "Start with one clear practice path." : "Welcome back."}</h1>
              <p className="auth-lead-copy">
                {mode === "sign-up"
                  ? "Create your account, complete your saved details, and start Batch 1 of one selected module for free."
                  : "Sign in to continue your batches, review your results, and manage your access."}
              </p>
            </div>

            {authNotice && <p className="notice">{authNotice}</p>}

            <form className="stack-form auth-form auth-form-phase-one" onSubmit={handleSubmit}>
              {mode === "sign-up" && (
                <label>
                  Full name
                  <input
                    required
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Your full name"
                  />
                </label>
              )}
              <label>
                Email
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <label>
                Password
                <input
                  required
                  minLength={6}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 6 characters"
                />
              </label>
              <button type="submit" disabled={busy}>
                {busy ? "Please wait..." : mode === "sign-up" ? "Create account" : "Sign in"}
              </button>
            </form>

            {message && <p className="notice">{message}</p>}

            <p className="auth-switch-copy">
              {mode === "sign-up" ? "Already have an account?" : "Don't have an account?"}{" "}
              <button
                className="link-button"
                type="button"
                onClick={() => switchMode(mode === "sign-up" ? "sign-in" : "sign-up")}
              >
                {mode === "sign-up" ? "Sign in" : "Create account"}
              </button>
            </p>
          </section>

          <aside className="auth-side-panel">
            <p className="eyebrow">Before you continue</p>
            <h2>{mode === "sign-up" ? "What happens next" : "What you can do here"}</h2>
            <div className="auth-side-list">
              <span>Batch 1 of one selected module is available for free.</span>
              <span>Full access unlocks all currently published batches.</span>
              <span>Grade level is saved to your account for profile and reporting.</span>
            </div>
          </aside>
        </section>
      </section>
    </main>
  );
}
