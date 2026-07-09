import { useEffect, useMemo, useState } from "react";
import { AppFrame } from "../components/AppFrame";
import { getCandidateSummary, initializePayment } from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";

function formatNaira(kobo) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format((kobo ?? 0) / 100);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
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

  const accessStatus = useMemo(() => {
    if (!summary) return "";

    if (summary.has_paid_access) {
      return summary.access_expires_at
        ? `Full access is active until ${formatDate(summary.access_expires_at)}.`
        : "Full access is active.";
    }

    if (summary.free_module_subject_slug) {
      return "Your free module has been selected. Batch 1 is available, with one retry if the first attempt fails.";
    }

    return "You can start Batch 1 of one selected module for free.";
  }, [summary]);

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
      <section className="access-page">
        <header className="access-page-header">
          <div>
            <p className="eyebrow">Access</p>
            <h1>{loading ? "Loading access..." : summary?.has_paid_access ? "Full access active" : "Unlock full access"}</h1>
            <p>
              {summary?.has_paid_access
                ? "You can continue with all modules, all available batches, review history, and progress tracking."
                : "Free access covers Batch 1 of one selected module. If the first attempt fails, one retry is allowed on that same batch."}
            </p>
          </div>
          <aside className="access-status-card">
            <span>Status</span>
            <strong>{summary?.has_paid_access ? "Full access" : "Free access"}</strong>
            <p>{summary ? accessStatus : "Your access details will appear here once they are available."}</p>
            {!summary?.has_paid_access && (
              <button disabled={paying || loading || !summary} onClick={startPayment} type="button">
                {paying ? "Redirecting..." : `Unlock full access for ${formatNaira(summary?.price_kobo ?? 250000)}`}
              </button>
            )}
          </aside>
        </header>

        {error && <p className="notice error">{error}</p>}

        <section className="access-grid">
          <article className="access-detail-card">
            <p className="eyebrow">Free access</p>
            <h2>Batch 1 of one selected module</h2>
            <ul className="access-list">
              <li>Start Batch 1 of one module for free.</li>
              <li>Review your result after submission.</li>
              <li>If the first attempt fails, retry that same batch once.</li>
              <li>Batch 2 and other modules require full access.</li>
            </ul>
          </article>

          <article className="access-detail-card">
            <p className="eyebrow">Full access</p>
            <h2>All modules and all batches</h2>
            <ul className="access-list">
              <li>All available modules.</li>
              <li>All unlocked batches as content grows.</li>
              <li>Unlimited retries and review history.</li>
              <li>Progress tracking across your practice sessions.</li>
            </ul>
          </article>
        </section>

        <section className="access-support-note">
          <p className="eyebrow">Payment support</p>
          <p>
            If payment does not reflect immediately, keep your payment reference and return here after verification.
          </p>
        </section>
      </section>
    </AppFrame>
  );
}
