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
        ? `Active until ${new Date(summary.access_expires_at).toLocaleDateString()}.`
        : "Full access is active.";
    }

    if (summary.free_module_subject_slug) {
      return "Your free module has been selected. Batch 1 is available, with one retry if the first attempt fails.";
    }

    return "You can start Batch 1 of one module for free.";
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
      <section className="dashboard-stage">
        <section className="dashboard-hero premium-hero">
          <div className="hero-copy">
            <p className="eyebrow">Access</p>
            <h1>
              {loading
                ? "Loading access..."
                : summary?.has_paid_access
                ? "Full access is active."
                  : "Free access covers Batch 1 of one selected module."}
            </h1>
            <p className="hero-summary">
              {summary?.has_paid_access
                ? "You can continue with all available modules, all batches, unlimited retries, review history, and progress tracking."
                : "You can practise Batch 1 of one selected module for free. If your first attempt fails, you get one retry on that same batch."}
            </p>
            <p className="support-copy">
              {summary?.has_paid_access
                ? "Later batches, retries, review history, and progress tracking stay available while your access is active."
                : "Full access unlocks all modules, all batches, unlimited retries, review history, and progress tracking."}
            </p>
            {error && <p className="notice error">{error}</p>}
          </div>

          <aside className="access-card">
            <span className="panel-label">Current status</span>
            <strong>{summary?.has_paid_access ? "Paid" : "Free account"}</strong>
            <p>{summary ? accessStatus : "Your access details will appear here once they are available."}</p>
            {!summary?.has_paid_access && (
              <button type="button" disabled={paying || loading || !summary} onClick={startPayment}>
                {paying ? "Redirecting..." : `Unlock full access for ${formatNaira(summary?.price_kobo ?? 250000)}`}
              </button>
            )}
          </aside>
        </section>

        <section className="two-column-section">
          <section className="side-panel">
            <p className="eyebrow">What you get</p>
            <div className="attempt-list">
              <article>
                <div>
                  <strong>Free access</strong>
                  <span>Batch 1 of one selected module, with one retry if the first attempt fails.</span>
                </div>
              </article>
              <article>
                <div>
                  <strong>Full access</strong>
                  <span>All modules, all batches, unlimited retries, review history, and progress tracking.</span>
                </div>
              </article>
            </div>
          </section>

          <aside className="side-panel">
            <p className="eyebrow">Payment support</p>
            <p className="support-copy">
              If a payment does not reflect immediately, keep your reference and return to this page after verification.
            </p>
          </aside>
        </section>
      </section>
    </AppFrame>
  );
}
