import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import {
  getMyEmailPreferences,
  NIGERIA_STATES,
  setMyEngagementEmailEnabled,
  updateProfile,
} from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { useAuth } from "../lib/useAuth";

const OPTIONAL_DETAILS_HELP = "Optional details help us verify account, access, or payment issues when you contact support.";

function getInitials(name) {
  const parts = name?.trim().split(/\s+/).filter(Boolean).slice(0, 2) ?? [];
  return parts.map((part) => part[0]?.toUpperCase()).join("") || "A";
}

function AccountRow({ label, value }) {
  return (
    <div className="account-detail-row">
      <span>{label}</span>
      <strong>{value || "Not provided"}</strong>
    </div>
  );
}

export default function Profile() {
  const { profile, refreshProfile, user } = useAuth();
  const [addingDetails, setAddingDetails] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [message, setMessage] = useState("");
  const [showDetailsHelp, setShowDetailsHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailPreference, setEmailPreference] = useState(null);
  const [emailPreferenceBusy, setEmailPreferenceBusy] = useState(false);
  const [emailPreferenceError, setEmailPreferenceError] = useState("");
  const fullName = profile?.full_name?.trim() || "Your account";
  const hasPhoneNumber = Boolean(profile?.phone_number?.trim());
  const hasStateCode = Boolean(profile?.state_code?.trim());
  const hasOrganizationName = Boolean(profile?.organization_name?.trim());
  const hasAnyOptionalDetails = hasPhoneNumber || hasStateCode || hasOrganizationName;
  const hasMissingOptionalDetails = !hasPhoneNumber || !hasStateCode || !hasOrganizationName;
  const hasNewDetail = Boolean(
    (!hasPhoneNumber && phoneNumber.trim())
    || (!hasStateCode && stateCode)
    || (!hasOrganizationName && organizationName.trim()),
  );

  useEffect(() => {
    let current = true;
    getMyEmailPreferences().then((preference) => {
      if (current) setEmailPreference(preference);
    }).catch((error) => {
      logAppError("Email preference load", error);
      if (current) setEmailPreferenceError("Email preferences are temporarily unavailable.");
    });
    return () => { current = false; };
  }, []);

  async function handleEmailPreferenceChange(event) {
    const enabled = event.target.checked;
    const previousPreference = emailPreference;
    setEmailPreference((current) => ({ ...current, engagement_enabled: enabled }));
    setEmailPreferenceBusy(true);
    setEmailPreferenceError("");
    try {
      setEmailPreference(await setMyEngagementEmailEnabled(enabled));
    } catch (error) {
      logAppError("Email preference update", error);
      setEmailPreference(previousPreference);
      setEmailPreferenceError(friendlyErrorMessage(error, "We could not update your email preference."));
    } finally {
      setEmailPreferenceBusy(false);
    }
  }

  function closeDetailsForm() {
    setAddingDetails(false);
    setPhoneNumber("");
    setStateCode("");
    setOrganizationName("");
    setMessage("");
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!hasNewDetail) return;
    setBusy(true);
    setMessage("");

    try {
      const updates = {};

      if (!hasPhoneNumber && phoneNumber.trim()) updates.phone_number = phoneNumber.trim();
      if (!hasStateCode && stateCode) updates.state_code = stateCode;
      if (!hasOrganizationName && organizationName.trim()) {
        updates.organization_name = organizationName.trim();
      }

      await updateProfile(user.id, updates);
      await refreshProfile(user.id);
      closeDetailsForm();
    } catch (error) {
      logAppError("Account details add", error);
      setMessage(friendlyErrorMessage(error, "We could not save your details. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppFrame>
      <section className="account-page">
        <section className="account-identity-card">
          <div className="account-avatar" aria-hidden="true">{getInitials(fullName)}</div>
          <div className="account-identity-copy">
            <h2>{fullName}</h2>
            <p>{profile?.email || "Email not available"}</p>
          </div>
        </section>

        <div className="account-layout">
          <section className="account-details-card">
            <div className="account-card-heading">
              <div className="account-heading-line">
                <h2>Account details</h2>
                <span
                  className="account-info-hint"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget)) setShowDetailsHelp(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setShowDetailsHelp(false);
                      event.currentTarget.querySelector("button")?.focus();
                    }
                  }}
                >
                  <button
                    aria-describedby="account-details-help"
                    aria-expanded={showDetailsHelp}
                    aria-label="Why optional account details are requested"
                    onClick={() => setShowDetailsHelp((current) => !current)}
                    type="button"
                  >
                    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-5" />
                      <path d="M12 8h.01" />
                    </svg>
                  </button>
                  <span
                    className="account-info-popover"
                    data-open={showDetailsHelp ? "true" : "false"}
                    id="account-details-help"
                    role="tooltip"
                  >
                    {OPTIONAL_DETAILS_HELP}
                  </span>
                </span>
              </div>
            </div>

            {addingDetails ? (
              <form className="account-edit-form" onSubmit={handleSave}>
                {!hasPhoneNumber && (
                  <label>
                    <span>Phone number <small>Optional</small></span>
                    <input inputMode="tel" maxLength={20} value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="0800 000 0000" />
                  </label>
                )}
                {!hasStateCode && (
                  <label>
                    <span>State <small>Optional</small></span>
                    <select value={stateCode} onChange={(event) => setStateCode(event.target.value)}>
                      <option value="">Not provided</option>
                      {NIGERIA_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                    </select>
                  </label>
                )}
                {!hasOrganizationName && (
                  <label className="account-organization-field">
                    <span>Civil service organisation <small>Optional</small></span>
                    <input maxLength={120} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Ministry, department, agency, or commission" />
                  </label>
                )}
                {message && <p className="action-error" role="alert">{message}</p>}
                <div className="account-edit-actions">
                  <button className="account-edit-cancel" disabled={busy} onClick={closeDetailsForm} type="button">Cancel</button>
                  <button disabled={busy || !hasNewDetail} type="submit">{busy ? "Saving..." : "Add details"}</button>
                </div>
              </form>
            ) : (
              <>
                <div className="account-detail-list">
                  <AccountRow label="Phone number" value={profile?.phone_number} />
                  <AccountRow label="State" value={profile?.state_code} />
                  <AccountRow label="Organisation" value={profile?.organization_name} />
                </div>
                {hasMissingOptionalDetails && (
                  <button className="account-edit-open" onClick={() => setAddingDetails(true)} type="button">
                    {hasAnyOptionalDetails ? "Add missing details" : "Add optional details"}
                  </button>
                )}
              </>
            )}

          </section>

          <aside className="account-side-stack">
            <section className="account-action-card">
              <div>
                <h2>Access and payment</h2>
                <p>View your current access or manage an upgrade.</p>
              </div>
              <Link className="account-action-link" to="/access">View access</Link>
            </section>

            <section className="account-support-card">
              <h2>Need help?</h2>
              <p>Send a support request and follow its resolution from your account.</p>
              <Link className="account-action-link" to="/help">Open support</Link>
            </section>

            <section className="account-support-card account-email-preference" id="email-preferences">
              <div>
                <h2>Email preferences</h2>
                <p>Choose whether PromotionSure may send preparation tips and product updates.</p>
              </div>
              {emailPreference && (
                <label>
                  <input
                    checked={Boolean(emailPreference.engagement_enabled)}
                    disabled={emailPreferenceBusy}
                    onChange={handleEmailPreferenceChange}
                    type="checkbox"
                  />
                  Engagement emails
                </label>
              )}
              {emailPreferenceError && <p className="action-error" role="alert">{emailPreferenceError}</p>}
            </section>
          </aside>
        </div>
      </section>
    </AppFrame>
  );
}

