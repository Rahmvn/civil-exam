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
          <strong>Federal Public Service Exam Practice</strong>
          <span>Levels 07 to 17 and Permanent Secretary</span>
        </div>
        <p className="eyebrow">Profile setup</p>
        <h1>Set up your exam identity</h1>
        <p className="support-copy">
          Your service level locks the questions and progress on this account.
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
            Service level
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
            Organization
            <input
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="Ministry, department, agency, or commission"
            />
          </label>

          <div className="lock-note">
            <strong>Important:</strong> once you continue, the service level on this
            account is locked. Contact support if it needs correction later.
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
