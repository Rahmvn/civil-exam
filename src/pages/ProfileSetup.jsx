import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { NIGERIA_STATES, SERVICE_LEVELS, updateProfile } from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { useAuth } from "../lib/useAuth";

export default function ProfileSetup() {
  const { profile, profileComplete, refreshProfile, user } = useAuth();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone_number ?? "");
  const [stateCode, setStateCode] = useState(profile?.state_code ?? "");
  const [serviceLevel, setServiceLevel] = useState(profile?.service_level ?? "");
  const [organizationName, setOrganizationName] = useState(profile?.organization_name ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  if (profileComplete) {
    return <Navigate to="/dashboard" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      await updateProfile(user.id, {
        full_name: fullName.trim(),
        phone_number: phoneNumber.trim(),
        state_code: stateCode,
        service_level: serviceLevel,
        organization_name: organizationName.trim() || null,
        onboarding_completed_at: new Date().toISOString(),
      });
      await refreshProfile(user.id);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      logAppError("Profile setup save", error);
      setMessage(
        friendlyErrorMessage(error, "We could not save your profile yet. Please review the form and try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel wider-panel">
        <div className="setup-brand">
          <strong>FPS Exam Practice</strong>
          <span>Federal public service promotion exam practice</span>
        </div>
        <p className="eyebrow">Account setup</p>
        <h1>Complete your account details</h1>
        <p className="support-copy">
          Add the saved details we need before you continue to practice.
        </p>

        <form className="stack-form" onSubmit={handleSubmit}>
          <label>
            Full name
            <input
              required
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              placeholder="Your full name"
            />
          </label>

          <div className="form-grid">
            <label>
              Phone number
              <input
                required
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                placeholder="0800 000 0000"
              />
            </label>
            <label>
              State
              <select required value={stateCode} onChange={(event) => setStateCode(event.target.value)}>
                <option value="">Select state</option>
                {NIGERIA_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            Grade level
            <select required value={serviceLevel} onChange={(event) => setServiceLevel(event.target.value)}>
              <option value="">Select level</option>
              {SERVICE_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>

          <label>
            Civil service organisation
            <input
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="Ministry, department, agency, or commission"
            />
          </label>

          <div className="lock-note">
            <strong>Important:</strong> your grade level is locked after setup. Contact support later if it needs correction.
          </div>

          <button type="submit" disabled={busy}>
            {busy ? "Saving..." : "Continue to dashboard"}
          </button>
        </form>

        {message && <p className="notice error">{message}</p>}
      </section>
    </main>
  );
}
