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
import { getPaymentStatusMeta, partitionPaymentRecords } from "../lib/paymentDisplay";
import { useAuth } from "../lib/useAuth";

function formatMoney(kobo, currency = "NGN") {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: currency || "NGN",
    maximumFractionDigits: 0,
  }).format((kobo ?? 0) / 100);
}

function formatPdfMoney(kobo, currency = "NGN") {
  const amount = new Intl.NumberFormat("en-NG", {
    maximumFractionDigits: 0,
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

async function loadReceiptLogoDataUrl() {
  const response = await fetch("/logo/promotionsure-lockup.png", { cache: "force-cache" });
  if (!response.ok) throw new Error("Receipt logo unavailable");
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(blob);
  });
}

function getPaymentAccessName(payment) {
  if (payment.subject_name) return getModuleDisplayName(payment.subject_name);
  if (payment.is_legacy_full_access) return "Legacy full access";
  return "Module access";
}

function compactReference(reference) {
  const value = String(reference ?? "").trim();
  if (!value) return "Reference unavailable";
  if (value.length <= 16) return value;
  return `${value.slice(0, 7)}...${value.slice(-5)}`;
}

function getModulePracticeSetsRoute(subjectSlug) {
  return `/modules/${encodeURIComponent(subjectSlug)}`;
}

function PaymentReference({ value }) {
  const [copied, setCopied] = useState(false);

  if (!value) {
    return <span className="access-payment-reference is-empty">Reference unavailable</span>;
  }

  async function copyReference() {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      aria-label={`Copy payment reference ${value}`}
      className="access-payment-reference"
      onClick={() => void copyReference()}
      title={value}
      type="button"
    >
      <code>{compactReference(value)}</code>
      <span className="access-payment-copy-icon" aria-hidden="true">
        {copied ? (
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="M3.5 8.2 6.7 11.3 12.8 4.7" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="M5.5 4.5V3.7c0-.9.7-1.6 1.6-1.6h4.2c.9 0 1.6.7 1.6 1.6v5.2c0 .9-.7 1.6-1.6 1.6h-.8" />
            <rect x="3.1" y="5.5" width="7.4" height="8.4" rx="1.6" />
          </svg>
        )}
      </span>
    </button>
  );
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
      const margin = 18;
      const contentWidth = pageWidth - (margin * 2);
      const logoDataUrl = await loadReceiptLogoDataUrl().catch(() => null);
      const paidBy = profile?.full_name || "Account holder";
      const email = profile?.email || "Not available";
      const accessUntil = formatDate(payment.expires_at);
      const totalPaid = formatPdfMoney(payment.amount_kobo, payment.currency);
      const receiptNumber = compactReference(reference);
      const rightColumnX = pageWidth - margin - 76;
      const rightValueX = pageWidth - margin;
      const labelColor = [93, 103, 118];
      const textColor = [28, 36, 48];
      const brandColor = [15, 91, 58];
      const lineColor = [220, 227, 232];

      function setText() {
        document.setTextColor(textColor[0], textColor[1], textColor[2]);
      }

      function setMuted() {
        document.setTextColor(labelColor[0], labelColor[1], labelColor[2]);
      }

      function setBrand() {
        document.setTextColor(brandColor[0], brandColor[1], brandColor[2]);
      }

      function drawRule(y, weight = 0.2) {
        document.setDrawColor(lineColor[0], lineColor[1], lineColor[2]);
        document.setLineWidth(weight);
        document.line(margin, y, pageWidth - margin, y);
      }

      function drawMetaPair(label, value, x, y, options = {}) {
        const valueX = options.valueX ?? x + 34;
        const valueWidth = options.valueWidth ?? pageWidth - margin - valueX;
        const valueLines = document.splitTextToSize(String(value), valueWidth);
        document.setFont("helvetica", "normal");
        document.setFontSize(8.2);
        setMuted();
        document.text(label, x, y);
        document.setFont("helvetica", options.bold === false ? "normal" : "bold");
        document.setFontSize(8.6);
        setText();
        document.text(valueLines, valueX, y);
        return y + Math.max(7, valueLines.length * 4.2);
      }

      document.setProperties({
        title: `Payment receipt ${reference}`,
        subject: "Verified module payment receipt",
        author: BRAND_NAME,
      });

      document.setFillColor(brandColor[0], brandColor[1], brandColor[2]);
      document.rect(0, 0, pageWidth, 4, "F");

      if (logoDataUrl) {
        document.addImage(logoDataUrl, "PNG", margin, 14, 50, 8.7);
      } else {
        setBrand();
        document.setFont("helvetica", "bold");
        document.setFontSize(12);
        document.text(BRAND_NAME, margin, 20.5);
        document.setFont("helvetica", "normal");
        document.setFontSize(8);
        setMuted();
        document.text(BRAND_DESCRIPTOR, margin, 25);
      }

      setText();
      document.setFont("helvetica", "bold");
      document.setFontSize(14.5);
      document.text("Payment receipt", rightValueX, 18.5, { align: "right" });
      document.setFont("helvetica", "normal");
      document.setFontSize(8.4);
      setMuted();
      document.text(`Receipt no. ${receiptNumber}`, rightValueX, 25, { align: "right" });
      setBrand();
      document.setFont("helvetica", "bold");
      document.setFontSize(8.2);
      document.text("Payment verified", rightValueX, 31, { align: "right" });

      drawRule(38);

      document.setFont("helvetica", "normal");
      document.setFontSize(8);
      setMuted();
      document.text("Bill to", margin, 50);
      document.setFont("helvetica", "bold");
      document.setFontSize(9.8);
      setText();
      document.text(paidBy, margin, 58);
      document.setFont("helvetica", "normal");
      document.setFontSize(8.4);
      setMuted();
      document.text(email, margin, 65);

      document.setFont("helvetica", "normal");
      document.setFontSize(8);
      setMuted();
      document.text("Receipt details", rightColumnX, 50);
      document.text("Issued on", rightColumnX, 59);
      document.text("Provider", rightColumnX, 67);
      setText();
      document.setFont("helvetica", "bold");
      document.setFontSize(8.4);
      document.text(paymentDate, rightValueX, 59, { align: "right" });
      document.text("Paystack", rightValueX, 67, { align: "right" });

      drawRule(80);

      document.setFont("helvetica", "bold");
      document.setFontSize(8.4);
      setMuted();
      document.text("Item", margin, 92);
      document.text("Access valid until", pageWidth - margin - 72, 92);
      document.text("Amount", rightValueX, 92, { align: "right" });
      drawRule(98);

      document.setFont("helvetica", "bold");
      document.setFontSize(9.2);
      setText();
      document.text(`${accessName} module access`, margin, 110);
      document.text(totalPaid, rightValueX, 110, { align: "right" });
      document.setFont("helvetica", "normal");
      document.setFontSize(8.2);
      setMuted();
      document.text("Module access", margin, 118);
      document.text(accessUntil, pageWidth - margin - 72, 110);

      drawRule(130);
      document.setFont("helvetica", "bold");
      document.setFontSize(10.2);
      setText();
      document.text("Total paid", pageWidth - margin - 72, 142);
      document.text(totalPaid, rightValueX, 142, { align: "right" });
      drawRule(149);

      document.setFont("helvetica", "bold");
      document.setFontSize(9.2);
      setText();
      document.text("Verification details", margin, 164);
      let detailsY = 176;
      detailsY = drawMetaPair("Reference", reference, margin, detailsY, { valueX: margin + 38 });
      detailsY = drawMetaPair("Module", accessName, margin, detailsY, { valueX: margin + 38 });
      drawMetaPair("Access until", accessUntil, margin, detailsY, { valueX: margin + 38 });

      drawRule(206);
      document.setFont("helvetica", "normal");
      document.setFontSize(8);
      setMuted();
      const note = "This receipt confirms that PromotionSure received and verified this payment. Keep the payment reference for support.";
      document.text(document.splitTextToSize(note, contentWidth), margin, 217);

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
            <h2 id="payment-receipt-title">Payment receipt</h2>
            <p>{accessName} <span aria-hidden="true">&middot;</span> {paymentDate}</p>
            <span className="access-receipt-status">Payment verified</span>
          </div>
          <button className="access-receipt-close" aria-label="Close receipt" onClick={onClose} type="button">&times;</button>
        </header>

        <dl className="access-receipt-details">
          <div><dt>Paid by</dt><dd>{profile?.full_name || "Account holder"}</dd></div>
          <div><dt>Email</dt><dd>{profile?.email || "Not available"}</dd></div>
          <div><dt>Module</dt><dd>{accessName}</dd></div>
          <div><dt>Access until</dt><dd>{formatDate(payment.expires_at)}</dd></div>
          <div>
            <dt>Reference</dt>
            <dd className="access-receipt-reference">
              <code title={reference}>{compactReference(reference)}</code>
              <button
                aria-label={`Copy payment reference ${reference}`}
                className="access-receipt-copy"
                disabled={!payment.paystack_reference}
                onClick={() => void copyReference()}
                type="button"
              >
                <span className="access-payment-copy-icon" aria-hidden="true">
                  {copied ? (
                    <svg viewBox="0 0 16 16" focusable="false">
                      <path d="M3.5 8.2 6.7 11.3 12.8 4.7" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" focusable="false">
                      <path d="M5.5 4.5V3.7c0-.9.7-1.6 1.6-1.6h4.2c.9 0 1.6.7 1.6 1.6v5.2c0 .9-.7 1.6-1.6 1.6h-.8" />
                      <rect x="3.1" y="5.5" width="7.4" height="8.4" rx="1.6" />
                    </svg>
                  )}
                </span>
              </button>
            </dd>
          </div>
          <div className="access-receipt-total-row"><dt>Total paid</dt><dd>{formatMoney(payment.amount_kobo, payment.currency)}</dd></div>
        </dl>

        <div className="access-receipt-actions">
          <button className="ghost-button" onClick={() => window.print()} type="button">Print</button>
          <button className="primary-action" disabled={downloading} onClick={() => void downloadReceipt()} type="button">
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
  const unlockedCount = modulesToShow.filter((module) => {
    const subject = subjects.find((item) => item.slug === module.subject_slug) ?? module;
    return hasUsableCandidateModuleAccess(subject, module.published_batch_count, module.has_module_access);
  }).length;

  function openUnlockModule(subjectSlug) {
    setPaymentError(null);
    setSearchParams({ module: subjectSlug });
  }

  function closeUnlockModule() {
    setPaymentError(null);
    setSearchParams({});
  }

  return (
    <AppFrame>
      <section className="access-page access-page-v2">
        <header className="access-page-intro">
          <div>
            <h1>Access and payment</h1>
          </div>
          {unlockedCount < modulesToShow.length && (
            <p>{`${unlockedCount} of ${modulesToShow.length} modules unlocked.`}</p>
          )}
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
                      <Link className="secondary-action" to={getModulePracticeSetsRoute(module.subject_slug)}>View</Link>
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
                      <div className="access-payment-title-line">
                        <strong>{getPaymentAccessName(payment)}</strong>
                        <span className={`access-payment-status is-${statusMeta.tone}`}>{statusMeta.label}</span>
                      </div>
                      <span>{`${formatMoney(payment.amount_kobo, payment.currency)} - ${formatDate(payment.paid_at || payment.created_at)}`}</span>
                      <p>{statusMeta.description}</p>
                    </div>
                    <PaymentReference value={payment.paystack_reference} />
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
                        <div className="access-payment-title-line">
                          <strong>{getPaymentAccessName(payment)}</strong>
                          <span className={`access-payment-status is-${statusMeta.tone}`}>{statusMeta.label}</span>
                        </div>
                        <span>{`${formatMoney(payment.amount_kobo, payment.currency)} - ${formatDate(payment.paid_at || payment.created_at)}`}</span>
                      </div>
                      <PaymentReference value={payment.paystack_reference} />
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
