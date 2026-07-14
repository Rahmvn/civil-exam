import { useState } from "react";
import { Link } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { NIGERIA_STATES, updateProfile } from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { useAuth } from "../lib/useAuth";

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
  const [busy, setBusy] = useState(false);
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
              <h2>Account details</h2>
              <p>Contact and workplace information on your account.</p>
            </div>

            {addingDetails ? (
              <form className="account-edit-form" onSubmit={handleSave}>
                {!hasPhoneNumber && (
                  <label>
                    <span>Phone number <small>Optional</small></span>
                    <input inputMode="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="0800 000 0000" />
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
                    <input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Ministry, department, agency, or commission" />
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
              <h2>Your account, your progress</h2>
              <p>These optional details do not change your questions, modules, or access.</p>
            </section>
          </aside>
        </div>
      </section>
    </AppFrame>
  );
}
