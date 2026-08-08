import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import { BRAND_DESCRIPTOR, BRAND_NAME } from "../lib/brand";
import {
  getModuleAccessCatalog,
  getPaymentRecords,
  getPurchasePricingCatalog,
  getSubjects,
  initializePricingPlanPayment,
} from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import {
  hasUsableCandidateModuleAccess,
  isCandidateModuleComingSoon,
  getModuleDisplayName,
} from "../lib/moduleDisplay";
import { getPaymentStatusMeta, partitionPaymentRecords } from "../lib/paymentDisplay";
import {
  PRICING_PLAN_CODES,
  buildPlanCheckoutPayload,
  chooseDefaultDuration,
  findPlan,
  getDurationLabel,
  getDurationPrice,
  getEligibleModules,
  getIndividualPlanCodeForModule,
  getModuleSlug,
  getRequiredModuleCount,
  getSavingsAmountKobo,
  getSelectedModules,
  normalizePricingCatalog,
  validatePlanSelection,
} from "../lib/pricingPlans";
import { formatModuleMoney } from "../lib/pricing";
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
  if (payment.purchase_label) return payment.purchase_label;
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

function getDurationBadge(duration) {
  if (duration?.discount_label) return duration.discount_label;
  const savings = getSavingsAmountKobo(duration);
  if (savings > 0) return `Save ${formatModuleMoney(savings, duration.currency)}`;
  return "";
}

function getPlanDisplayName(plan, fallback) {
  return String(plan?.display_name || fallback).trim();
}

function getLowestDuration(plan) {
  return (plan?.durations ?? []).reduce((lowest, duration) => (
    !lowest || Number(duration.price_kobo) < Number(lowest.price_kobo) ? duration : lowest
  ), null);
}

function normalizePurchasableModules(modules) {
  return getEligibleModules(modules).map((module) => ({
    ...module,
    subject_slug: getModuleSlug(module),
  }));
}

function getSafeReturnPath(value) {
  const candidate = String(value ?? "").trim();
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return "";
  if (/[\r\n]/.test(candidate)) return "";
  return candidate;
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
          <div><dt>Access</dt><dd>{accessName}</dd></div>
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedModule = searchParams.get("module");
  const requestedScope = searchParams.get("scope") ?? "";
  const returnTo = getSafeReturnPath(searchParams.get("returnTo"));
  const [moduleAccess, setModuleAccess] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [payments, setPayments] = useState([]);
  const [pricingCatalog, setPricingCatalog] = useState([]);
  const [selectedReceipt, setSelectedReceipt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [payingModule, setPayingModule] = useState("");
  const [loadError, setLoadError] = useState("");
  const [paymentError, setPaymentError] = useState(null);
  const [expandedPurchase, setExpandedPurchase] = useState("");
  const [durationMonths, setDurationMonths] = useState(null);
  const [bundleSelectedSlugs, setBundleSelectedSlugs] = useState([]);

  useEffect(() => {
    async function loadAccess() {
      try {
        const [accessRows, paymentRows, subjectRows, pricingRows] = await Promise.all([
          getModuleAccessCatalog(),
          getPaymentRecords(),
          getSubjects(),
          getPurchasePricingCatalog().catch((error) => {
            logAppError("Pricing catalog load", error);
            return [];
          }),
        ]);
        setModuleAccess(accessRows);
        setPayments(paymentRows);
        setSubjects(subjectRows);
        setPricingCatalog(pricingRows);
      } catch (loadError) {
        logAppError("Access load", loadError);
        setLoadError(friendlyErrorMessage(loadError, "We could not load your access details. Please try again."));
      } finally {
        setLoading(false);
      }
    }

    void loadAccess();
  }, []);

  const modulesToShow = moduleAccess.filter((module) => module.can_purchase || module.has_module_access);
  const { attention: paymentAttention, history: paymentHistory } = partitionPaymentRecords(payments);
  const normalizedPlans = useMemo(() => normalizePricingCatalog(pricingCatalog), [pricingCatalog]);
  const purchasableModules = useMemo(() => normalizePurchasableModules(moduleAccess), [moduleAccess]);
  const purchasableSlugSet = useMemo(() => new Set(purchasableModules.map((module) => module.subject_slug)), [purchasableModules]);
  const pickThreePlan = findPlan(normalizedPlans, PRICING_PLAN_CODES.THREE_MODULE_BUNDLE);
  const completePlan = findPlan(normalizedPlans, PRICING_PLAN_CODES.COMPLETE_BUNDLE);
  const pickThreeCount = getRequiredModuleCount(pickThreePlan) || 3;
  const pickThreeLowest = getLowestDuration(pickThreePlan);
  const completeLowest = getLowestDuration(completePlan);
  const canPickThree = Boolean(pickThreePlan?.is_available !== false && pickThreePlan?.durations?.length);
  const canComplete = Boolean(completePlan?.is_available !== false && completePlan?.durations?.length);
  const routeExpandedPurchase = requestedModule && purchasableSlugSet.has(requestedModule)
    ? `module:${requestedModule}`
    : requestedScope === "pick3" && canPickThree
      ? "bundle:pick3"
      : requestedScope === "complete" && canComplete
        ? "bundle:complete"
        : "";
  const activePurchase = routeExpandedPurchase || expandedPurchase;
  const unlockedCount = modulesToShow.filter((module) => {
    const subject = subjects.find((item) => item.slug === module.subject_slug) ?? module;
    return hasUsableCandidateModuleAccess(subject, module.published_batch_count, module.has_module_access);
  }).length;

  useEffect(() => {
    if (loading || !activePurchase) return;
    const targetId = activePurchase.startsWith("module:")
      ? `access-row-${activePurchase.replace("module:", "")}`
      : activePurchase === "bundle:pick3" ? "access-bundle-pick3" : "access-bundle-complete";
    window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [activePurchase, loading]);

  async function startPricingPlanPayment(paymentRequest) {
    const paymentKey = `pricing:${paymentRequest.planCode}:${paymentRequest.durationMonths}:${paymentRequest.subjectSlugs.join(",")}`;
    if (payingModule) return;
    setPayingModule(paymentKey);
    setPaymentError(null);

    try {
      if (returnTo) {
        window.sessionStorage?.setItem("promotionsure:payment:returnTo", returnTo);
      }
      const payment = await initializePricingPlanPayment(paymentRequest);
      if (payment.already_paid) {
        if (returnTo) {
          navigate(returnTo);
          return;
        }
        window.location.reload();
        return;
      }
      window.location.assign(payment.authorization_url);
    } catch (paymentRequestError) {
      logAppError("Access pricing plan payment start", paymentRequestError);
      setPaymentError({
        subjectSlug: paymentKey,
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
        <section className="access-page access-page-v3">
          <article className="state-card">
            <h1>Access details unavailable</h1>
            <p role="alert">{loadError}</p>
            <div className="hero-actions">
              <button onClick={() => window.location.reload()} type="button">Try again</button>
              <Link className="secondary-action" to="/dashboard">Back to dashboard</Link>
            </div>
          </article>
        </section>
      </AppFrame>
    );
  }

  function openUnlockModule(subjectSlug) {
    setPaymentError(null);
    setDurationMonths(null);
    setExpandedPurchase(`module:${subjectSlug}`);
    setBundleSelectedSlugs([]);
    const nextParams = {};
    if (subjectSlug) nextParams.module = subjectSlug;
    if (returnTo) nextParams.returnTo = returnTo;
    setSearchParams(nextParams);
    document.getElementById(`access-row-${subjectSlug}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const modalPaymentKeyPrefix = "pricing:";
  const purchaseError = paymentError?.subjectSlug?.startsWith(modalPaymentKeyPrefix) ? paymentError.message : "";

  function openBundle(scope) {
    setPaymentError(null);
    setDurationMonths(null);
    setExpandedPurchase(`bundle:${scope}`);
    if (scope === "complete") setBundleSelectedSlugs([]);
    const nextParams = { scope };
    if (returnTo) nextParams.returnTo = returnTo;
    setSearchParams(nextParams);
    window.requestAnimationFrame(() => {
      document.getElementById(`access-bundle-${scope}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function getModulePlan(module) {
    return findPlan(normalizedPlans, getIndividualPlanCodeForModule(module));
  }

  function buildPaymentState({ plan, selectedSlugs }) {
    const safeDuration = durationMonths ? chooseDefaultDuration(plan, durationMonths) : null;
    const duration = safeDuration ? getDurationPrice(plan, safeDuration) : null;
    const validation = validatePlanSelection({ plan, selectedSlugs });
    const payload = duration && validation.ok
      ? buildPlanCheckoutPayload({ plan, durationMonths: safeDuration, selectedSlugs })
      : null;
    return { duration, payload, safeDuration, validation };
  }

  function toggleBundleModule(subjectSlug) {
    if (payingModule) return;
    setBundleSelectedSlugs((current) => {
      const validCurrent = current.filter((slug) => purchasableSlugSet.has(slug));
      if (validCurrent.includes(subjectSlug)) return validCurrent.filter((slug) => slug !== subjectSlug);
      if (validCurrent.length >= pickThreeCount) return validCurrent;
      return [...validCurrent, subjectSlug];
    });
  }

  function renderDurationPicker({ duration, plan, safeDuration }) {
    return (
      <section className="access-choice-group" aria-labelledby="access-duration-title">
        <h3 id="access-duration-title">Choose access duration</h3>
        <div className="access-duration-choices" role="radiogroup" aria-label="Access duration">
          {plan.durations.map((option) => {
            const selected = Number(option.duration_months) === Number(safeDuration);
            const badge = getDurationBadge(option);
            return (
              <button
                aria-checked={selected}
                className={`access-duration-choice${selected ? " is-selected" : ""}`}
                disabled={Boolean(payingModule)}
                key={option.duration_months}
                onClick={() => setDurationMonths(Number(option.duration_months))}
                role="radio"
                type="button"
              >
                <span className="access-choice-radio" aria-hidden="true" />
                <span className="access-choice-label">
                  <strong>{getDurationLabel(option.duration_months)}</strong>
                  {badge && <small>{badge}</small>}
                </span>
                <span className="access-choice-price">{formatModuleMoney(option.price_kobo, option.currency)}</span>
              </button>
            );
          })}
        </div>
        {duration ? null : <p className="access-purchase-prompt">Select a duration to continue.</p>}
      </section>
    );
  }

  function renderPurchaseActions({ payload, validation }) {
    return (
      <>
        {purchaseError && <p className="access-inline-error" role="alert">{purchaseError}</p>}
        <div className="access-purchase-footer">
          {!validation.ok && <p className="access-selection-hint">{validation.message}</p>}
          <button
            aria-busy={Boolean(payingModule)}
            className="access-payment-action"
            disabled={Boolean(payingModule) || !payload}
            onClick={() => void startPricingPlanPayment(payload)}
            type="button"
          >
            {payingModule ? "Preparing payment..." : "Continue to payment"}
          </button>
        </div>
      </>
    );
  }

  function renderInlineModulePurchase(module) {
    const plan = getModulePlan(module);
    if (!plan) return <p className="access-inline-error">This module is not open for purchase yet.</p>;
    const state = buildPaymentState({ plan, selectedSlugs: [module.subject_slug] });
    return (
      <div className="access-row-purchase">
        {renderDurationPicker({ duration: state.duration, plan, safeDuration: state.safeDuration })}
        {renderPurchaseActions({ payload: state.payload, validation: state.validation })}
      </div>
    );
  }

  function renderInlineBundlePurchase({ plan, scope }) {
    if (!plan) return null;
    const isComplete = scope === "complete";
    const selectedSlugs = isComplete ? [] : bundleSelectedSlugs.filter((slug) => purchasableSlugSet.has(slug));
    const selectedModules = getSelectedModules(purchasableModules, selectedSlugs);
    const state = buildPaymentState({ plan, selectedSlugs });
    const selectionLabel = isComplete
      ? `${purchasableModules.length} modules included`
      : `${selectedSlugs.length} of ${pickThreeCount} selected`;

    return (
      <div className="access-row-purchase">
        {!isComplete && (
          <section className="access-bundle-picker" aria-label="Choose bundle modules">
            <div className="access-bundle-picker-heading">
              <h3>Choose modules</h3>
              <span>{selectionLabel}</span>
            </div>
            <div className="access-bundle-choices">
              {purchasableModules.map((module) => {
                const selected = selectedSlugs.includes(module.subject_slug);
                const disabled = !selected && selectedSlugs.length >= pickThreeCount;
                return (
                  <button
                    aria-pressed={selected}
                    className={`access-bundle-choice${selected ? " is-selected" : ""}`}
                    disabled={Boolean(payingModule) || disabled}
                    key={module.subject_id ?? module.subject_slug}
                    onClick={() => toggleBundleModule(module.subject_slug)}
                    type="button"
                  >
                    <span className="access-choice-check" aria-hidden="true" />
                    <span>{getModuleDisplayName(module.subject_name)}</span>
                    {module.practice_type === "oral" && <small>Oral</small>}
                  </button>
                );
              })}
            </div>
          </section>
        )}
        {isComplete && (
          <div className="access-bundle-included">
            <span>{selectionLabel}</span>
            <p>{purchasableModules.map((module) => getModuleDisplayName(module.subject_name)).join(", ")}</p>
          </div>
        )}
        {renderDurationPicker({ duration: state.duration, plan, safeDuration: state.safeDuration })}
        {!isComplete && selectedModules.length > 0 && (
          <p className="access-selection-summary">{selectedModules.map((module) => getModuleDisplayName(module.subject_name)).join(", ")}</p>
        )}
        {renderPurchaseActions({ payload: state.payload, validation: state.validation })}
      </div>
    );
  }

  return (
    <AppFrame>
      <section className="access-page access-page-v3">
        <header className="access-ledger-header">
          <h1>Access and payment</h1>
          {unlockedCount < modulesToShow.length && (
            <p>{`${unlockedCount} of ${modulesToShow.length} modules unlocked.`}</p>
          )}
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

        <section className="access-ledger-section" aria-labelledby="access-modules-title">
          <h2 id="access-modules-title">Your access</h2>
          {modulesToShow.length === 0 ? (
            <article className="access-empty-state">
              <span className="access-empty-kicker">Access status</span>
              <h2>No module is open for purchase yet</h2>
              <p>
                Your account is ready. Available modules will appear here once they are open for sale or assigned to your account.
              </p>
              <Link className="secondary-action" to="/dashboard">Back to dashboard</Link>
            </article>
          ) : (
            <div className="access-ledger-list">
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
                  className={`access-ledger-row ${hasUsableModuleAccess ? "is-unlocked" : "is-locked"} ${activePurchase === `module:${module.subject_slug}` ? "is-expanded is-targeted" : ""}`.trim()}
                  id={`access-row-${module.subject_slug}`}
                  key={module.subject_id}
                >
                  <div className="access-ledger-row-main">
                    <div className="access-ledger-title-line">
                      <h2>{displayName}</h2>
                    </div>
                    {isComingSoon ? (
                      <p>Practice is coming soon.</p>
                    ) : hasUsableModuleAccess ? (
                      <p>{`Active through ${formatDate(module.access_expires_at)}`}</p>
                    ) : module.can_purchase ? (
                      <p>Not currently unlocked</p>
                    ) : (
                      <p>Practice is coming soon.</p>
                    )}
                  </div>

                  <div className="access-ledger-row-action">
                    {isComingSoon ? (
                      <span className="access-module-coming-soon">Not available yet</span>
                    ) : hasUsableModuleAccess ? (
                      <Link className="access-row-link" to={getModulePracticeSetsRoute(module.subject_slug)}>View</Link>
                    ) : module.can_purchase ? (
                      <button className="access-row-link" aria-busy={isPaying} disabled={isPaying} onClick={() => openUnlockModule(module.subject_slug)} type="button">
                        Unlock <span aria-hidden="true">&rarr;</span>
                      </button>
                    ) : null}
                    {paymentError?.subjectSlug === module.subject_slug && (
                      <p className="access-module-error" role="alert">{paymentError.message}</p>
                    )}
                  </div>

                  {activePurchase === `module:${module.subject_slug}` && module.can_purchase && !hasUsableModuleAccess && !isComingSoon && renderInlineModulePurchase(module)}
                </article>
              );
              })}
            </div>
          )}
        </section>

        {(canPickThree || canComplete) && (
          <section className="access-offers" aria-labelledby="access-bundle-title">
            <h2 id="access-bundle-title">Bundle offers</h2>
            <div className="access-offer-list">
              {canPickThree && (
                <article className={`access-offer ${activePurchase === "bundle:pick3" ? "is-expanded is-targeted" : ""}`} id="access-bundle-pick3">
                  <div className="access-offer-main">
                    <div className="access-offer-copy">
                      <h3>{getPlanDisplayName(pickThreePlan, "Pick 3")}</h3>
                      <p>Choose any {pickThreeCount} available modules</p>
                    </div>
                    <div className="access-offer-action">
                      {pickThreeLowest && <span>{`From ${formatModuleMoney(pickThreeLowest.price_kobo, pickThreeLowest.currency)}`}</span>}
                      <button className="access-row-link" onClick={() => openBundle("pick3")} type="button">Pick modules <span aria-hidden="true">&rarr;</span></button>
                    </div>
                  </div>
                  {activePurchase === "bundle:pick3" && renderInlineBundlePurchase({ plan: pickThreePlan, scope: "pick3" })}
                </article>
              )}

              {canComplete && (
                <article className={`access-offer ${activePurchase === "bundle:complete" ? "is-expanded is-targeted" : ""}`} id="access-bundle-complete">
                  <div className="access-offer-main">
                    <div className="access-offer-copy">
                      <h3>{getPlanDisplayName(completePlan, "Complete")}</h3>
                      <p>Unlock all currently available modules</p>
                    </div>
                    <div className="access-offer-action">
                      {completeLowest && <span>{`From ${formatModuleMoney(completeLowest.price_kobo, completeLowest.currency)}`}</span>}
                      <button className="access-row-link" onClick={() => openBundle("complete")} type="button">Unlock all <span aria-hidden="true">&rarr;</span></button>
                    </div>
                  </div>
                  {activePurchase === "bundle:complete" && renderInlineBundlePurchase({ plan: completePlan, scope: "complete" })}
                </article>
              )}
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
    </AppFrame>
  );
}
