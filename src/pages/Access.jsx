import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import { usePurchaseModal } from "../components/purchase/usePurchaseModal";
import { BRAND_DESCRIPTOR, BRAND_NAME } from "../lib/brand";
import {
  getPaymentRecords,
  getSubjects,
} from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import {
  hasUsableCandidateModuleAccess,
  isCandidateModuleComingSoon,
  getModuleDisplayName,
  shouldShowCandidateModule,
} from "../lib/moduleDisplay";
import {
  formatPaymentDuration,
  getPaymentAccessResult,
  getPaymentItems,
  getPaymentProductLabel,
  getPaymentStatusMeta,
  partitionPaymentRecords,
} from "../lib/paymentDisplay";
import {
  PRICING_PLAN_CODES,
  findPlan,
  getRequiredModuleCount,
} from "../lib/pricingPlans";
import { formatModuleMoney, formatProductDate } from "../lib/pricing";
import { useAuth } from "../lib/useAuth";
import "./Access.css";

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
  return getPaymentProductLabel(payment);
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

function getPlanDisplayName(plan, fallback) {
  return String(plan?.display_name || fallback).trim();
}

function getLowestDuration(plan) {
  return (plan?.durations ?? []).reduce((lowest, duration) => (
    !lowest || Number(duration.price_kobo) < Number(lowest.price_kobo) ? duration : lowest
  ), null);
}

function formatAccessDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
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
  const paymentDate = formatProductDate(payment.paid_at || payment.created_at);
  const duration = formatPaymentDuration(payment.duration_months);
  const items = getPaymentItems(payment);
  const accessResult = getPaymentAccessResult(payment);
  const itemNames = items.map((item) => item.subject_name).filter(Boolean);

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
      const accessUntil = accessResult ? formatProductDate(accessResult.value) : "Not recorded";
      const totalPaid = formatModuleMoney(payment.amount_kobo, payment.currency);
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
      document.text(accessResult?.label || "Access result", pageWidth - margin - 72, 92);
      document.text("Amount", rightValueX, 92, { align: "right" });
      drawRule(98);

      document.setFont("helvetica", "bold");
      document.setFontSize(9.2);
      setText();
      document.text(document.splitTextToSize(accessName, 76), margin, 110);
      document.text(totalPaid, rightValueX, 110, { align: "right" });
      document.setFont("helvetica", "normal");
      document.setFontSize(8.2);
      setMuted();
      document.text(duration ? `${duration} access` : "Access purchase", margin, 122);
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
      detailsY = drawMetaPair("Product", accessName, margin, detailsY, { valueX: margin + 38 });
      if (duration) detailsY = drawMetaPair("Duration", duration, margin, detailsY, { valueX: margin + 38 });
      if (itemNames.length > 1) {
        detailsY = drawMetaPair("Modules", itemNames.join(", "), margin, detailsY, { valueX: margin + 38 });
      }
      if (accessResult) {
        detailsY = drawMetaPair(accessResult.label, accessUntil, margin, detailsY, { valueX: margin + 38 });
      }

      const noteRuleY = Math.min(260, Math.max(206, detailsY + 8));
      drawRule(noteRuleY);
      document.setFont("helvetica", "normal");
      document.setFontSize(8);
      setMuted();
      const note = "This receipt confirms that PromotionSure received and verified this payment. Keep the payment reference for support.";
      document.text(document.splitTextToSize(note, contentWidth), margin, noteRuleY + 11);

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
        <button className="mobile-modal-grabber access-receipt-grabber" aria-label="Close receipt" onClick={onClose} type="button" />
        <header className="access-receipt-header">
          <div>
            <h2 id="payment-receipt-title">Payment receipt</h2>
            <p>{accessName} <span aria-hidden="true">&middot;</span> {paymentDate}</p>
            <span className="access-receipt-status">
              {payment.purchase_intent === "extension" ? "Extension confirmed" : "Payment verified"}
            </span>
          </div>
          <button className="access-receipt-close" aria-label="Close receipt" onClick={onClose} type="button">&times;</button>
        </header>

        <dl className="access-receipt-details">
          <div><dt>Paid by</dt><dd>{profile?.full_name || "Account holder"}</dd></div>
          <div><dt>Email</dt><dd>{profile?.email || "Not available"}</dd></div>
          <div><dt>Product</dt><dd>{accessName}</dd></div>
          {duration && <div><dt>Duration</dt><dd>{duration}</dd></div>}
          {itemNames.length > 1 && (
            <div>
              <dt>Modules</dt>
              <dd>
                <ul className="access-receipt-module-list">
                  {itemNames.map((name) => <li key={name}>{name}</li>)}
                </ul>
              </dd>
            </div>
          )}
          {accessResult && (
            <div><dt>{accessResult.label}</dt><dd>{formatProductDate(accessResult.value)}</dd></div>
          )}
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
          <div className="access-receipt-total-row"><dt>Total paid</dt><dd>{formatModuleMoney(payment.amount_kobo, payment.currency)}</dd></div>
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

function AccessModuleRow({ entry, onOpenPurchase }) {
  const { displayName, group, module } = entry;
  const isUnlocked = group === "unlocked";
  const isAvailable = group === "available";

  return (
    <article
      className={`access-module-ledger-row access-ledger-row is-${group}`}
      data-floating-support-avoid="true"
      id={`access-row-${module.subject_slug}`}
    >
      <div className="access-module-ledger-copy">
        <div className="access-module-title-line">
          <h4>{displayName}</h4>
          {isUnlocked && (
            <Link className="access-page-action access-row-link" to={getModulePracticeSetsRoute(module.subject_slug)}>
              View <span aria-hidden="true">&rarr;</span>
            </Link>
          )}
        </div>

        {isUnlocked ? (
          <div className="access-module-entitlement-line">
            <p>{`Access until ${formatAccessDate(module.access_expires_at)}`}</p>
            {module.can_purchase && (
              <>
                <span aria-hidden="true">&middot;</span>
                <button
                  className="access-page-action access-row-link access-extend-action"
                  onClick={(event) => onOpenPurchase({
                    intent: "extension",
                    mode: "module",
                    moduleSlug: module.subject_slug,
                  }, event.currentTarget)}
                  type="button"
                >
                  Extend access <span aria-hidden="true">&rarr;</span>
                </button>
              </>
            )}
          </div>
        ) : isAvailable ? null : (
          <p>Practice coming soon</p>
        )}
      </div>

      {isAvailable && (
        <div className="access-module-ledger-actions">
          <button
            className="access-page-action access-row-link"
            onClick={(event) => onOpenPurchase({
              intent: "unlock",
              mode: "module",
              moduleSlug: module.subject_slug,
            }, event.currentTarget)}
            type="button"
          >
            Unlock <span aria-hidden="true">&rarr;</span>
          </button>
        </div>
      )}
    </article>
  );
}

function AccessModuleGroup({ entries, label, onOpenPurchase }) {
  if (entries.length === 0) return null;

  return (
    <section className="access-module-group" aria-labelledby={`access-group-${entries[0].group}`}>
      <header className="access-module-group-header">
        <h3 id={`access-group-${entries[0].group}`}>{label}</h3>
      </header>
      <div className="access-module-group-list">
        {entries.map((entry) => (
          <AccessModuleRow entry={entry} key={entry.module.subject_id} onOpenPurchase={onOpenPurchase} />
        ))}
      </div>
    </section>
  );
}

export default function Access() {
  const { profile } = useAuth();
  const {
    catalogError,
    catalogLoading,
    ensurePurchaseCatalog,
    moduleAccess,
    normalizedPlans,
    openPurchase,
  } = usePurchaseModal();
  const [subjects, setSubjects] = useState([]);
  const [payments, setPayments] = useState([]);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [paymentHistoryOpen, setPaymentHistoryOpen] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    async function loadAccess() {
      try {
        const [paymentRows, subjectRows] = await Promise.all([
          getPaymentRecords(),
          getSubjects(),
        ]);
        setPayments(paymentRows);
        setSubjects(subjectRows);
      } catch (loadError) {
        logAppError("Access load", loadError);
        setLoadError(friendlyErrorMessage(loadError, "We could not load your access details. Please try again."));
      } finally {
        setPageLoading(false);
      }
    }

    void ensurePurchaseCatalog();
    void loadAccess();
  }, [ensurePurchaseCatalog]);

  const visibleModules = moduleAccess
    .map((module) => {
      const subject = subjects.find((item) => item.slug === module.subject_slug) ?? module;
      if (!shouldShowCandidateModule({
        canPurchase: module.can_purchase,
        hasModuleAccess: module.has_module_access,
        publishedCount: module.published_batch_count,
        subject,
      })) return null;

      const isComingSoon = isCandidateModuleComingSoon(subject, module.published_batch_count);
      const hasUsableModuleAccess = hasUsableCandidateModuleAccess(
        subject,
        module.published_batch_count,
        module.has_module_access,
      );
      const group = isComingSoon || (!hasUsableModuleAccess && !module.can_purchase)
        ? "coming-soon"
        : hasUsableModuleAccess ? "unlocked" : "available";

      return {
        displayName: getModuleDisplayName(module.subject_name),
        group,
        module,
      };
    })
    .filter(Boolean);
  const unlockedModules = visibleModules.filter((entry) => entry.group === "unlocked");
  const availableModules = visibleModules.filter((entry) => entry.group === "available");
  const comingSoonModules = visibleModules.filter((entry) => entry.group === "coming-soon");
  const { attention: paymentAttention, history: paymentHistory } = partitionPaymentRecords(payments);
  const pickThreePlan = findPlan(normalizedPlans, PRICING_PLAN_CODES.THREE_MODULE_BUNDLE);
  const completePlan = findPlan(normalizedPlans, PRICING_PLAN_CODES.COMPLETE_BUNDLE);
  const pickThreeCount = getRequiredModuleCount(pickThreePlan);
  const pickThreeLowest = getLowestDuration(pickThreePlan);
  const completeLowest = getLowestDuration(completePlan);
  const canPickThree = Boolean(pickThreePlan?.is_available !== false && pickThreePlan?.durations?.length);
  const canComplete = Boolean(completePlan?.is_available !== false && completePlan?.durations?.length);
  const unlockedCount = unlockedModules.length;
  const moduleStateSummary = [
    unlockedModules.length > 0 ? `${unlockedModules.length} active` : "",
    availableModules.length > 0 ? `${availableModules.length} available` : "",
    comingSoonModules.length > 0 ? `${comingSoonModules.length} coming soon` : "",
  ].filter(Boolean).join(" · ");

  if (pageLoading || catalogLoading) {
    return (
      <AppFrame showBottomNav={false}>
        <LoadingState />
      </AppFrame>
    );
  }

  if (loadError || catalogError) {
    return (
      <AppFrame showBottomNav={false}>
        <section className="access-page access-page-v4">
          <article className="state-card">
            <h1>Access details unavailable</h1>
            <p role="alert">{loadError || catalogError}</p>
            <div className="hero-actions">
              <button onClick={() => window.location.reload()} type="button">Try again</button>
              <Link className="secondary-action" to="/dashboard">Back to dashboard</Link>
            </div>
          </article>
        </section>
      </AppFrame>
    );
  }

  return (
    <AppFrame>
      <section className="access-page access-page-v4">
        <header className="access-page-header">
          <h1>Access and payment</h1>
          <p>{`${unlockedCount} active of ${visibleModules.length}`}</p>
        </header>

        {paymentAttention.length > 0 && (
          <section className="access-payment-attention" aria-labelledby="payment-attention-title">
            <header>
              <h2 id="payment-attention-title">Payment needs attention</h2>
            </header>
            <div className="access-payment-list">
              {paymentAttention.map((payment) => {
                const statusMeta = getPaymentStatusMeta(payment);
                return (
                  <article
                    className="access-payment-row is-attention"
                    data-floating-support-avoid="true"
                    key={payment.id}
                  >
                    <div className="access-payment-main">
                      <div className="access-payment-title-line">
                        <strong>{getPaymentAccessName(payment)}</strong>
                        <span className={`access-payment-status is-${statusMeta.tone}`}>{statusMeta.label}</span>
                      </div>
                      <span>{`${formatModuleMoney(payment.amount_kobo, payment.currency)} - ${formatProductDate(payment.paid_at || payment.created_at)}`}</span>
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

        {(canPickThree || canComplete) && (
          <section className="access-page-section access-offers" aria-labelledby="access-bundle-title">
            <h2 id="access-bundle-title">Bundle options</h2>
            <div className="access-offer-list">
              {canPickThree && (
                <article
                  className="access-offer"
                  data-floating-support-avoid="true"
                  id="access-bundle-pick3"
                >
                  <div className="access-offer-main">
                    <div className="access-offer-copy">
                      <h3>{getPlanDisplayName(pickThreePlan, `Pick any ${pickThreeCount} modules`)}</h3>
                      <p>{`Choose any ${pickThreeCount} currently available modules`}</p>
                    </div>
                    <div className="access-offer-action">
                      {pickThreeLowest && <span>{`From ${formatModuleMoney(pickThreeLowest.price_kobo, pickThreeLowest.currency)}`}</span>}
                      <button
                        className="access-row-link"
                        onClick={(event) => openPurchase({ mode: "pick3" }, event.currentTarget)}
                        type="button"
                      >
                        Choose modules <span aria-hidden="true">&rarr;</span>
                      </button>
                    </div>
                  </div>
                </article>
              )}

              {canComplete && (
                <article
                  className="access-offer"
                  data-floating-support-avoid="true"
                  id="access-bundle-complete"
                >
                  <div className="access-offer-main">
                    <div className="access-offer-copy">
                      <h3>{getPlanDisplayName(completePlan, "Complete bundle")}</h3>
                      <p>{`Access all ${completePlan.current_available_module_count} currently available modules`}</p>
                    </div>
                    <div className="access-offer-action">
                      {completeLowest && <span>{`From ${formatModuleMoney(completeLowest.price_kobo, completeLowest.currency)}`}</span>}
                      <button
                        className="access-row-link"
                        onClick={(event) => openPurchase({ mode: "complete" }, event.currentTarget)}
                        type="button"
                      >
                        View access options <span aria-hidden="true">&rarr;</span>
                      </button>
                    </div>
                  </div>
                </article>
              )}
            </div>
          </section>
        )}

        <section className="access-page-section access-modules-section" aria-labelledby="access-modules-title">
          <header className="access-modules-heading">
            <h2 id="access-modules-title">Your modules</h2>
            {moduleStateSummary && <p>{moduleStateSummary}</p>}
          </header>
          {visibleModules.length === 0 ? (
            <p className="access-page-empty">No modules are available yet.</p>
          ) : (
            <div className="access-module-groups">
              <AccessModuleGroup entries={unlockedModules} label="Active" onOpenPurchase={openPurchase} />
              <AccessModuleGroup entries={availableModules} label="Available" onOpenPurchase={openPurchase} />
              <AccessModuleGroup entries={comingSoonModules} label="Coming soon" onOpenPurchase={openPurchase} />
            </div>
          )}
        </section>

        <section className="access-page-section access-history-section" aria-labelledby="access-history-title">
          <details
            className="access-payment-section"
            onToggle={(event) => setPaymentHistoryOpen(event.currentTarget.open)}
          >
            <summary data-floating-support-avoid="true">
              <h2 id="access-history-title">Payment history</h2>
              {paymentHistory.length > 0 && <small>{paymentHistory.length}</small>}
              <span className="access-history-disclosure" aria-hidden="true">
                {paymentHistoryOpen ? "Hide" : "Show"} <span>&rarr;</span>
              </span>
            </summary>
            {paymentHistory.length === 0 ? (
              <p className="access-payment-empty">No payments yet.</p>
            ) : (
              <div className="access-payment-list">
                {paymentHistory.map((payment) => (
                  (() => {
                    const statusMeta = getPaymentStatusMeta(payment);
                    return (
                      <article
                        className={`access-payment-row ${statusMeta.canViewReceipt ? "is-verified" : ""}`}
                        data-floating-support-avoid="true"
                        key={payment.id}
                      >
                        <div className="access-payment-main">
                          <div className="access-payment-title-line">
                            <strong>{getPaymentAccessName(payment)}</strong>
                            <span className={`access-payment-status is-${statusMeta.tone}`}>{statusMeta.label}</span>
                          </div>
                          <span>{`${formatModuleMoney(payment.amount_kobo, payment.currency)} - ${formatProductDate(payment.paid_at || payment.created_at)}`}</span>
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
            )}
          </details>
        </section>
      </section>

      {selectedReceipt && (
        <ReceiptModal payment={selectedReceipt} profile={profile} onClose={() => setSelectedReceipt(null)} />
      )}
    </AppFrame>
  );
}
