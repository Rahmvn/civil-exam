import { useState } from "react";
import { Link } from "react-router-dom";
import AuthPromptModal from "../components/AuthPromptModal";
import { useAuth } from "../lib/useAuth";

const MODULES = [
  {
    title: "Public Financial Management",
    description: "Financial Regulations, approvals, public funds, and accountability.",
    tags: ["Approvals", "Public funds", "Accountability"],
  },
  {
    title: "Public Service Rules",
    description: "Conduct, discipline, appointments, and service procedures.",
    tags: ["Conduct", "Discipline", "Appointments"],
  },
  {
    title: "Current Affairs",
    description: "Governance, national issues, history, and general awareness.",
    tags: ["Governance", "History", "Awareness"],
  },
];

const STEPS = [
  {
    title: "Set your details",
    text: "Create your account, save your grade level, and start practice.",
  },
  {
    title: "Practise",
    text: "Work through focused question batches.",
  },
  {
    title: "Review",
    text: "See your score, missed questions, and explanations.",
  },
];

const ACCESS_TIERS = [
  {
    title: "Free Account",
    items: ["Real questions", "Basic review", "Up to 20 free answers"],
  },
  {
    title: "Full Access",
    items: ["All available modules", "Full explanations", "Progress and weak-area review"],
  },
];

export default function Landing() {
  const { user } = useAuth();
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const primaryCta = "/dashboard";
  const primaryLabel = user ? "Open dashboard" : "Get started";

  function handlePrimaryClick(event) {
    if (user) return;
    event.preventDefault();
    setAuthPromptOpen(true);
  }

  return (
    <main className="marketing-shell marketing-shell-editorial">
      <section className="landing-hero landing-hero-editorial">
        <div className="hero-grid editorial-hero-grid">
          <div className="hero-copy">
            <div className="landing-brand-lockup">
              <strong>Civil Service Exam Practice</strong>
              <span>For GL 07 to GL 17 officers</span>
            </div>
            <h1>Prepare for Your Civil Service Promotion Exam</h1>
            <p className="hero-summary">Level-focused practice for Nigerian civil servants.</p>
            <p className="hero-trust-line">
              Financial Regulations. Public Service Rules. Current Affairs.
            </p>
            <div className="hero-actions">
              <Link className="primary-action" onClick={handlePrimaryClick} to={primaryCta}>
                {primaryLabel}
              </Link>
            </div>
          </div>

          <aside className="hero-value-card">
            <p className="panel-label">Practice path</p>
            <h2>Start correctly</h2>
            <div className="hero-value-list">
              <span>Choose your grade level.</span>
              <span>Practise the core modules.</span>
              <span>Review before moving on.</span>
            </div>
            <p className="hero-value-note">Permanent Secretary track coming soon.</p>
          </aside>
        </div>
      </section>

      <section className="landing-section landing-proof-section">
        <div className="section-heading left-heading">
          <h2>The three exam modules</h2>
        </div>
        <div className="module-showcase editorial-module-showcase">
          {MODULES.map((module) => (
            <article key={module.title} className="module-showcase-card editorial-module-card">
              <h3>{module.title}</h3>
              <p>{module.description}</p>
              <div className="module-tag-row">
                {module.tags.map((tag) => (
                  <span key={tag} className="module-tag">
                    {tag}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section how-it-works-section">
        <div className="section-heading left-heading">
          <h2>Three simple steps</h2>
        </div>
        <div className="steps-grid editorial-steps-grid editorial-steps-grid-compact">
          {STEPS.map((step, index) => (
            <article key={step.title} className="step-card editorial-step-card">
              <div className="step-card-top">
                <span className="step-number">{index + 1}</span>
              </div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section access-preview-section">
        <div className="section-heading left-heading">
          <h2>Free access first, full access later</h2>
          <p className="section-note max-copy">Create your account, practise real questions, then unlock full access when needed.</p>
        </div>
        <div className="pricing-grid editorial-access-grid">
          {ACCESS_TIERS.map((tier, index) => (
            <article
              key={tier.title}
              className={`pricing-card editorial-access-card ${index === 1 ? "editorial-access-card-featured" : ""}`}
            >
              <h3>{tier.title}</h3>
              <div className="access-list">
                {tier.items.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section perm-sec-section">
        <div className="perm-sec-card">
          <h2>Permanent Secretary track</h2>
          <p>
            Objective practice, oral preparation, and leadership scenarios for senior public
            service candidates.
          </p>
        </div>
      </section>

      <section className="landing-final-cta landing-final-cta-editorial">
        <h2>Ready to practise with direction?</h2>
        <p>Start free. Continue when ready.</p>
        <Link className="primary-action" onClick={handlePrimaryClick} to={primaryCta}>
          {primaryLabel}
        </Link>
      </section>
      <AuthPromptModal
        onClose={() => setAuthPromptOpen(false)}
        open={authPromptOpen}
      />
    </main>
  );
}
