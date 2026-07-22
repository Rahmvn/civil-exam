import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { PublicFooter, PublicNav } from "../components/AppFrame";
import { WhatsAppSupportButton } from "../components/WhatsAppSupportButton";

const SUPPORT_EMAIL = "promotionsureapp@gmail.com";

export default function PublicSupport() {
  const [emailCopied, setEmailCopied] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Support | PromotionSure";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  async function copySupportEmail() {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
    } catch {
      const field = document.createElement("textarea");
      field.value = SUPPORT_EMAIL;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setEmailCopied(true);
  }

  return (
    <main className="legal-page-shell public-support-shell">
      <PublicNav sticky={false} />
      <article className="public-support-document">
        <header className="public-support-heading">
          <h1>Support</h1>
          <p>Choose the quickest way to get help.</p>
        </header>

        <div className="public-support-menu">
          <section className="public-support-option">
            <span className="public-support-option-icon" aria-hidden="true">?</span>
            <div>
              <h2>Signed-in support</h2>
              <p>Send a request and track its resolution from your account.</p>
            </div>
            <Link className="public-support-action" to="/help">Open help centre <span aria-hidden="true">→</span></Link>
          </section>

          <section className="public-support-option">
            <span className="public-support-option-icon" aria-hidden="true">@</span>
            <div>
              <h2>Cannot sign in?</h2>
              <p className="public-support-email">{SUPPORT_EMAIL}</p>
            </div>
            <button className="public-support-action is-secondary" onClick={() => void copySupportEmail()} type="button">
              {emailCopied ? "Email copied" : "Copy email address"}
            </button>
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
