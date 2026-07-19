import { useEffect } from "react";
import { Link } from "react-router-dom";
import { PublicFooter, PublicNav } from "../components/AppFrame";

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
        <header>
          <h1>Support</h1>
          <p>Choose the safest way to get help with your PromotionSure account.</p>
        </header>

        <section>
          <h2>Already have an account?</h2>
          <p>Sign in to send a help request and follow its status from your account.</p>
          <Link className="public-support-action" to="/help">Open help requests</Link>
        </section>

        <section>
          <h2>Cannot sign in?</h2>
          <p>
            Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. Describe what happened, but never send
            your password, verification code, card number, PIN, or security code.
          </p>
        </section>

        <section>
          <h2>Payment issue?</h2>
          <p>
            Include the PromotionSure payment reference shown on your receipt. Do not include card or bank-account
            credentials.
          </p>
        </section>
      </article>
      <PublicFooter />
    </main>
  );
}
