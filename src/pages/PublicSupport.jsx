import { useEffect } from "react";
import { Link } from "react-router-dom";
import { PublicFooter, PublicNav } from "../components/AppFrame";
import { WhatsAppSupportButton } from "../components/WhatsAppSupportButton";

const SUPPORT_EMAIL = "promotionsureapp@gmail.com";

export default function PublicSupport() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Support | PromotionSure";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <main className="legal-page-shell public-support-shell">
      <PublicNav sticky={false} />
      <article className="public-support-document">
        <header className="public-support-hero">
          <span className="public-support-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 1 16 0v4a2 2 0 0 1-2 2h-2v-6h4M4 12v6h4v-6H4Z" /><path d="M16 18c0 1.1-.9 2-2 2h-2" /></svg>
          </span>
          <div>
            <span className="public-support-eyebrow">PromotionSure support</span>
            <h1>How can we help?</h1>
            <p>Choose the support route that fits your situation. We will never ask for your password, OTP, PIN, or card details.</p>
          </div>
        </header>

        <div className="public-support-options">
          <section className="public-support-option is-primary">
            <span className="public-support-option-number">01</span>
            <div>
              <h2>Signed-in support</h2>
              <p>Send a structured request, attach a payment reference when needed, and follow the resolution from your account.</p>
            </div>
            <Link className="public-support-action" to="/help">Open help centre <span aria-hidden="true">→</span></Link>
          </section>

          <section className="public-support-option">
            <span className="public-support-option-number">02</span>
            <div>
              <h2>Cannot sign in?</h2>
              <p>Email us from an address you can access and describe the problem clearly.</p>
            </div>
            <a className="public-support-action is-secondary" href={`mailto:${SUPPORT_EMAIL}`}>Email support <span aria-hidden="true">→</span></a>
          </section>
        </div>

        <aside className="public-support-payment-note">
          <span aria-hidden="true">i</span>
          <div>
            <strong>Payment or access problem?</strong>
            <p>Include only the PromotionSure payment reference shown on your receipt. Never send card or bank-account credentials.</p>
          </div>
        </aside>
      </article>
      <PublicFooter />
      <WhatsAppSupportButton />
    </main>
  );
}
