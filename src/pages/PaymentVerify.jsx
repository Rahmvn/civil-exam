import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { verifyPayment } from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";

export default function PaymentVerify() {
  const [searchParams] = useSearchParams();
  const reference = searchParams.get("reference") ?? searchParams.get("trxref");
  const [verificationRun, setVerificationRun] = useState(0);
  const [state, setState] = useState(reference ? "checking" : "missing");
  const [moduleSlug, setModuleSlug] = useState("");
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
        setState("success");
        setModuleSlug(result?.subject_slug ?? "");
        setMessage(result?.subject_name
          ? `${result.subject_name} is now unlocked.`
          : "Your access is now active.");
      } catch (error) {
        if (!active) return;
        logAppError("Payment verification", error);
        setState("unconfirmed");
        setMessage(friendlyErrorMessage(error, "Your payment has not been confirmed yet. You can check again shortly."));
      }
    }

    void verify();
    return () => {
      active = false;
    };
  }, [reference, verificationRun]);

  const heading = state === "success"
    ? "Access unlocked"
    : state === "missing"
      ? "Payment reference missing"
      : state === "unconfirmed"
        ? "Payment not confirmed yet"
        : "Checking your payment";
  const continuePath = moduleSlug
    ? `/modules/${encodeURIComponent(moduleSlug)}`
    : "/dashboard#modules";

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
              <Link className="primary-action" to={continuePath}>Continue practice</Link>
              <Link className="secondary-action" to="/access">View access</Link>
            </>
          ) : state === "unconfirmed" ? (
            <>
              <button className="primary-action" onClick={() => setVerificationRun((value) => value + 1)} type="button">Check again</button>
              <Link className="secondary-action" to="/access">Return to access</Link>
            </>
          ) : state === "missing" ? (
            <Link className="primary-action" to="/access">Return to access</Link>
          ) : (
            <button className="primary-action" disabled type="button">Checking...</button>
          )}
        </div>
      </section>
    </main>
  );
}
