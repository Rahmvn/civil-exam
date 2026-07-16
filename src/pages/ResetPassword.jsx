import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LoadingState } from "../components/LoadingState";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/useAuth";

export default function ResetPassword() {
  const { loading, user } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return <LoadingState fullPage />;

  if (!user) {
    return (
      <main className="state-shell">
        <section className="state-card route-state-card">
          <h1>Reset link expired</h1>
          <p>Request a new password reset link and open it on this device.</p>
          <Link className="primary-action" to="/auth?mode=forgot">Request a new link</Link>
        </section>
      </main>
    );
  }

  async function updatePassword(event) {
    event.preventDefault();
    setMessage("");

    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      navigate("/dashboard", { replace: true });
    } catch (error) {
      logAppError("Password update", error);
      setMessage(friendlyErrorMessage(error, "We could not update your password. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="state-shell">
      <section className="state-card password-reset-card">
        <h1>Choose a new password</h1>
        <p>Use at least 8 characters.</p>
        <form className="auth-form-v2" onSubmit={updatePassword}>
          <label>
            <span>New password</span>
            <input autoComplete="new-password" disabled={busy} minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </label>
          <label>
            <span>Confirm new password</span>
            <input autoComplete="new-password" disabled={busy} minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} />
          </label>
          {message && <p className="auth-form-message is-error" role="alert">{message}</p>}
          <button className="auth-email-submit" disabled={busy} type="submit">{busy ? "Updating..." : "Update password"}</button>
        </form>
      </section>
    </main>
  );
}
