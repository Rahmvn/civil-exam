import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { AppFrame } from "../components/AppFrame";
import { LoadingState } from "../components/LoadingState";
import { createSupportRequest, getModuleAccessCatalog, getMySupportRequests } from "../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../lib/errors";
import { findSupportFaqs, SUPPORT_FAQS, SUPPORT_TOPICS } from "../lib/supportKnowledge";
import { buildWhatsAppSupportUrl, resolveWhatsAppSupportConfig } from "../lib/whatsappSupport";

const CATEGORIES = [
  ["account", "Account details or sign-in"],
  ["access", "Module access"],
  ["payment", "Payment"],
  ["practice", "Practice attempt"],
  ["content", "Question or answer content"],
  ["technical", "Technical problem"],
  ["suggestion", "Suggestion"],
];

const STATUS_LABELS = {
  received: "Received",
  in_review: "In review",
  resolved: "Resolved",
  closed: "Closed",
};

const MODULE_CATEGORIES = new Set(["access", "practice", "content"]);
const SUPPORT_CONFIG = resolveWhatsAppSupportConfig(import.meta.env);

function getSupportRequestStatusCopy(status) {
  if (status === "in_review") {
    return {
      title: "In review",
      body: "Our admin is checking the details now.",
    };
  }

  if (status === "resolved") {
    return {
      title: "Resolved",
      body: "Our admin has handled your request.",
    };
  }

  if (status === "closed") {
    return {
      title: "Closed",
      body: "Your request is closed. If the issue continues, send a new request.",
    };
  }

  return {
    title: "Received",
    body: "Our admin will check it and update your request here.",
  };
}

export default function Support() {
  const location = useLocation();
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
  const [moduleId, setModuleId] = useState("");
  const [modules, setModules] = useState([]);
  const [moduleError, setModuleError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("error");
  const [faqQuery, setFaqQuery] = useState("");
  const [faqTopic, setFaqTopic] = useState(initialFaq?.category ?? (initialCategory === requestedCategory ? requestedCategory : "popular"));
  const [openFaqId, setOpenFaqId] = useState(initialFaq?.id ?? "");
  const [showAllFaqs, setShowAllFaqs] = useState(Boolean(initialFaq));
  const requestFormRef = useRef(null);
  const subjectInputRef = useRef(null);
  const visibleFaqs = useMemo(() => findSupportFaqs({ query: faqQuery, topic: faqTopic }), [faqQuery, faqTopic]);
  const faqsToShow = faqQuery || showAllFaqs ? visibleFaqs : visibleFaqs.slice(0, 5);
  const openRequestCount = requests.filter((request) => !["resolved", "closed"].includes(request.status)).length;
  const requestCountLabel = openRequestCount > 0
    ? `${openRequestCount} open`
    : `${requests.length} request${requests.length === 1 ? "" : "s"}`;
  const whatsappSupportUrl = SUPPORT_CONFIG.enabled
    ? buildWhatsAppSupportUrl({ number: SUPPORT_CONFIG.number, pathname: location.pathname })
    : null;
  const isSuggestion = category === "suggestion";

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

  function prepareSuggestion() {
    setCategory("suggestion");
    setSubject("");
    setDescription("");
    setPaymentReference("");
    setModuleId("");
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

    Promise.allSettled([getMySupportRequests(10), getModuleAccessCatalog()])
      .then(([requestResult, moduleResult]) => {
        if (!active) return;
        if (requestResult.status === "fulfilled") {
          setRequests(requestResult.value);
        } else {
          logAppError("Support requests load", requestResult.reason);
          setLoadingError(friendlyErrorMessage(requestResult.reason, "Your previous requests could not be loaded."));
        }
        if (moduleResult.status === "fulfilled") {
          setModules(moduleResult.value);
        } else {
          logAppError("Support module list load", moduleResult.reason);
          setModuleError("Modules could not be loaded. Refresh the page before sending this request.");
        }
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
        subjectId: MODULE_CATEGORIES.has(category) ? moduleId : null,
      });
      setRequests((current) => [created, ...current].slice(0, 10));
      setSubject("");
      setDescription("");
      setPaymentReference("");
      setModuleId("");
      setMessageTone("success");
      setMessage(isSuggestion
        ? "Thanks. We have received your suggestion."
        : "Your request has been received. You can follow its status below.");
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
        <header className="support-page-intro">
          <div>
            <h1>Help and support</h1>
            <p>Search common answers, or send a request if we need to check your account.</p>
          </div>
          <label className="support-faq-search">
            <span className="sr-only">Search help answers</span>
            <input
              maxLength={120}
              onChange={(event) => {
                setFaqQuery(event.target.value);
                setShowAllFaqs(true);
              }}
              placeholder="Search help..."
              type="search"
              value={faqQuery}
            />
          </label>
        </header>

        <nav className="support-faq-topics" aria-label="Help topics">
          {SUPPORT_TOPICS.map((topic) => (
            <button
              aria-pressed={!faqQuery && faqTopic === topic.id}
              className={`support-topic-button${!faqQuery && faqTopic === topic.id ? " is-active" : ""}`}
              key={topic.id}
              onClick={() => {
                setFaqQuery("");
                setFaqTopic(topic.id);
                setOpenFaqId("");
                setShowAllFaqs(false);
              }}
              type="button"
            >
              {topic.label}
            </button>
          ))}
        </nav>

        <div className="support-workflow">
          <div className="support-main-column">
            <section className="support-faq" aria-labelledby="support-faq-title">
              <header className="support-section-heading">
                <div>
                  <h2 id="support-faq-title">Common answers</h2>
                  <p>{faqQuery ? `${visibleFaqs.length} matching answer${visibleFaqs.length === 1 ? "" : "s"}` : "Answers to the issues candidates ask about most."}</p>
                </div>
              </header>

              <div className="support-faq-results">
                {visibleFaqs.length === 0 ? (
                  <div className="support-faq-empty">
                    <strong>No matching answer</strong>
                    <p>Try a shorter search, or send us a request.</p>
                  </div>
                ) : faqsToShow.map((faq) => {
                  const isOpen = openFaqId === faq.id;
                  return (
                    <article className={`support-faq-item${isOpen ? " is-open" : ""}`} key={faq.id}>
                      <h3>
                        <button
                          aria-controls={`support-faq-answer-${faq.id}`}
                          aria-expanded={isOpen}
                          className="support-faq-toggle"
                          onClick={() => setOpenFaqId(isOpen ? "" : faq.id)}
                          type="button"
                        >
                          <span>{faq.question}</span>
                          <span aria-hidden="true">{isOpen ? "-" : "+"}</span>
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

              {!faqQuery && visibleFaqs.length > 5 && (
                <button
                  className="support-faq-more"
                  onClick={() => setShowAllFaqs((value) => !value)}
                  type="button"
                >
                  {showAllFaqs ? "Show fewer answers" : `View all ${visibleFaqs.length} answers`}
                </button>
              )}
            </section>

            <div className="support-quick-actions" aria-label="Quick support options">
              <section className="support-suggestion-card" aria-labelledby="support-suggestion-title">
                <div>
                  <h2 id="support-suggestion-title">Have a suggestion?</h2>
                  <p>Share an idea or something that felt unclear.</p>
                </div>
                <button className="support-suggestion-action" onClick={prepareSuggestion} type="button">
                  Share a suggestion
                </button>
              </section>
              {whatsappSupportUrl && (
                <a
                  aria-label="Chat on WhatsApp with PromotionSure support (opens in a new tab)"
                  className="support-whatsapp-link"
                  href={whatsappSupportUrl}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <span>Need urgent help?</span>
                  <strong>Chat on WhatsApp</strong>
                </a>
              )}
            </div>
          </div>

          <aside className="support-sidebar">
            <form className="support-form" onSubmit={submitRequest} ref={requestFormRef}>
              <header className="support-panel-heading">
                <div>
                  <h2>{isSuggestion ? "Share a suggestion" : "Send a request"}</h2>
                  <p>{isSuggestion
                    ? "Use this for ideas, confusing wording, or improvements you would like us to consider."
                    : "Use this when an answer does not solve the issue. Please avoid passwords, OTPs, PINs, and card details."}</p>
                </div>
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
                    <span>{isSuggestion ? "Suggestion title" : "Short title"}</span>
                    <input aria-label={isSuggestion ? "Suggestion title" : "Issue"} disabled={submitting} maxLength={120} minLength={5} onChange={(event) => setSubject(event.target.value)} placeholder={isSuggestion ? "Briefly describe the idea" : "Briefly describe the issue"} ref={subjectInputRef} required value={subject} />
                  </label>
                </div>

                {MODULE_CATEGORIES.has(category) && (
                  <label>
                    <span>Affected module</span>
                    <select aria-label="Affected module" disabled={submitting} onChange={(event) => setModuleId(event.target.value)} required value={moduleId}>
                      <option value="">Choose a module</option>
                      {modules.map((module) => <option key={module.subject_id} value={module.subject_id}>{module.subject_name}</option>)}
                    </select>
                    {moduleError && <small className="support-field-error" role="alert">{moduleError}</small>}
                  </label>
                )}

                <label>
                  <span>{isSuggestion ? "What should we improve?" : "What happened?"}</span>
                  <textarea disabled={submitting} maxLength={2000} minLength={20} onChange={(event) => setDescription(event.target.value)} placeholder={isSuggestion ? "Tell us what would make PromotionSure clearer or easier to use." : "What were you trying to do, what did you expect, and what happened instead?"} required rows={6} value={description} />
                  <small className="support-character-count">{`${description.length} / 2,000`}</small>
                </label>

                {category === "payment" && (
                  <label>
                    <span>Payment reference <small>Optional - shown on your receipt</small></span>
                    <input aria-label="Payment reference optional" disabled={submitting} maxLength={120} onChange={(event) => setPaymentReference(event.target.value)} placeholder="PS-..." value={paymentReference} />
                  </label>
                )}

                <p className="support-safety-note"><span aria-hidden="true">i</span> Never include a password, OTP, PIN, or card details.</p>
                {message && <p className={`support-message is-${messageTone}`} role={messageTone === "error" ? "alert" : "status"}>{message}</p>}
                <button className="primary-action" disabled={submitting} type="submit">{submitting ? "Sending..." : isSuggestion ? "Send suggestion" : "Send request"}</button>
              </div>
            </form>
          </aside>
        </div>

        <section className="support-history" aria-labelledby="support-history-title">
          <div className="support-history-heading">
            <div>
              <h2 id="support-history-title">Support requests</h2>
              <p>Track requests and suggestions you have sent.</p>
            </div>
            {!loading && !loadingError && requests.length > 0 && <strong>{requestCountLabel}</strong>}
            {loadingError && <button className="text-action" onClick={() => { setLoading(true); setLoadingError(""); void loadRequests(); }} type="button">Try again</button>}
          </div>
          {loading ? <LoadingState /> : loadingError ? (
            <p className="support-message is-error" role="alert">{loadingError}</p>
          ) : requests.length === 0 ? (
            <div className="support-empty"><span aria-hidden="true">✓</span><h3>No support requests yet</h3><p>Requests you send will appear here with their status.</p></div>
          ) : (
            <div className="support-request-list">
              {requests.map((request) => {
                const statusCopy = getSupportRequestStatusCopy(request.status);
                return (
                  <details key={request.id} className="support-request-row">
                    <summary>
                      <div className="support-request-copy">
                        <strong>{request.subject}</strong>
                        <span className="support-request-meta">
                          <span>{CATEGORIES.find(([value]) => value === request.category)?.[1] ?? request.category}</span>
                          <span aria-hidden="true">-</span>
                          <span>{new Date(request.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}</span>
                        </span>
                      </div>
                      <span className={`support-request-status is-${request.status}`}>{STATUS_LABELS[request.status] ?? "Received"}</span>
                    </summary>
                    <div className="support-request-detail">
                      <ol className={`support-request-timeline is-${request.status || "received"}`} aria-label="Request timeline">
                        <li>
                          <span className="support-request-timeline-dot" aria-hidden="true" />
                          <div>
                            <strong>Sent</strong>
                            <p>{request.description || "Your request was sent to support."}</p>
                          </div>
                        </li>
                        <li className="is-current">
                          <span className="support-request-timeline-dot" aria-hidden="true" />
                          <div>
                            <strong>{statusCopy.title}</strong>
                            <p>{request.resolution_note || statusCopy.body}</p>
                          </div>
                        </li>
                      </ol>
                      {request.resolution_note && request.status !== "resolved" && (
                        <div className="support-resolution-note">
                          <strong>Admin update</strong>
                          <p>{request.resolution_note}</p>
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </section>
      </section>
    </AppFrame>
  );
}
