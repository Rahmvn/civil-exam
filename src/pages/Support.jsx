import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import { createSupportRequest, getMySupportRequests } from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { findSupportFaqs, SUPPORT_FAQS, SUPPORT_TOPICS } from "../lib/supportKnowledge";

const CATEGORIES = [
  ["account", "Account details or sign-in"],
  ["access", "Module access"],
  ["payment", "Payment"],
  ["practice", "Practice attempt"],
  ["content", "Question or answer content"],
  ["technical", "Technical problem"],
];

const STATUS_LABELS = {
  received: "Received",
  in_review: "In review",
  resolved: "Resolved",
  closed: "Closed",
};

export default function Support() {
  const [searchParams] = useSearchParams();
  const requestedCategory = searchParams.get("category");
  const initialCategory = CATEGORIES.some(([value]) => value === requestedCategory) ? requestedCategory : "access";
  const requestedFaq = searchParams.get("faq");
  const initialFaq = SUPPORT_FAQS.find((item) => item.id === requestedFaq) ?? null;
  const initialPaymentReference = initialCategory === "payment"
    ? String(searchParams.get("reference") ?? "").trim().slice(0, 120)
    : "";
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingError, setLoadingError] = useState("");
  const [category, setCategory] = useState(initialCategory);
  const [subject, setSubject] = useState(initialPaymentReference ? "Payment received but module did not unlock" : "");
  const [description, setDescription] = useState(initialPaymentReference
    ? "My payment was confirmed, but the module access has not been unlocked."
    : "");
  const [paymentReference, setPaymentReference] = useState(initialPaymentReference);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("error");
  const [faqQuery, setFaqQuery] = useState("");
  const [faqTopic, setFaqTopic] = useState(initialFaq?.category ?? (initialCategory === requestedCategory ? requestedCategory : "popular"));
  const [openFaqId, setOpenFaqId] = useState(initialFaq?.id ?? "");
  const requestFormRef = useRef(null);
  const subjectInputRef = useRef(null);
  const visibleFaqs = useMemo(() => findSupportFaqs({ query: faqQuery, topic: faqTopic }), [faqQuery, faqTopic]);

  useEffect(() => {
    if (!initialPaymentReference) return;
    window.requestAnimationFrame(() => requestFormRef.current?.scrollIntoView({ block: "start" }));
  }, [initialPaymentReference]);

  function prepareRequest(faq) {
    setCategory(faq.category);
    setSubject(faq.requestTitle);
    setMessage("");
    window.requestAnimationFrame(() => {
      requestFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      subjectInputRef.current?.focus({ preventScroll: true });
    });
  }

  async function loadRequests() {
    try {
      setRequests(await getMySupportRequests(10));
    } catch (error) {
      logAppError("Support requests load", error);
      setLoadingError(friendlyErrorMessage(error, "Your previous requests could not be loaded."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    getMySupportRequests(10)
      .then((nextRequests) => {
        if (active) setRequests(nextRequests);
      })
      .catch((error) => {
        if (!active) return;
        logAppError("Support requests load", error);
        setLoadingError(friendlyErrorMessage(error, "Your previous requests could not be loaded."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function submitRequest(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    setMessageTone("error");

    try {
      const created = await createSupportRequest({
        category,
        subject,
        description,
        paymentReference: category === "payment" ? paymentReference : "",
        pagePath: window.location.pathname,
      });
      setRequests((current) => [created, ...current].slice(0, 10));
      setSubject("");
      setDescription("");
      setPaymentReference("");
      setMessageTone("success");
      setMessage("Your request has been received. You can follow its status below.");
    } catch (error) {
      logAppError("Support request create", error);
      setMessage(friendlyErrorMessage(error, "Your request could not be sent. Please try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppFrame>
      <section className="support-page">
        <h1 className="sr-only">Help &amp; support</h1>

        <section className="support-faq" aria-labelledby="support-faq-title">
          <header className="support-faq-heading">
            <div>
              <h2 id="support-faq-title">Find an answer</h2>
              <p>Start with a quick answer. Send a request if the problem continues.</p>
            </div>
            <label className="support-faq-search">
              <span className="sr-only">Search help answers</span>
              <input onChange={(event) => setFaqQuery(event.target.value)} placeholder="Search help..." type="search" value={faqQuery} />
            </label>
          </header>
          <nav className="support-faq-topics" aria-label="Help topics">
            {SUPPORT_TOPICS.map((topic) => (
              <button
                aria-pressed={!faqQuery && faqTopic === topic.id}
                className={!faqQuery && faqTopic === topic.id ? "is-active" : ""}
                key={topic.id}
                onClick={() => { setFaqQuery(""); setFaqTopic(topic.id); setOpenFaqId(""); }}
                type="button"
              >
                {topic.label}
              </button>
            ))}
          </nav>
          <div className="support-faq-results">
            {visibleFaqs.length === 0 ? (
              <div className="support-faq-empty">
                <strong>No matching answer</strong>
                <p>Try a shorter search, or send us a request below.</p>
              </div>
            ) : visibleFaqs.map((faq) => {
              const isOpen = openFaqId === faq.id;
              return (
                <article className={`support-faq-item${isOpen ? " is-open" : ""}`} key={faq.id}>
                  <h3>
                    <button
                      aria-controls={`support-faq-answer-${faq.id}`}
                      aria-expanded={isOpen}
                      onClick={() => setOpenFaqId(isOpen ? "" : faq.id)}
                      type="button"
                    >
                      <span>{faq.question}</span>
                      <span aria-hidden="true">{isOpen ? "−" : "+"}</span>
                    </button>
                  </h3>
                  {isOpen && (
                    <div className="support-faq-answer" id={`support-faq-answer-${faq.id}`}>
                      <p>{faq.answer}</p>
                      <p><strong>Contact support when:</strong> {faq.escalation}</p>
                      <button className="support-faq-request" onClick={() => prepareRequest(faq)} type="button">Send a request about this</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <div className="support-layout">
          <form className="support-form" onSubmit={submitRequest} ref={requestFormRef}>
            <header className="support-panel-heading">
              <span className="support-panel-icon" aria-hidden="true">?</span>
              <div><h2>Send a request</h2><p>Give us enough detail to investigate without sharing sensitive information.</p></div>
            </header>
            <div className="support-form-body">
              <div className="support-form-row">
                <label>
                  <span>Help topic</span>
                  <select aria-label="What do you need help with?" disabled={submitting} onChange={(event) => setCategory(event.target.value)} value={category}>
                    {CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label>
                  <span>Short title</span>
                  <input aria-label="Issue" disabled={submitting} maxLength={120} minLength={5} onChange={(event) => setSubject(event.target.value)} placeholder="Briefly describe the issue" ref={subjectInputRef} required value={subject} />
                </label>
              </div>
              <label>
                <span>What happened?</span>
                <textarea disabled={submitting} maxLength={2000} minLength={20} onChange={(event) => setDescription(event.target.value)} placeholder="What were you trying to do, what did you expect, and what happened instead?" required rows={6} value={description} />
              </label>
              {category === "payment" && (
                <label>
                  <span>Payment reference <small>Optional — shown on your receipt</small></span>
                  <input aria-label="Payment reference optional" disabled={submitting} maxLength={120} onChange={(event) => setPaymentReference(event.target.value)} placeholder="PS-..." value={paymentReference} />
                </label>
              )}
              <p className="support-safety-note"><span aria-hidden="true">i</span> Never include a password, OTP, PIN, or card details.</p>
              {message && <p className={`support-message is-${messageTone}`} role={messageTone === "error" ? "alert" : "status"}>{message}</p>}
              <button className="primary-action" disabled={submitting} type="submit">{submitting ? "Sending..." : "Send request"}</button>
            </div>
          </form>

          <section className="support-history" aria-labelledby="support-history-title">
            <div className="support-history-heading">
              <div><span>Request history</span><h2 id="support-history-title">Your requests</h2></div>
              {!loading && !loadingError && <strong>{requests.length}</strong>}
              {loadingError && <button className="text-action" onClick={() => { setLoading(true); setLoadingError(""); void loadRequests(); }} type="button">Try again</button>}
            </div>
            {loading ? <LoadingState /> : loadingError ? (
              <p className="support-message is-error" role="alert">{loadingError}</p>
            ) : requests.length === 0 ? (
              <div className="support-empty"><span aria-hidden="true">✓</span><h3>No requests yet</h3><p>When you contact support, its status and resolution will appear here.</p></div>
            ) : (
              <div className="support-request-list">
                {requests.map((request) => (
                  <article key={request.id} className="support-request-row">
                    <div className="support-request-copy">
                      <span className="support-request-category">{CATEGORIES.find(([value]) => value === request.category)?.[1] ?? request.category}</span>
                      <strong>{request.subject}</strong>
                      <span>{new Date(request.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</span>
                    </div>
                    <span className={`support-request-status is-${request.status}`}>{STATUS_LABELS[request.status] ?? "Received"}</span>
                    {request.resolution_note && <div className="support-resolution-note"><strong>Resolution</strong><p>{request.resolution_note}</p></div>}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </AppFrame>
  );
}
