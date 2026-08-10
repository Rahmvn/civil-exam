import { useEffect, useRef } from "react";
import { DurationSelector } from "../access/DurationSelector";
import { ModuleSelector } from "./ModuleSelector";
import { getModuleDisplayName } from "../../lib/moduleDisplay";
import { formatModuleMoney } from "../../lib/pricing";
import { getDurationLabel, getModuleSlug } from "../../lib/pricingPlans";
import "./PurchaseModal.css";

function getPlanName(plan, fallback) {
  return String(plan?.display_name || fallback).trim();
}

function getModuleName(module) {
  return getModuleDisplayName(module?.subject_name ?? module?.name ?? "Module");
}

function getModalTitle(purchase, step) {
  if (purchase.mode === "pick3") return step === "review" ? "Choose access period" : "Choose modules";
  if (step === "review" && purchase.mode !== "pick3") return purchase.intent === "extension" ? "Review extension" : "Review purchase";
  if (purchase.mode === "complete") return "Choose access period";
  if (purchase.mode === "module") {
    return purchase.intent === "extension"
      ? `Extend ${getModuleName(purchase.module)} access`
      : getModuleName(purchase.module);
  }
  return getPlanName(purchase.plan, purchase.mode === "pick3" ? "Pick 3" : "Complete");
}

function CompleteConfiguration({ disabled, durationMonths, idPrefix, onSelectDuration, plan }) {
  return (
    <section className="purchase-complete-configure" aria-label="Complete bundle access period">
      <div className="purchase-complete-configure__context">
        <h3>{getPlanName(plan, "Complete Module Bundle")}</h3>
        <p>{`Includes all ${plan.current_available_module_count} currently available modules.`}</p>
      </div>
      <DurationSelector
        disabled={disabled}
        idPrefix={idPrefix}
        legend="Choose access period"
        onChange={onSelectDuration}
        plan={plan}
        value={durationMonths}
      />
    </section>
  );
}

function SelectedModuleList({ selectedModules }) {
  return (
    <ul>
      {selectedModules.map((module) => (
        <li key={getModuleSlug(module)}>
          <span aria-hidden="true">&#10003;</span>
          <span>{getModuleName(module)}</span>
        </li>
      ))}
    </ul>
  );
}

function formatAccessDate(value, month = "short") {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month,
    year: "numeric",
  }).format(date);
}

function PurchaseReview({ changingDisabled, duration, durationMonths, onChange, purchase }) {
  const purchaseName = purchase.mode === "module"
    ? getModuleName(purchase.module)
    : getPlanName(purchase.plan, purchase.mode === "pick3" ? "Pick 3" : "Complete");
  const currentAccessUntil = purchase.intent === "extension"
    ? formatAccessDate(purchase.module?.access_expires_at)
    : "";

  return (
    <section className={`purchase-modal-review${purchase.mode === "complete" ? " purchase-modal-review--complete" : ""}`} aria-label="Purchase details">
      <h3>{purchaseName}</h3>
      <dl className="purchase-modal-review__details">
        {purchase.mode === "complete" && (
          <div>
            <dt>Includes</dt>
            <dd>{`${purchase.plan.current_available_module_count} modules`}</dd>
          </div>
        )}
        {currentAccessUntil && (
          <div>
            <dt>Current access</dt>
            <dd>{`Until ${currentAccessUntil}`}</dd>
          </div>
        )}
        <div>
          <dt>{purchase.intent === "extension" ? "Extension" : "Access duration"}</dt>
          <dd>{getDurationLabel(durationMonths)}</dd>
        </div>
        <div className="purchase-modal-review__total">
          <dt>Total</dt>
          <dd>{formatModuleMoney(duration.price_kobo, duration.currency)}</dd>
        </div>
      </dl>
      <button className="purchase-modal__change ghost-button" disabled={changingDisabled} onClick={onChange} type="button">
        <span aria-hidden="true">&larr;</span> Change
      </button>
    </section>
  );
}

function Pick3Confirmation({
  disabled,
  durationMonths,
  idPrefix,
  onChange,
  onSelectDuration,
  plan,
  purchaseName,
  selectedModules,
}) {
  return (
    <section className="purchase-pick3-confirmation" aria-label="Bundle confirmation">
      <p className="purchase-pick3-confirmation__product">{purchaseName}</p>
      <div className="purchase-modal-review__modules">
        <div className="purchase-modal-review__modules-heading">
          <p className="purchase-modal-review__modules-label">Selected modules</p>
          <span>{`${selectedModules.length} selected`}</span>
        </div>
        <SelectedModuleList selectedModules={selectedModules} />
      </div>
      <button className="purchase-pick3-confirmation__change ghost-button" disabled={disabled} onClick={onChange} type="button">
        Change selection <span aria-hidden="true">&rarr;</span>
      </button>
      <DurationSelector
        disabled={disabled}
        idPrefix={idPrefix}
        legend="Access period"
        onChange={onSelectDuration}
        plan={plan}
        value={durationMonths}
      />
    </section>
  );
}

export function PurchaseModal({
  activePurchase,
  checkoutPayload,
  duration,
  durationMonths,
  moduleOptions,
  onChange,
  onClose,
  onReview,
  onSelectDuration,
  onStartPayment,
  onToggleModule,
  paymentAttempt,
  paymentError,
  requiredModuleCount,
  selectedSlugs,
  step,
  validation,
}) {
  const dialogRef = useRef(null);
  const headingRef = useRef(null);
  const paymentAttemptRef = useRef(paymentAttempt);
  const dragRef = useRef({
    pointerId: null,
    startY: 0,
    lastY: 0,
    lastTime: 0,
    offsetY: 0,
    velocityY: 0,
  });
  const dismissTimerRef = useRef(null);

  useEffect(() => {
    paymentAttemptRef.current = paymentAttempt;
  }, [paymentAttempt]);

  useEffect(() => {
    if (!activePurchase) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event) {
      if (event.key === "Escape" && !paymentAttemptRef.current) {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [])].filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activePurchase, onClose]);

  useEffect(() => {
    if (!activePurchase) return undefined;
    const frameId = window.requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frameId);
  }, [activePurchase, step]);

  useEffect(() => () => {
    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
  }, []);

  function isMobilePurchaseSheet() {
    return window.matchMedia("(max-width: 680px)").matches;
  }

  function setDragOffset(offsetY) {
    dialogRef.current?.style.setProperty("--purchase-modal-drag-y", `${Math.max(0, offsetY)}px`);
  }

  function resetDragState() {
    dragRef.current = {
      pointerId: null,
      startY: 0,
      lastY: 0,
      lastTime: 0,
      offsetY: 0,
      velocityY: 0,
    };
  }

  function snapPurchaseSheetBack() {
    dialogRef.current?.classList.remove("is-dragging", "is-dismissing");
    setDragOffset(0);
    resetDragState();
  }

  function dismissPurchaseSheet() {
    const sheet = dialogRef.current;
    resetDragState();

    if (!sheet || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onClose();
      return;
    }

    sheet.classList.remove("is-dragging");
    sheet.classList.add("is-dismissing");
    const dismissDistance = Math.max(window.innerHeight, sheet.getBoundingClientRect().height + 48);
    setDragOffset(dismissDistance);

    if (dismissTimerRef.current) window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = window.setTimeout(() => {
      dismissTimerRef.current = null;
      onClose();
    }, 190);
  }

  function handleSheetPointerDown(event) {
    if (paymentAttempt || !isMobilePurchaseSheet() || !event.isPrimary) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;

    const nestedInteractive = event.target?.closest?.(
      'button, a, input, select, textarea, [role="button"], [contenteditable="true"]',
    );
    if (nestedInteractive && nestedInteractive !== event.currentTarget) return;

    const now = performance.now();
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: now,
      offsetY: 0,
      velocityY: 0,
    };

    event.currentTarget.setPointerCapture?.(event.pointerId);
    dialogRef.current?.classList.remove("is-dismissing");
    dialogRef.current?.classList.add("is-dragging");
    setDragOffset(0);
    event.preventDefault();
  }

  function handleSheetPointerMove(event) {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;

    const now = performance.now();
    const elapsed = Math.max(now - drag.lastTime, 1);
    const delta = event.clientY - drag.lastY;
    const nextOffset = Math.max(0, event.clientY - drag.startY);

    drag.velocityY = delta / elapsed;
    drag.lastY = event.clientY;
    drag.lastTime = now;
    drag.offsetY = nextOffset;
    setDragOffset(nextOffset);
    event.preventDefault();
  }

  function handleSheetPointerEnd(event) {
    const drag = dragRef.current;
    if (drag.pointerId !== event.pointerId) return;

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const sheetHeight = dialogRef.current?.getBoundingClientRect().height ?? 0;
    const distanceThreshold = Math.min(180, Math.max(96, sheetHeight * 0.22));
    const isFastDownwardFlick = drag.offsetY >= 36 && drag.velocityY >= 0.7;
    const shouldDismiss = drag.offsetY >= distanceThreshold || isFastDownwardFlick;

    if (shouldDismiss) dismissPurchaseSheet();
    else snapPurchaseSheetBack();
  }

  function handleSheetPointerCancel(event) {
    if (dragRef.current.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    snapPurchaseSheetBack();
  }

  function handleGrabberClick(event) {
    // Pointer taps are intentionally inert. Keyboard/assistive activation still
    // provides a reliable close action for users who cannot perform a drag.
    if (event.detail === 0 && !paymentAttempt) onClose();
  }

  if (!activePurchase) return null;

  const isPick3 = activePurchase.mode === "pick3";
  const selectionComplete = activePurchase.mode !== "pick3" || selectedSlugs.length === requiredModuleCount;
  const remainingCount = Math.max(requiredModuleCount - selectedSlugs.length, 0);
  const selectedModules = moduleOptions.filter((module) => selectedSlugs.includes(getModuleSlug(module)));
  const durationLegend = activePurchase.intent === "extension"
    ? "Choose how long you want to extend access"
    : "Choose how long you want access";
  const durationStatus = duration
    ? `${getDurationLabel(durationMonths)} ${activePurchase.intent === "extension" ? "extension" : "access"}`
    : "";
  const title = getModalTitle(activePurchase, step);
  const currentAccessEnds = activePurchase.intent === "extension"
    ? formatAccessDate(activePurchase.module?.access_expires_at, "long")
    : "";
  const configureAction = activePurchase.intent === "extension" ? "Review extension" : "Review purchase";
  const pick3SelectionStatus = selectionComplete
    ? `${requiredModuleCount} modules selected. Deselect one to choose another.`
    : selectedSlugs.length === 0
      ? `Select ${requiredModuleCount} modules to continue.`
      : `Select ${remainingCount} more module${remainingCount === 1 ? "" : "s"}.`;
  const showFooter = isPick3 || step === "review" || selectionComplete;
  const primaryDisabled = Boolean(paymentAttempt) || (step === "configure"
    ? isPick3 ? !selectionComplete : !checkoutPayload
    : !checkoutPayload || !validation.ok);

  return (
    <div className="purchase-modal-backdrop" onClick={paymentAttempt ? undefined : onClose} role="presentation">
      <section
        aria-labelledby="purchase-modal-title"
        aria-modal="true"
        className={`purchase-modal purchase-modal--${activePurchase.mode}${step === "review" ? " is-review" : " is-configure"}${paymentAttempt ? " is-paying" : ""}${isPick3 && moduleOptions.length > 6 ? " has-many-modules" : ""}`}
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
      >
        <button
          aria-label="Drag down to close purchase"
          className="purchase-modal__handle"
          disabled={Boolean(paymentAttempt)}
          onClick={handleGrabberClick}
          onPointerCancel={handleSheetPointerCancel}
          onPointerDown={handleSheetPointerDown}
          onPointerMove={handleSheetPointerMove}
          onPointerUp={handleSheetPointerEnd}
          type="button"
        />
        <header
          className="purchase-modal__header"
          onPointerCancel={handleSheetPointerCancel}
          onPointerDown={handleSheetPointerDown}
          onPointerMove={handleSheetPointerMove}
          onPointerUp={handleSheetPointerEnd}
        >
          <h2 id="purchase-modal-title" ref={headingRef} tabIndex="-1">{title}</h2>
          <button aria-label="Close purchase" className="purchase-modal__close" disabled={Boolean(paymentAttempt)} onClick={onClose} type="button">&times;</button>
        </header>

        <div className="purchase-modal__body">
          <div className="purchase-modal__stage" key={step}>
          {step === "review" ? (
            isPick3 ? (
              <Pick3Confirmation
                disabled={Boolean(paymentAttempt)}
                durationMonths={durationMonths}
                idPrefix={activePurchase.key.replace(/[^a-z0-9-]/gi, "-")}
                onChange={onChange}
                onSelectDuration={onSelectDuration}
                plan={activePurchase.plan}
                purchaseName={getPlanName(activePurchase.plan, "Pick 3")}
                selectedModules={selectedModules}
              />
            ) : (
              <PurchaseReview
                changingDisabled={Boolean(paymentAttempt)}
                duration={duration}
                durationMonths={durationMonths}
                onChange={onChange}
                purchase={activePurchase}
              />
            )
          ) : (
            <>
              {currentAccessEnds && activePurchase.mode === "module" && (
                <p className="purchase-modal__context">{`Current access ends ${currentAccessEnds}`}</p>
              )}
              {activePurchase.mode === "pick3" && (
                <ModuleSelector
                  contextLabel={getPlanName(activePurchase.plan, "Pick 3")}
                  disabled={Boolean(paymentAttempt)}
                  modules={moduleOptions}
                  onToggle={onToggleModule}
                  requiredCount={requiredModuleCount}
                  selectedSlugs={selectedSlugs}
                />
              )}
              {activePurchase.mode === "complete" && (
                <CompleteConfiguration
                  disabled={Boolean(paymentAttempt)}
                  durationMonths={durationMonths}
                  idPrefix={activePurchase.key.replace(/[^a-z0-9-]/gi, "-")}
                  onSelectDuration={onSelectDuration}
                  plan={activePurchase.plan}
                />
              )}
              {activePurchase.mode === "module" && selectionComplete && (
                <DurationSelector
                  disabled={Boolean(paymentAttempt)}
                  idPrefix={activePurchase.key.replace(/[^a-z0-9-]/gi, "-")}
                  legend={durationLegend}
                  onChange={onSelectDuration}
                  plan={activePurchase.plan}
                  value={durationMonths}
                />
              )}
            </>
          )}
          </div>
        </div>

        {showFooter && (
          <footer className="purchase-modal__footer">
            {isPick3 && step === "review" && duration && (
              <dl className="purchase-modal-review__details purchase-modal__footer-total">
                <div className="purchase-modal-review__total">
                  <dt>Total</dt>
                  <dd>{formatModuleMoney(duration.price_kobo, duration.currency)}</dd>
                </div>
              </dl>
            )}
            {paymentError && <p className="action-error" role="alert">{paymentError}</p>}
            {(step === "configure" || (isPick3 && !duration)) && (
              <p className="purchase-modal__status" aria-live="polite">
                {isPick3 && step === "configure"
                  ? pick3SelectionStatus
                  : duration
                    ? isPick3
                      ? ""
                      : <>{durationStatus} <span aria-hidden="true">&middot;</span> {formatModuleMoney(duration.price_kobo, duration.currency)}</>
                    : "Choose a duration to continue."}
              </p>
            )}
            <button
              aria-busy={Boolean(paymentAttempt)}
              className="purchase-modal__primary bundle-checkout-pay"
              disabled={primaryDisabled}
              onClick={step === "configure" ? onReview : onStartPayment}
              type="button"
            >
              {paymentAttempt
                ? "Preparing payment..."
                : step === "review"
                  ? "Continue to payment"
                  : isPick3
                    ? (
                      <span className="purchase-modal__primary-label">
                        Continue
                        {selectionComplete && <span aria-hidden="true">&rarr;</span>}
                      </span>
                    )
                  : (
                    <span className="purchase-modal__primary-label">
                      {configureAction}
                      {checkoutPayload && <span aria-hidden="true">&rarr;</span>}
                    </span>
                  )}
            </button>
          </footer>
        )}
      </section>
    </div>
  );
}
