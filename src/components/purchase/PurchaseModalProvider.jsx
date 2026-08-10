import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  getModuleAccessCatalog,
  getPurchasePricingCatalog,
  initializePricingPlanPayment,
} from "../../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../../lib/errors";
import { buildLocationPath, getSafeReturnTo } from "../../lib/navigation";
import {
  PRICING_PLAN_CODES,
  buildPlanCheckoutPayload,
  chooseDefaultDuration,
  findPlan,
  getDurationPrice,
  getEligibleModules,
  getIndividualPlanCodeForModule,
  getModuleSlug,
  getRequiredModuleCount,
  normalizePricingCatalog,
  validatePlanSelection,
} from "../../lib/pricingPlans";
import { PurchaseModalContext } from "./PurchaseModalContext";
import { PurchaseModalHost } from "./PurchaseModalHost";

function getAccessRequest(location) {
  if (location.pathname !== "/access") return null;
  const params = new URLSearchParams(location.search);
  const moduleSlug = params.get("module")?.trim() ?? "";
  const scope = params.get("scope")?.trim() ?? "";
  const returnTo = getSafeReturnTo(params.get("returnTo"), "/access");
  if (moduleSlug) return { mode: "module", moduleSlug, returnTo };
  if (scope === "pick3" || scope === "complete") return { mode: scope, returnTo };
  return null;
}

function getHistoryRequest(location) {
  if (location.pathname === "/access") return null;
  const request = location.state?.purchaseModal;
  if (!request || !["module", "pick3", "complete"].includes(request.mode)) return null;
  return {
    intent: request.intent === "extension" ? "extension" : "unlock",
    mode: request.mode,
    moduleSlug: String(request.moduleSlug ?? ""),
    returnTo: getSafeReturnTo(request.returnTo, buildLocationPath(location)),
  };
}

function resolvePurchaseTarget(request, moduleAccess, plans) {
  if (!request) return null;

  if (request.mode === "module") {
    const module = moduleAccess.find((item) => getModuleSlug(item) === request.moduleSlug && item.can_purchase);
    if (!module) return null;
    const plan = findPlan(plans, getIndividualPlanCodeForModule(module));
    if (!plan?.durations?.length || plan.is_available === false) return null;
    const intent = module.has_module_access ? "extension" : "unlock";
    return {
      intent,
      key: `module:${request.moduleSlug}`,
      mode: "module",
      module,
      plan,
      returnTo: request.returnTo,
    };
  }

  const planCode = request.mode === "pick3"
    ? PRICING_PLAN_CODES.THREE_MODULE_BUNDLE
    : PRICING_PLAN_CODES.COMPLETE_BUNDLE;
  const plan = findPlan(plans, planCode);
  if (!plan?.durations?.length || plan.is_available === false) return null;
  return {
    intent: "unlock",
    key: `bundle:${request.mode}`,
    mode: request.mode,
    module: null,
    plan,
    returnTo: request.returnTo,
  };
}

export function PurchaseModalProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [moduleAccess, setModuleAccess] = useState([]);
  const [pricingCatalog, setPricingCatalog] = useState([]);
  const [catalogState, setCatalogState] = useState("idle");
  const [catalogError, setCatalogError] = useState("");
  const [step, setStep] = useState("configure");
  const [durationSelection, setDurationSelection] = useState({ target: "", months: null });
  const [bundleSelectedSlugs, setBundleSelectedSlugs] = useState([]);
  const [paymentAttempt, setPaymentAttempt] = useState(null);
  const [paymentError, setPaymentError] = useState(null);
  const catalogRequestRef = useRef(null);
  const catalogStateRef = useRef("idle");
  const paymentStartGuardRef = useRef(false);
  const triggerRef = useRef(null);
  const previousTargetRef = useRef("");

  const normalizedPlans = useMemo(() => normalizePricingCatalog(pricingCatalog), [pricingCatalog]);
  const routeRequest = useMemo(() => getAccessRequest(location) ?? getHistoryRequest(location), [location]);
  const activePurchase = catalogState === "ready"
    ? resolvePurchaseTarget(routeRequest, moduleAccess, normalizedPlans)
    : null;
  const activeTarget = activePurchase?.key ?? "";
  const durationMonths = durationSelection.target === activeTarget ? durationSelection.months : null;
  const purchasableModules = useMemo(() => getEligibleModules(moduleAccess), [moduleAccess]);
  const purchasableSlugSet = useMemo(() => new Set(purchasableModules.map(getModuleSlug)), [purchasableModules]);
  const selectedSlugs = activePurchase?.mode === "pick3"
    ? bundleSelectedSlugs.filter((slug) => purchasableSlugSet.has(slug))
    : activePurchase?.mode === "module" ? [getModuleSlug(activePurchase.module)] : [];
  const requiredModuleCount = activePurchase ? getRequiredModuleCount(activePurchase.plan) : 0;
  const safeDuration = activePurchase && durationMonths
    ? chooseDefaultDuration(activePurchase.plan, durationMonths)
    : null;
  const duration = activePurchase && safeDuration
    ? getDurationPrice(activePurchase.plan, safeDuration)
    : null;
  const validation = activePurchase
    ? validatePlanSelection({ plan: activePurchase.plan, selectedSlugs })
    : { ok: false, message: "Choose an access plan" };
  const checkoutPayload = activePurchase && duration && validation.ok
    ? buildPlanCheckoutPayload({
        plan: activePurchase.plan,
        durationMonths: safeDuration,
        selectedSlugs,
      })
    : null;

  const ensurePurchaseCatalog = useCallback(async ({ refresh = false } = {}) => {
    if (!refresh && catalogStateRef.current === "ready") return;
    if (!refresh && catalogRequestRef.current) return catalogRequestRef.current;

    const request = Promise.all([getModuleAccessCatalog(), getPurchasePricingCatalog()])
      .then(([accessRows, pricingRows]) => {
        setModuleAccess(accessRows);
        setPricingCatalog(pricingRows);
        setCatalogError("");
        catalogStateRef.current = "ready";
        setCatalogState("ready");
      })
      .catch((error) => {
        logAppError("Purchase catalog load", error);
        setCatalogError(friendlyErrorMessage(error, "We could not load purchase options right now."));
        catalogStateRef.current = "error";
        setCatalogState("error");
      })
      .finally(() => {
        catalogRequestRef.current = null;
      });

    catalogRequestRef.current = request;
    catalogStateRef.current = "loading";
    setCatalogState("loading");
    return request;
  }, []);

  useEffect(() => {
    if (location.pathname === "/access" || routeRequest) void ensurePurchaseCatalog();
  }, [ensurePurchaseCatalog, location.pathname, routeRequest]);

  useEffect(() => {
    if (previousTargetRef.current === activeTarget) return;
    const previousTarget = previousTargetRef.current;
    previousTargetRef.current = activeTarget;
    setDurationSelection({ target: activeTarget, months: null });
    setPaymentError(null);
    setStep("configure");

    if (previousTarget && !activeTarget) {
      setBundleSelectedSlugs([]);
      const trigger = triggerRef.current;
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      });
    }
  }, [activeTarget]);

  const openPurchase = useCallback((request, trigger = document.activeElement) => {
    const mode = ["module", "pick3", "complete"].includes(request?.mode) ? request.mode : "";
    if (!mode || (mode === "module" && !request.moduleSlug)) return;
    triggerRef.current = trigger instanceof HTMLElement ? trigger : document.activeElement;

    const fallbackReturnTo = location.pathname === "/access"
      ? getSafeReturnTo(new URLSearchParams(location.search).get("returnTo"), "/access")
      : buildLocationPath(location);
    const returnTo = getSafeReturnTo(request.returnTo, fallbackReturnTo);
    if (location.pathname === "/access") {
      const params = new URLSearchParams();
      if (mode === "module") params.set("module", request.moduleSlug);
      else params.set("scope", mode);
      if (returnTo !== "/access") params.set("returnTo", returnTo);
      navigate({ pathname: "/access", search: `?${params.toString()}` });
      return;
    }

    const purchaseModal = {
      intent: request.intent === "extension" ? "extension" : "unlock",
      mode,
      moduleSlug: mode === "module" ? request.moduleSlug : "",
      returnTo,
    };
    navigate(buildLocationPath(location), {
      state: { ...(location.state ?? {}), purchaseModal },
    });
  }, [location, navigate]);

  const closePurchase = useCallback(() => {
    if (paymentAttempt) return;
    if (location.pathname !== "/access" && location.state?.purchaseModal) {
      navigate(-1);
      return;
    }

    const params = new URLSearchParams(location.search);
    params.delete("module");
    params.delete("scope");
    const safeReturnTo = getSafeReturnTo(params.get("returnTo"), null);
    const search = safeReturnTo ? `?returnTo=${encodeURIComponent(safeReturnTo)}` : "";
    navigate({ pathname: "/access", search }, { replace: true });
  }, [location, navigate, paymentAttempt]);

  function selectDuration(months) {
    if (!activePurchase || paymentAttempt) return;
    setDurationSelection({ target: activeTarget, months: Number(months) });
    setPaymentError(null);
  }

  function toggleBundleModule(subjectSlug) {
    if (!activePurchase || activePurchase.mode !== "pick3" || paymentAttempt) return;
    setBundleSelectedSlugs((current) => {
      const validCurrent = current.filter((slug) => purchasableSlugSet.has(slug));
      const next = validCurrent.includes(subjectSlug)
        ? validCurrent.filter((slug) => slug !== subjectSlug)
        : validCurrent.length >= requiredModuleCount
          ? validCurrent
          : [...validCurrent, subjectSlug];
      setDurationSelection({ target: activeTarget, months: null });
      return next;
    });
    setPaymentError(null);
  }

  async function startPayment() {
    if (!activePurchase || !checkoutPayload || paymentStartGuardRef.current) return;
    const paymentKey = `pricing:${checkoutPayload.planCode}:${checkoutPayload.durationMonths}:${checkoutPayload.subjectSlugs.join(",")}`;
    paymentStartGuardRef.current = true;
    setPaymentAttempt({ key: paymentKey, target: activeTarget });
    setPaymentError(null);

    try {
      window.sessionStorage?.setItem("promotionsure:payment:returnTo", activePurchase.returnTo);
      const payment = await initializePricingPlanPayment(checkoutPayload);
      if (payment.already_paid) {
        window.location.assign(activePurchase.returnTo);
        return;
      }
      window.location.assign(payment.authorization_url);
    } catch (error) {
      logAppError("Purchase payment start", error);
      setPaymentError({
        attemptKey: paymentKey,
        target: activeTarget,
        message: friendlyErrorMessage(error, "We could not start payment right now. Please try again."),
      });
    } finally {
      paymentStartGuardRef.current = false;
      setPaymentAttempt(null);
    }
  }

  const contextValue = useMemo(() => ({
    catalogError,
    catalogLoading: catalogState === "idle" || catalogState === "loading",
    ensurePurchaseCatalog,
    moduleAccess,
    normalizedPlans,
    openPurchase,
    pricingCatalog,
  }), [catalogError, catalogState, ensurePurchaseCatalog, moduleAccess, normalizedPlans, openPurchase, pricingCatalog]);

  return (
    <PurchaseModalContext.Provider value={contextValue}>
      <div aria-hidden={activePurchase ? "true" : undefined} inert={activePurchase ? true : undefined}>
        {children}
      </div>
      <PurchaseModalHost
        activePurchase={activePurchase}
        checkoutPayload={checkoutPayload}
        duration={duration}
        durationMonths={safeDuration}
        moduleOptions={purchasableModules}
        onChange={() => setStep("configure")}
        onClose={closePurchase}
        onReview={() => setStep("review")}
        onSelectDuration={selectDuration}
        onStartPayment={() => void startPayment()}
        onToggleModule={toggleBundleModule}
        paymentAttempt={paymentAttempt}
        paymentError={paymentError?.target === activeTarget ? paymentError.message : ""}
        requiredModuleCount={requiredModuleCount}
        selectedSlugs={selectedSlugs}
        step={step}
        validation={validation}
      />
    </PurchaseModalContext.Provider>
  );
}
