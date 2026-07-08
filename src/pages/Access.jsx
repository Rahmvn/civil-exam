import { useEffect, useMemo, useState } from "react";
import { AppFrame } from "../components/AppFrame";
import { getCandidateSummary, initializePayment } from "../lib/appApi";
import { FREE_QUESTION_LIMIT, getAnsweredQuestionCount, getFreeQuestionsRemaining } from "../lib/accessModel";
import { friendlyErrorMessage, logAppError } from "../lib/errors";

function formatNaira(kobo) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format((kobo ?? 0) / 100);
}

export default function Access() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadAccess() {
      try {
        setSummary(await getCandidateSummary());
      } catch (loadError) {
        logAppError("Access load", loadError);
        setError(
          friendlyErrorMessage(loadError, "We could not load your access details. Please try again."),
        );
      } finally {
        setLoading(false);
      }
    }

    void loadAccess();
  }, []);

  const trialRemaining = useMemo(() => {
    return getFreeQuestionsRemaining(summary);
  }, [summary]);
  const answeredQuestionCount = getAnsweredQuestionCount(summary);

  async function startPayment() {
    setPaying(true);
    setError("");

    try {
      const payment = await initializePayment();

      if (payment.already_paid) {
        window.location.reload();
        return;
      }

      window.location.href = payment.authorization_url;
    } catch (paymentError) {
      logAppError("Access payment start", paymentError);
      setError(
        friendlyErrorMessage(paymentError, "We could not start payment right now. Please try again."),
      );
    } finally {
      setPaying(false);
    }
  }

  return (
    <AppFrame>
      <section className="dashboard-stage">
        <section className="dashboard-hero premium-hero">
          <div className="hero-copy">
            <p className="eyebrow">Access</p>
            <h1>
              {loading
                ? "Loading access..."
                : summary?.has_paid_access
                  ? "Full access is active."
                  : "Stay with the free experience until you need more."}
            </h1>
            <p className="hero-summary">
              The app is designed to let you feel the study quality first. When you are ready,
              unlock the full pack with one flat payment.
            </p>
            <p className="support-copy">
              Paid access unlocks all available content in the active pack. If some batches are still
              being uploaded, you will still see clear empty states instead of broken pages.
            </p>
            {error && <p className="notice error">{error}</p>}
          </div>

          <aside className="access-card">
            <span className="panel-label">Current status</span>
            <strong>{summary?.has_paid_access ? "Paid" : "Free account"}</strong>
            <p>
              {summary?.has_paid_access
                ? `Active until ${new Date(summary.access_expires_at).toLocaleDateString()}.`
                : summary
                  ? `${trialRemaining} of ${FREE_QUESTION_LIMIT} free questions remaining.`
                  : "Your access details will appear here once they are available."}
            </p>
            {!summary?.has_paid_access && summary && <p>{answeredQuestionCount} answered so far.</p>}
            {!summary?.has_paid_access && (
              <button type="button" disabled={paying || loading || !summary} onClick={startPayment}>
                {paying ? "Redirecting..." : `Unlock full access for ${formatNaira(summary?.price_kobo ?? 250000)}`}
              </button>
            )}
          </aside>
        </section>

        <section className="two-column-section">
          <section className="side-panel">
            <p className="eyebrow">What stays the same</p>
            <div className="attempt-list">
              <article>
                <div>
                  <strong>Your level remains locked</strong>
                  <span>Unlocking access never changes the level attached to your account.</span>
                </div>
              </article>
              <article>
                <div>
                  <strong>Review and explanations stay central</strong>
                  <span>The paid unlock simply extends your practice depth.</span>
                </div>
              </article>
            </div>
          </section>

          <aside className="side-panel">
            <p className="eyebrow">Payment support</p>
            <p className="support-copy">
              If a payment does not reflect immediately, keep your reference and return to this page
              after verification.
            </p>
          </aside>
        </section>
      </section>
    </AppFrame>
  );
}
