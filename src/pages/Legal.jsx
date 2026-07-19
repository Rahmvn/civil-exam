import { useEffect } from "react";
import { Link } from "react-router-dom";
import { PublicFooter, PublicNav } from "../components/AppFrame";

const EFFECTIVE_DATE = "19 July 2026";
const CONTACT_EMAIL = "promotionsureapp@gmail.com";

function LegalPage({ children, title }) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} | PromotionSure`;
    return () => {
      document.title = previousTitle;
    };
  }, [title]);

  return (
    <main className="legal-page-shell">
      <PublicNav sticky={false} />
      <article className="legal-document">
        <header className="legal-document-header">
          <h1>{title}</h1>
          <p className="legal-document-meta">{`Effective ${EFFECTIVE_DATE}`}</p>
        </header>
        <div className="legal-document-body">{children}</div>
      </article>
      <PublicFooter />
    </main>
  );
}

function ContactLink() {
  return <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
}

export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy">
      <section>
        <h2>1. Who we are</h2>
        <p>
          PromotionSure is an online public service promotion exam practice platform operated by Saheed Imran,
          trading as PromotionSure ("PromotionSure", "we", "us", or "our"). This policy explains how we handle
          personal information when you visit or use promotionsure.com.ng and related PromotionSure services.
        </p>
        <dl className="legal-controller-card">
          <div>
            <dt>Data controller</dt>
            <dd>Saheed Imran, trading as PromotionSure, Abuja, Nigeria.</dd>
          </div>
          <div>
            <dt>Privacy contact</dt>
            <dd><ContactLink /></dd>
          </div>
        </dl>
      </section>

      <section>
        <h2>2. Information PromotionSure collects</h2>
        <ul>
          <li><strong>Account information:</strong> your name, email address, authentication method, and account identifiers.</li>
          <li><strong>Optional profile information:</strong> your phone number, state, organisation, and public service level when you choose to provide them.</li>
          <li><strong>Practice activity:</strong> selected modules, answers, oral-response drafts, scores, attempts, progress, timing, reviews, and free-module choices.</li>
          <li><strong>Payment and access records:</strong> module, amount, currency, payment reference, payment status, payment channel, access status, and access expiry. PromotionSure does not receive or store card numbers, card expiry dates, PINs, or security codes. Payment information entered during checkout is handled by the payment provider.</li>
          <li><strong>Support information:</strong> the issue details, payment reference, page path, and messages you submit to support.</li>
          <li><strong>Technical information:</strong> PromotionSure's hosting, authentication, security and payment providers may process limited technical information such as IP address, browser, device, response status, page path and security logs where necessary to operate, secure and troubleshoot the service.</li>
        </ul>
      </section>

      <section>
        <h2>3. Google sign-in data</h2>
        <p>
          If you continue with Google, PromotionSure receives your Google account name, email address, profile image
          where available, and Google account identifier through Google and PromotionSure's authentication service.
          PromotionSure uses this information only to authenticate you, create or link your PromotionSure account,
          prevent duplicate accounts, and maintain account security.
        </p>
        <p>
          PromotionSure does not request access to your Gmail messages, Google Drive, contacts, calendar, or other
          Google services. PromotionSure does not sell Google user data, use it for advertising, or use it to train
          general-purpose artificial-intelligence models. Google sign-in data is shared only with authentication
          and account-management providers where necessary to provide those services.
        </p>
        <p>
          You may revoke PromotionSure's Google access through your Google Account permissions. Revoking Google
          access does not automatically delete your PromotionSure account or records. To request account deletion,
          contact <ContactLink />.
        </p>
      </section>

      <section>
        <h2>4. How PromotionSure uses information</h2>
        <p>PromotionSure uses personal information to:</p>
        <ul>
          <li>create and secure accounts, verify email ownership, and provide password recovery;</li>
          <li>deliver practice modules, preserve progress, score attempts, and show reviews;</li>
          <li>initialize and verify payments, activate purchased access, and maintain transaction records;</li>
          <li>respond to support requests and investigate payment, account, content, or technical problems;</li>
          <li>prevent fraud, misuse, unauthorised access, and attacks; and</li>
          <li>comply with accounting, legal, regulatory, and dispute-resolution obligations.</li>
        </ul>
        <p>
          PromotionSure processes this information as necessary to provide the service you request, with your
          consent where applicable, for legitimate interests in operating a secure service, and to meet legal
          obligations.
        </p>
      </section>

      <section>
        <h2>5. Service providers and disclosures</h2>
        <p>PromotionSure uses specialist providers only where needed to operate the service, including:</p>
        <ul>
          <li>authentication and account-management providers;</li>
          <li>database, storage, hosting, email-delivery, security, and support providers;</li>
          <li>a payment provider for payment processing and verification; and</li>
          <li>Google when you choose Google sign-in.</li>
        </ul>
        <p>
          These providers may process information in other countries under their own safeguards. PromotionSure may
          also disclose information where required by law, to protect users or the service, or in connection with a
          legitimate business transfer. PromotionSure does not sell personal information.
        </p>
      </section>

      <section>
        <h2>6. Browser storage and cookies</h2>
        <p>
          PromotionSure and its authentication providers use cookies or browser storage to keep you signed in,
          protect authentication flows, preserve an active practice session, and temporarily retain unsent work.
          PromotionSure does not currently use third-party advertising cookies. Google and other authentication,
          hosting, security, and payment providers may use essential cookies when providing their parts of the
          service.
        </p>
      </section>

      <section>
        <h2>7. Retention and deletion</h2>
        <p>
          PromotionSure retains account and practice information while your account is active and for a reasonable period
          afterward where needed to provide records, resolve disputes, prevent fraud, or meet legal and accounting
          obligations. Payment and support records may be retained after account deletion where required for those
          purposes. Temporary browser data is removed when it expires, is cleared, or the relevant flow ends.
        </p>
        <p>You may request account deletion by contacting <ContactLink />. PromotionSure will explain any records that must be retained.</p>
      </section>

      <section>
        <h2>8. Your rights</h2>
        <p>
          Subject to applicable law, you may ask to access, correct, delete, restrict, or object to the processing of
          your personal information, or withdraw consent where processing relies on consent. You may also complain
          to the Nigeria Data Protection Commission. Contact us first at <ContactLink /> so we can help.
        </p>
      </section>

      <section>
        <h2>9. Security</h2>
        <p>
          PromotionSure uses access controls, encrypted connections, restricted administrative operations, and service-provider
          safeguards designed to protect information. No online service can guarantee absolute security. Keep your
          account credentials private and contact us if you suspect unauthorised access.
        </p>
      </section>

      <section>
        <h2>10. Children</h2>
        <p>
          PromotionSure is intended for adults preparing for public service promotion examinations. It is not
          directed to children under 18, and PromotionSure does not knowingly create accounts for them.
        </p>
      </section>

      <section>
        <h2>11. Changes and contact</h2>
        <p>
          PromotionSure may update this policy as the service or legal requirements change. PromotionSure will post
          the revised effective date and provide additional notice where a change materially affects users. Questions
          and privacy requests can be sent to <ContactLink />.
        </p>
        <p>For the rules governing use and purchases, read our <Link to="/terms">Terms of Service</Link>.</p>
      </section>
    </LegalPage>
  );
}

export function TermsOfService() {
  return (
    <LegalPage title="Terms of Service">
      <section>
        <h2>1. Agreement and operator</h2>
        <p>
          These Terms govern your use of PromotionSure. PromotionSure is operated by Saheed Imran, trading as
          PromotionSure. By creating an account, using practice content, or purchasing access, you agree to these
          Terms and our <Link to="/privacy">Privacy Policy</Link>. If you do not agree, do not use the service.
        </p>
      </section>

      <section>
        <h2>2. Eligibility and accounts</h2>
        <p>
          You must be at least 18 and legally able to enter this agreement. Provide accurate account information,
          keep your credentials secure, and promptly tell us about suspected unauthorised use. Your account is
          personal and may not be sold, transferred, or shared. Google authentication and email authentication are
          alternative ways to access the same account where the verified email matches.
        </p>
      </section>

      <section>
        <h2>3. Educational practice service</h2>
        <p>
          PromotionSure provides independent practice questions, oral rehearsal, progress tools, and answer review.
          It is not a government agency and is not affiliated with, endorsed by, or an official representative of
          any examination body or public service authority. Content is for preparation and educational use only.
          PromotionSure does not guarantee examination questions, promotion, employment, scores, or results.
        </p>
        <p>
          PromotionSure reviews and updates content, but mistakes or outdated references may occur. Please report
          suspected errors through Help. PromotionSure may correct, replace, withdraw, or retire content while
          preserving legitimate payment and attempt records.
        </p>
      </section>

      <section>
        <h2>4. Free and paid access</h2>
        <p>
          Available free practice, module prices, currency, included content, and access expiry are shown in the app
          before purchase or activation. A purchase grants a personal, limited, non-transferable right to use the
          selected module until the displayed expiry for the applicable exam pack. It does not transfer ownership of
          the questions or platform.
        </p>
        <p>
          PromotionSure may pause new attempts or sales for maintenance, safety, legal, or content-quality reasons.
          Existing access and completed records will be handled according to the status shown in your account and
          applicable law.
        </p>
      </section>

      <section>
        <h2>5. Payments</h2>
        <p>
          A specialist payment provider processes payments and the payment details entered at checkout. PromotionSure
          does not receive or store card numbers, card expiry dates, PINs, or security codes. Access is activated only
          after PromotionSure verifies a successful payment for the correct account, module, amount, and currency.
          Your bank or payment provider may apply separate terms or charges. Keep the payment reference shown in your
          access history when requesting assistance.
        </p>
      </section>

      <section>
        <h2>6. Refunds</h2>
        <p>
          Refunds are available for duplicate charges, incorrect charges, or successful payments where access cannot
          be delivered or restored. Completed purchases are otherwise non-refundable once digital module access has
          been activated, except where applicable law requires a refund. Send requests with the account email and
          payment reference to <ContactLink />. We may verify the transaction and access history before deciding a
          request. PromotionSure does not require card details to investigate a refund.
        </p>
      </section>

      <section>
        <h2>7. Acceptable use</h2>
        <p>You must not:</p>
        <ul>
          <li>copy, publish, scrape, sell, redistribute, or create a competing question bank from the service;</li>
          <li>share paid access, bypass payment or access controls, or use another person's account;</li>
          <li>automate requests, probe security, introduce malicious code, or disrupt the platform;</li>
          <li>submit unlawful, abusive, deceptive, or infringing material; or</li>
          <li>use PromotionSure in a way that violates law or another person's rights.</li>
        </ul>
      </section>

      <section>
        <h2>8. Intellectual property and your responses</h2>
        <p>
          PromotionSure's software, branding, interface, original explanations, content selection, arrangement and
          presentation are protected by applicable intellectual-property laws. Rights in third-party, government or
          publicly sourced materials remain with their respective owners. You retain rights in original text you
          submit. You permit PromotionSure to process your answers and support messages only as needed to provide,
          secure, support, and improve the service under the Privacy Policy.
        </p>
      </section>

      <section>
        <h2>9. Availability, suspension, and termination</h2>
        <p>
          PromotionSure aims to keep the service available but does not promise uninterrupted or error-free operation.
          PromotionSure may suspend or restrict an account to investigate fraud, security threats, chargebacks,
          illegal activity, or a material breach of these Terms. You may stop using the service or request account deletion at any time.
          Deletion does not automatically erase records that must be retained or create a refund right.
        </p>
      </section>

      <section>
        <h2>10. Responsibility and liability</h2>
        <p>
          To the extent permitted by law, PromotionSure is provided on an "as available" basis. PromotionSure is not liable for
          an examination body's decisions, your examination outcome, or losses caused solely by third-party networks,
          devices, banks, or services outside our reasonable control. Nothing in these Terms excludes liability or
          consumer rights that cannot lawfully be excluded.
        </p>
      </section>

      <section>
        <h2>11. Changes, governing law, and disputes</h2>
        <p>
          PromotionSure may update these Terms as the service changes. Material changes will apply prospectively after
          notice or publication of a revised effective date. These Terms are governed by the laws of the Federal
          Republic of Nigeria. Please contact PromotionSure first at <ContactLink /> so the matter can be reviewed promptly.
        </p>
      </section>
    </LegalPage>
  );
}
