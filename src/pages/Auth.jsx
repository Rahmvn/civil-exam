import { useState } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";

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
  const redirectTo = location.state?.from?.pathname ?? "/dashboard";
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
          setMessage("Account ready. Redirecting to your dashboard.");
        } else {
          const { error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (signInError) {
            setMessage("Check your email to confirm your account, then sign in.");
          } else {
            setMessage("Account ready. Redirecting to your dashboard.");
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
      <section className="auth-shell">
        <section className="auth-panel">
          <h1>{mode === "sign-up" ? "Create your account" : "Welcome back"}</h1>
          {authNotice && <p className="notice">{authNotice}</p>}

          <form className="stack-form auth-form" onSubmit={handleSubmit}>
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
      </section>
    </main>
  );
}
