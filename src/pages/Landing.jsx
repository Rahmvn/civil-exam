import { useState } from "react";
import { Link } from "react-router-dom";
import { PublicNav } from "../components/AppFrame";
import AuthPromptModal from "../components/AuthPromptModal";
import { useAuth } from "../lib/useAuth";

const MODULES = [
  {
    title: "Public Financial Management",
    description: "Financial Regulations, approvals, public funds, and accountability.",
    tags: ["Batch practice", "Financial rules", "Accountability"],
  },
  {
    title: "Public Service Rules",
    description: "Conduct, discipline, appointments, and service procedures.",
    tags: ["Conduct", "Appointments", "Service rules"],
  },
  {
    title: "Current Affairs",
    description: "Governance, national issues, history, and general awareness.",
    tags: ["Coming soon", "Fact-check hold", "Later release"],
  },
];

const STEPS = [
  {
    title: "Create your account",
    text: "Sign up with your full name, email, and password, then complete your saved account details.",
  },
  {
    title: "Start Batch 1",
    text: "Free users can try Batch 1 of one selected module after confirmation.",
  },
  {
    title: "Review and continue",
    text: "See your result, review answers, and unlock full access for all published batches when needed.",
  },
];

const ACCESS_TIERS = [
  {
    title: "Free Access",
    items: [
      "Batch 1 of one selected module",
      "One retry if the first attempt fails",
      "Review your submitted attempt",
    ],
  },
  {
    title: "Full Access",
    items: [
      "All currently published batches",
      "Unlimited retries",
      "Review history and progress tracking",
    ],
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
      <PublicNav />

      <section className="landing-hero landing-hero-editorial">
        <div className="hero-grid editorial-hero-grid">
          <div className="hero-copy">
            <div className="landing-brand-lockup">
              <strong>FPS Exam Practice</strong>
              <span>Federal public service promotion exam practice</span>
            </div>
            <h1>Practise one batch at a time and review with confidence.</h1>
            <p className="hero-summary">
              Structured exam practice for Nigerian civil servants preparing for promotion examinations.
            </p>
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
            <p className="panel-label">How access works</p>
            <h2>Clear, batch-based access</h2>
            <div className="hero-value-list">
              <span>Complete your account details once.</span>
              <span>Try Batch 1 of one selected module for free.</span>
              <span>Unlock all published batches when you need more.</span>
            </div>
            <p className="hero-value-note">
              Current Affairs and later oral-prep content will appear only when ready.
            </p>
          </aside>
        </div>
      </section>

      <section className="landing-section landing-proof-section">
        <div className="section-heading left-heading">
          <h2>The core modules</h2>
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
          <p className="section-note max-copy">
            Start with one free Batch 1 path, then unlock all currently published batches when you are ready.
          </p>
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
          <h2>Later releases</h2>
          <p>
            Current Affairs remains on hold while content is reviewed. Oral preparation and senior-track content will be added later as a separate section.
          </p>
        </div>
      </section>

      <section className="landing-final-cta landing-final-cta-editorial">
        <h2>Ready to start with one clear practice path?</h2>
        <p>Create your account, begin with Batch 1, and continue with full access when needed.</p>
        <Link className="primary-action" onClick={handlePrimaryClick} to={primaryCta}>
          {primaryLabel}
        </Link>
      </section>
      <AuthPromptModal onClose={() => setAuthPromptOpen(false)} open={authPromptOpen} />
    </main>
  );
}
