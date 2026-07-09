import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NIGERIA_STATES, SERVICE_LEVELS, updateProfile } from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { useAuth } from "../lib/useAuth";

export default function ProfileOnboardingModal({ nextPath = "/dashboard", onClose, onComplete }) {
  const { profile, refreshProfile, user } = useAuth();
  const navigate = useNavigate();
  const [phoneNumber, setPhoneNumber] = useState(profile?.phone_number ?? "");
  const [stateCode, setStateCode] = useState(profile?.state_code ?? "");
  const [serviceLevel, setServiceLevel] = useState(profile?.service_level ?? "");
  const [organizationName, setOrganizationName] = useState(profile?.organization_name ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose?.();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!user) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      await updateProfile(user.id, {
        phone_number: phoneNumber.trim(),
        state_code: stateCode,
        service_level: serviceLevel,
        organization_name: organizationName.trim(),
        onboarding_completed_at: new Date().toISOString(),
      });

      await refreshProfile(user.id);
      await onComplete?.();
      navigate(nextPath, { replace: true });
    } catch (error) {
      logAppError("Profile onboarding save", error);
      setMessage(
        friendlyErrorMessage(error, "We could not save your details yet. Please review the form and try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-label="Complete your details to start practice"
        aria-modal="true"
        className="auth-modal-card onboarding-modal-card"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          aria-label="Close details prompt"
          className="auth-modal-close"
          onClick={onClose}
          type="button"
        >
          x
        </button>
        <h2>Complete your details to start practice</h2>
        <p>Your grade level is saved to your account for identity and reporting.</p>

        <form className="stack-form onboarding-form" onSubmit={handleSubmit}>
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
            <select
              required
              disabled={Boolean(profile?.service_level)}
              value={serviceLevel}
              onChange={(event) => setServiceLevel(event.target.value)}
            >
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
              required
              value={organizationName}
              onChange={(event) => setOrganizationName(event.target.value)}
              placeholder="Ministry, department, agency, or commission"
            />
          </label>

          <div className="lock-note">
            <strong>Important:</strong> once you continue, the grade level on this account is locked.
          </div>

          {message && <p className="notice error">{message}</p>}

          <button type="submit" disabled={busy}>
            {busy ? "Saving..." : "Save and start practice"}
          </button>
        </form>
      </section>
    </div>
  );
}
