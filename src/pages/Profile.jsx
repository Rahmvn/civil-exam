import { AppFrame } from "../components/AppFrame";
import { useAuth } from "../lib/useAuth";

export default function Profile() {
  const { profile } = useAuth();

  return (
    <AppFrame>
      <section className="dashboard-stage">
        <section className="dashboard-hero premium-hero">
          <div className="hero-copy">
            <p className="eyebrow">Profile</p>
            <h1>{profile?.full_name}</h1>
            <p className="hero-summary">
              Your saved account details, locked level scope, and practice access all live here.
            </p>
          </div>
          <aside className="readiness-panel">
            <span className="panel-label">Locked level</span>
            <strong>{profile?.service_level}</strong>
            <p>Contact support if it ever needs correction.</p>
          </aside>
        </section>

        <section className="profile-grid">
          <article className="profile-field-card">
            <span className="panel-label">Full name</span>
            <strong>{profile?.full_name}</strong>
          </article>
          <article className="profile-field-card">
            <span className="panel-label">Email</span>
            <strong>{profile?.email}</strong>
          </article>
          <article className="profile-field-card">
            <span className="panel-label">Phone number</span>
            <strong>{profile?.phone_number}</strong>
          </article>
          <article className="profile-field-card">
            <span className="panel-label">State</span>
            <strong>{profile?.state_code}</strong>
          </article>
          <article className="profile-field-card">
            <span className="panel-label">Organization</span>
            <strong>{profile?.organization_name || "Not provided"}</strong>
          </article>
        </section>

        <section className="support-strip">
          <div>
            <p className="eyebrow">Support</p>
            <h2>Need a correction?</h2>
            <p>
              Service level changes are restricted because they affect your entire question pool,
              practice history, and review data.
            </p>
          </div>
        </section>
      </section>
    </AppFrame>
  );
}
