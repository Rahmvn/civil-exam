import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import { UnlockModuleModal } from "../components/UnlockModuleModal";
import { BRAND_DESCRIPTOR, BRAND_NAME } from "../lib/brand";
import {
  getModuleAccessCatalog,
  getPaymentRecords,
  getSubjects,
  initializePayment,
} from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import {
  hasUsableCandidateModuleAccess,
  isCandidateModuleComingSoon,
  getModuleDisplayName,
} from "../lib/moduleDisplay";
import { getPracticeRoute } from "../lib/oralPractice";
import { getPaymentStatusMeta, partitionPaymentRecords } from "../lib/paymentDisplay";
import { useAuth } from "../lib/useAuth";

function formatMoney(kobo, currency = "NGN") {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currency || "NGN",
    maximumFractionDigits: 0,
  }).format((kobo ?? 0) / 100);
}

function formatReceiptMoney(kobo, currency = "NGN") {
  const amount = new Intl.NumberFormat("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((kobo ?? 0) / 100);
  return `${currency || "NGN"} ${amount}`;
}

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function getPaymentAccessName(payment) {
  if (payment.subject_name) return getModuleDisplayName(payment.subject_name);
  if (payment.is_legacy_full_access) return "Legacy full access";
  return "Module access";
}

function ReceiptModal({ payment, profile, onClose }) {
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const reference = payment.paystack_reference || "Not available";
  const accessName = getPaymentAccessName(payment);
  const paymentDate = formatDate(payment.paid_at || payment.created_at);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function copyReference() {
    if (!payment.paystack_reference) return;
    await navigator.clipboard?.writeText(payment.paystack_reference);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function downloadReceipt() {
    setDownloading(true);
    setDownloadError("");

    try {
      const { jsPDF } = await import("jspdf");
      const document = new jsPDF({ format: "a4", unit: "mm" });
      const pageWidth = document.internal.pageSize.getWidth();
      const margin = 20;
      const contentWidth = pageWidth - (margin * 2);
      const labelWidth = 48;
      const receiptRows = [
        ["Paid by", profile?.full_name || "Account holder"],
        ["Email", profile?.email || "Not available"],
        ["Module access", accessName],
        ["Payment date", paymentDate],
        ["Access through", formatDate(payment.expires_at)],
        ["Payment reference", reference],
      ];

      document.setProperties({
        title: `Payment receipt ${reference}`,
        subject: "Verified module payment receipt",
        author: BRAND_NAME,
      });
      document.setFillColor(15, 91, 58);
      document.rect(0, 0, pageWidth, 7, "F");
      document.setTextColor(15, 91, 58);
      document.setFont("helvetica", "bold");
      document.setFontSize(12);
      document.text(BRAND_NAME.toUpperCase(), margin, 23);
      document.setFont("helvetica", "normal");
      document.setFontSize(8.5);
      document.setTextColor(93, 103, 118);
      document.text(BRAND_DESCRIPTOR, margin, 28.5);
      document.setTextColor(28, 36, 48);
      document.setFont("helvetica", "bold");
      document.setFontSize(24);
      document.text("Payment receipt", margin, 41);
      document.setFont("helvetica", "normal");
      document.setFontSize(9);
      document.setTextColor(93, 103, 118);
      document.text(`Receipt reference: ${reference}`, margin, 49);
      document.setFillColor(234, 245, 239);
      document.roundedRect(margin, 56, contentWidth, 27, 3, 3, "F");
      document.setTextColor(15, 91, 58);
      document.setFont("helvetica", "bold");
      document.setFontSize(10);
      document.text("PAYMENT VERIFIED", margin + 7, 67);
      document.setTextColor(28, 36, 48);
      document.setFontSize(17);
      document.text(formatReceiptMoney(payment.amount_kobo, payment.currency), margin + 7, 76);

      let y = 98;
      receiptRows.forEach(([label, value]) => {
        const valueLines = document.splitTextToSize(String(value), contentWidth - labelWidth - 5);
        const rowHeight = Math.max(13, (valueLines.length * 5) + 7);
        document.setDrawColor(220, 227, 232);
        document.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);
        document.setFont("helvetica", "normal");
        document.setFontSize(9);
        document.setTextColor(93, 103, 118);
        document.text(label, margin, y + 7);
        document.setFont("helvetica", "bold");
        document.setTextColor(28, 36, 48);
        document.text(valueLines, margin + labelWidth, y + 7);
        y += rowHeight;
      });

      document.setFont("helvetica", "normal");
      document.setFontSize(8.5);
      document.setTextColor(93, 103, 118);
      const note = "This receipt confirms a payment verified through Paystack. Keep the payment reference for support or verification.";
      document.text(document.splitTextToSize(note, contentWidth), margin, y + 16);
      const safeReference = reference.replace(/[^a-zA-Z0-9_-]/g, "-");
      document.save(`promotionsure-receipt-${safeReference}.pdf`);
    } catch (error) {
      logAppError("Receipt download", error);
      setDownloadError("We could not download the receipt. You can still print it.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="access-receipt-backdrop" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="payment-receipt-title"
        aria-modal="true"
        className="access-receipt-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="access-receipt-header">
          <div>
            <span>{BRAND_NAME}</span>
            <small>{BRAND_DESCRIPTOR}</small>
            <h2 id="payment-receipt-title">Payment receipt</h2>
          </div>
          <button aria-label="Close receipt" onClick={onClose} type="button">Close</button>
        </header>

        <div className="access-receipt-paid-mark">
          <div>
            <strong>Payment verified</strong>
            <p>{formatMoney(payment.amount_kobo, payment.currency)}</p>
          </div>
        </div>

        <dl className="access-receipt-details">
          <div><dt>Paid by</dt><dd>{profile?.full_name || "Account holder"}</dd></div>
          <div><dt>Email</dt><dd>{profile?.email || "Not available"}</dd></div>
          <div><dt>Module access</dt><dd>{accessName}</dd></div>
          <div><dt>Payment date</dt><dd>{paymentDate}</dd></div>
          <div><dt>Access through</dt><dd>{formatDate(payment.expires_at)}</dd></div>
          <div><dt>Reference</dt><dd className="access-receipt-reference">{reference}</dd></div>
        </dl>

        <div className="access-receipt-actions">
          <button className="ghost-button" disabled={!payment.paystack_reference} onClick={() => void copyReference()} type="button">
            {copied ? "Reference copied" : "Copy reference"}
          </button>
          <button className="ghost-button" onClick={() => window.print()} type="button">Print</button>
          <button disabled={downloading} onClick={() => void downloadReceipt()} type="button">
            {downloading ? "Preparing PDF..." : "Download receipt"}
          </button>
        </div>
        {downloadError && <p className="action-error access-receipt-error" role="alert">{downloadError}</p>}
      </section>
    </div>
  );
}

export default function Access() {
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedModule = searchParams.get("module");
  const [moduleAccess, setModuleAccess] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [payments, setPayments] = useState([]);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payingModule, setPayingModule] = useState("");
  const [loadError, setLoadError] = useState("");
  const [paymentError, setPaymentError] = useState(null);

  useEffect(() => {
    async function loadAccess() {
      try {
        const [accessRows, paymentRows, subjectRows] = await Promise.all([
          getModuleAccessCatalog(),
          getPaymentRecords(),
          getSubjects(),
        ]);
        setModuleAccess(accessRows);
        setPayments(paymentRows);
        setSubjects(subjectRows);
      } catch (loadError) {
        logAppError("Access load", loadError);
        setLoadError(friendlyErrorMessage(loadError, "We could not load your access details. Please try again."));
      } finally {
        setLoading(false);
      }
    }

    void loadAccess();
  }, []);

  async function startPayment(subjectSlug) {
    if (payingModule) return;
    setPayingModule(subjectSlug);
    setPaymentError(null);

    try {
      const payment = await initializePayment(subjectSlug);
      if (payment.already_paid) {
        window.location.reload();
        return;
      }
      window.location.assign(payment.authorization_url);
    } catch (paymentRequestError) {
      logAppError("Access payment start", paymentRequestError);
      setPaymentError({
        subjectSlug,
        message: friendlyErrorMessage(paymentRequestError, "We could not start payment right now. Please try again."),
      });
    } finally {
      setPayingModule("");
    }
  }

  if (loading) {
    return (
      <AppFrame showBottomNav={false}>
        <LoadingState />
      </AppFrame>
    );
  }

  if (loadError) {
    return (
      <AppFrame showBottomNav={false}>
        <section className="access-page access-page-v2">
          <article className="state-card">
            <h1>Access details unavailable</h1>
            <p>{loadError}</p>
            <div className="hero-actions">
              <button onClick={() => window.location.reload()} type="button">Try again</button>
              <Link className="secondary-action" to="/dashboard">Back to dashboard</Link>
            </div>
          </article>
        </section>
      </AppFrame>
    );
  }

  const selectedModule = requestedModule
    ? moduleAccess.find((module) => module.subject_slug === requestedModule) ?? null
    : null;
  const selectedModuleSubject = selectedModule
    ? subjects.find((subject) => subject.slug === selectedModule.subject_slug) ?? selectedModule
    : null;
  const selectedModuleHasUsableAccess = selectedModule
    ? hasUsableCandidateModuleAccess(
        selectedModuleSubject,
        selectedModule.published_batch_count,
        selectedModule.has_module_access,
      )
    : false;
  const unlockModalModule = selectedModule?.can_purchase && !selectedModuleHasUsableAccess
    ? selectedModule
    : null;
  const modulesToShow = moduleAccess.filter((module) => module.can_purchase || module.has_module_access);
  const { attention: paymentAttention, history: paymentHistory } = partitionPaymentRecords(payments);

  function openUnlockModule(subjectSlug) {
    setPaymentError(null);
    setSearchParams({ module: subjectSlug });
  }

  function closeUnlockModule() {
    setPaymentError(null);
    setSearchParams({});
  }

  return (
    <AppFrame showBottomNav={false}>
      <section className="access-page access-page-v2">
        <header className="access-page-intro">
          <p>Manage module access and view your payment history.</p>
        </header>

        <section className="access-module-catalog" aria-label="Available modules">

          <div className="access-module-list">
            {modulesToShow.map((module) => {
              const displayName = getModuleDisplayName(module.subject_name);
              const isPaying = payingModule === module.subject_slug;
              const subject = subjects.find((item) => item.slug === module.subject_slug) ?? {
                ...module,
                slug: module.subject_slug,
                practice_type: "objective",
              };
              const isComingSoon = isCandidateModuleComingSoon(subject, module.published_batch_count);
              const hasUsableModuleAccess = hasUsableCandidateModuleAccess(
                subject,
                module.published_batch_count,
                module.has_module_access,
              );

              return (
                <article
                  className={`access-module-row ${hasUsableModuleAccess ? "is-unlocked" : ""}`.trim()}
                  key={module.subject_id}
                >
                  <div className="access-module-copy">
                    <div className="access-module-title-line">
                      <h2>{displayName}</h2>
                      {hasUsableModuleAccess && <span className="access-module-state">Unlocked</span>}
                    </div>
                    {isComingSoon ? (
                      <p>Practice is coming soon.</p>
                    ) : hasUsableModuleAccess ? (
                      <p>{`Active through ${formatDate(module.access_expires_at)}.`}</p>
                    ) : module.can_purchase ? (
                      <p>Unlock all published practice sets.</p>
                    ) : (
                      <p>Practice is coming soon.</p>
                    )}
                  </div>

                  <div className="access-module-action">
                    {isComingSoon ? (
                      <span className="access-module-coming-soon">Not available yet</span>
                    ) : hasUsableModuleAccess ? (
                      <Link className="secondary-action" to={getPracticeRoute(subject)}>Continue practice</Link>
                    ) : module.can_purchase ? (
                      <button aria-busy={isPaying} disabled={isPaying} onClick={() => openUnlockModule(module.subject_slug)} type="button">
                        Unlock module
                      </button>
                    ) : null}
                    {paymentError?.subjectSlug === module.subject_slug && !selectedModule && (
                      <p className="access-module-error" role="alert">{paymentError.message}</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {paymentAttention.length > 0 && (
          <section className="access-payment-attention" aria-labelledby="payment-attention-title">
            <header>
              <h2 id="payment-attention-title">Payment needs attention</h2>
            </header>
            <div className="access-payment-list">
              {paymentAttention.map((payment) => {
                const statusMeta = getPaymentStatusMeta(payment);
                return (
                  <article className="access-payment-row is-attention" key={payment.id}>
                    <div className="access-payment-main">
                      <strong>{getPaymentAccessName(payment)}</strong>
                      <span>{`${formatMoney(payment.amount_kobo, payment.currency)} - ${formatDate(payment.paid_at || payment.created_at)}`}</span>
                      <p>{statusMeta.description}</p>
                    </div>
                    <span className={`access-payment-status is-${statusMeta.tone}`}>{statusMeta.label}</span>
                    <code>{payment.paystack_reference || "Reference unavailable"}</code>
                    {statusMeta.canCheck && (
                      <Link className="access-receipt-button" to={`/payment/verify?reference=${encodeURIComponent(payment.paystack_reference)}`}>
                        {payment.provider_status === "success" ? "Check access" : "Check status"}
                      </Link>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {paymentHistory.length > 0 && (
          <details className="access-payment-section">
            <summary>
              <span>Payment history</span>
              <small>{paymentHistory.length}</small>
            </summary>
            <div className="access-payment-list">
              {paymentHistory.map((payment) => (
                (() => {
                  const statusMeta = getPaymentStatusMeta(payment);
                  return (
                    <article className={`access-payment-row ${statusMeta.canViewReceipt ? "is-verified" : ""}`} key={payment.id}>
                      <div className="access-payment-main">
                        <strong>{getPaymentAccessName(payment)}</strong>
                        <span>{`${formatMoney(payment.amount_kobo, payment.currency)} - ${formatDate(payment.paid_at || payment.created_at)}`}</span>
                      </div>
                      <span className={`access-payment-status is-${statusMeta.tone}`}>{statusMeta.label}</span>
                      <code>{payment.paystack_reference || "Reference unavailable"}</code>
                      {statusMeta.canViewReceipt ? (
                        <button className="access-receipt-button" onClick={() => setSelectedReceipt(payment)} type="button">View receipt</button>
                      ) : null}
                    </article>
                  );
                })()
              ))}
            </div>
          </details>
        )}
      </section>

      {selectedReceipt && (
        <ReceiptModal payment={selectedReceipt} profile={profile} onClose={() => setSelectedReceipt(null)} />
      )}
      {unlockModalModule && (
        <UnlockModuleModal
          error={paymentError?.subjectSlug === unlockModalModule.subject_slug ? paymentError.message : ""}
          module={unlockModalModule}
          onClose={closeUnlockModule}
          onStartPayment={startPayment}
          paying={payingModule === unlockModalModule.subject_slug}
        />
      )}
    </AppFrame>
  );
}
