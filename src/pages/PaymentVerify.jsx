import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { verifyPayment } from "../lib/appApi";

export default function PaymentVerify() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState("Checking your payment...");
  const [verified, setVerified] = useState(false);
  const reference = searchParams.get("reference") ?? searchParams.get("trxref");

  useEffect(() => {
    async function verify() {
      if (!reference) {
        setStatus("No payment reference was found in the return link.");
        return;
      }

      try {
        await verifyPayment(reference);
        setVerified(true);
        setStatus("Payment confirmed. Full access is now active on your account.");
      } catch (error) {
        logAppError("Payment verification", error);
        setStatus(
          friendlyErrorMessage(error, "We could not confirm payment yet. Please try again shortly."),
        );
      }
    }

    void verify();
  }, [reference]);

  return (
    <main className="state-shell">
      <section className="state-card">
        <p className="eyebrow">Payment check</p>
        <h1>{verified ? "Access unlocked" : "Verifying payment"}</h1>
        <p>{status}</p>
        <Link className="primary-action" to={verified ? "/dashboard" : "/access"}>
          {verified ? "Go to dashboard" : "Return to access"}
        </Link>
      </section>
    </main>
  );
}
