import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { verifyPayment } from "../lib/appApi";
import { logAppError, PROBLEM_CODES, resolveAppProblem } from "../lib/errors";
import { getPaymentVerificationCopy } from "../lib/paymentDisplay";
import { getSafeReturnTo } from "../lib/navigation";
import { WhatsAppSupportButton } from "../components/WhatsAppSupportButton";

function getReturnActionLabel(path) {
  const pathname = String(path ?? "").split(/[?#]/, 1)[0];
  if (pathname === "/access") return "Return to access";
  if (pathname === "/dashboard") return "Return to dashboard";
  if (pathname === "/practice" || pathname.startsWith("/practice/") || pathname.startsWith("/oral-practice/")) {
    return "Continue practice";
  }
  if (pathname.startsWith("/modules/")) return "Return to module";
  return "Continue";
}

export default function PaymentVerify() {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference") ?? searchParams.get("trxref");
  const requestedReturnTo = getSafeReturnTo(searchParams.get("returnTo"), "");
  const [verificationRun, setVerificationRun] = useState(0);
  const [state, setState] = useState(reference ? "checking" : "missing");
  const [moduleSlug, setModuleSlug] = useState("");
  const [successHeading, setSuccessHeading] = useState("Access unlocked");
  const [returnTo, setReturnTo] = useState(requestedReturnTo);
  const [message, setMessage] = useState(
    reference ? "We are confirming your payment with Paystack." : "No payment reference was found in this return link.",
  );

  useEffect(() => {
    if (!reference) return undefined;
    let active = true;

    async function verify() {
      setState("checking");
      setMessage("We are confirming your payment with Paystack.");

      try {
        const result = await verifyPayment(reference);
        if (!active) return;
        const storedReturnTo = getSafeReturnTo(window.sessionStorage?.getItem("promotionsure:payment:returnTo"), "");
        const payment = result?.payment;
        const copy = getPaymentVerificationCopy(payment, result);
        const firstItem = Array.isArray(payment?.items) ? payment.items[0] : null;
        setState("success");
        setSuccessHeading(copy.heading);
        setModuleSlug(
          Number(payment?.item_count) === 1
            ? payment?.items?.[0]?.subject_slug ?? result?.subject_slug ?? ""
            : payment
              ? ""
              : result?.subject_slug ?? firstItem?.subject_slug ?? "",
        );
        setReturnTo(requestedReturnTo || storedReturnTo);
        window.sessionStorage?.removeItem("promotionsure:payment:returnTo");
        setMessage(copy.message);
      } catch (error) {
        if (!active) return;
        logAppError("Payment verification", error);
        const problem = resolveAppProblem(error, {
          fallback: "Your payment has not been confirmed yet. You can check again shortly.",
        });
        setState(problem.code === PROBLEM_CODES.PAYMENT_ACCESS_ISSUE ? "access-issue" : "unconfirmed");
        setMessage(problem.message);
      }
    }

    void verify();
    return () => {
      active = false;
    };
  }, [reference, requestedReturnTo, verificationRun]);

  const heading = state === "success"
    ? successHeading
    : state === "missing"
      ? "Payment reference missing"
      : state === "access-issue"
        ? "Payment received — access needs attention"
      : state === "unconfirmed"
        ? "Payment not confirmed yet"
        : "Checking your payment";
  const continuePath = moduleSlug
    ? returnTo || `/modules/${encodeURIComponent(moduleSlug)}`
    : returnTo || "/dashboard#modules";
  const continueLabel = getReturnActionLabel(continuePath);

  return (
    <main className="state-shell payment-verification-page">
      <section className={`state-card payment-verification-card is-${state}`}>
        <div className="payment-verification-mark" aria-hidden="true" />
        <h1>{heading}</h1>
        <p>{message}</p>
        {reference && (
          <div className="payment-verification-reference">
            <span>Payment reference</span>
            <code>{reference}</code>
          </div>
        )}

        <div className="payment-verification-actions">
          {state === "success" ? (
            <>
              <Link className="primary-action" replace to={continuePath}>{continueLabel}</Link>
              <Link className="secondary-action" replace to="/access">View access</Link>
            </>
          ) : state === "unconfirmed" || state === "access-issue" ? (
            <>
              <button className="primary-action" onClick={() => setVerificationRun((value) => value + 1)} type="button">Check again</button>
              {state === "access-issue" ? (
                <Link
                  className="secondary-action"
                  to={`/help?category=payment&reference=${encodeURIComponent(reference)}`}
                >Get payment help</Link>
              ) : (
                <Link className="secondary-action" to="/access">Return to access</Link>
              )}
            </>
          ) : state === "missing" ? (
            <Link className="primary-action" to="/access">Return to access</Link>
          ) : (
            <button className="primary-action" disabled type="button">Checking...</button>
          )}
        </div>
      </section>
      <WhatsAppSupportButton />
    </main>
  );
}
