import { useEffect, useState } from "react";
import { getAdminSupportGuidance } from "../../lib/supportKnowledge";

const PROCEDURES = [
  {
    id: "start",
    label: "Start here",
    title: "Triage every request the same way",
    introduction: "Establish the real scope and risk before changing a status or advising the candidate to retry.",
    steps: [
      "Protect the candidate first: stop repeat payments, submissions, or destructive browser actions when the first outcome is uncertain.",
      "Decide the scope: one account, one module or set, a shared candidate group, or the whole platform.",
      "Check the source of truth for the affected journey instead of relying only on the screenshot or visible page.",
      "Resolve or escalate, then verify that the candidate can complete the blocked action before marking the request resolved.",
    ],
    noteTitle: "Prioritise immediately",
    note: "Security or cross-user exposure, successful payment without access, lost submitted work, and failures affecting unrelated users are urgent incidents.",
    verify: "The request has an owner, a safe next action, and enough evidence to reproduce or verify recovery.",
  },
  {
    id: "account",
    category: "account",
    label: "Account & sign-in",
    title: "Account and sign-in requests",
    introduction: "Separate credential recovery from identity correction, profile problems, and repeated session failures.",
    verify: "The candidate can sign in to the correct account and their existing access and history remain attached to it.",
  },
  {
    id: "access",
    category: "access",
    label: "Modules & access",
    title: "Module visibility and access",
    introduction: "Determine whether the problem comes from module publication, sales state, free-module assignment, or an entitlement contradiction.",
    verify: "The correct module appears with the correct action, and the candidate can start exactly one valid practice when eligible.",
  },
  {
    id: "payment",
    category: "payment",
    label: "Payments",
    title: "Payment and paid access",
    introduction: "Treat the payment order, provider status, fulfillment state, and active entitlement as one chain that must agree.",
    verify: "The final payment state is recorded and every successful eligible payment has usable module access.",
  },
  {
    id: "practice",
    category: "practice",
    label: "Practice",
    title: "Practice sessions and results",
    introduction: "Identify the exact attempt before suggesting a restart, retry, resubmission, or browser action.",
    verify: "There is one authoritative attempt state: safely resumed, deliberately ended, or completed once with a result.",
  },
  {
    id: "content",
    category: "content",
    label: "Questions & content",
    title: "Question and content reports",
    introduction: "Locate the exact published version and protect active and historical attempts while the content is reviewed.",
    verify: "The source has been checked, the safe correction workflow was used, and candidate-facing content is complete and accurate.",
  },
  {
    id: "technical",
    category: "technical",
    label: "Technical problems",
    title: "Technical and platform problems",
    introduction: "A useful technical report identifies the route, behavior, device, browser, time, scope, and whether the problem is repeatable.",
    verify: "The affected route works on the original journey and the same failure no longer reproduces under the confirmed conditions.",
  },
  {
    id: "close",
    label: "Resolve & close",
    title: "Resolve a request truthfully",
    introduction: "A status is a statement about the work. It should never be used merely to clear the queue.",
    steps: [
      "Use Received for a new request and In review once somebody is actively checking it.",
      "Use Resolved only after the blocked journey or authoritative state has been verified.",
      "Write a candidate-visible note explaining what was found, what changed or was confirmed, and one next action.",
      "Use Closed for a resolved request after follow-up, a duplicate, spam, or a request the candidate withdrew.",
    ],
    noteTitle: "Resolution notes",
    note: "Do not expose database errors, provider payloads, internal speculation, or promises that have not been verified.",
    verify: "The note is understandable without technical knowledge and the candidate knows exactly what to do next.",
  },
];

export function AdminSupportProcedures({ onClose }) {
  const [selectedId, setSelectedId] = useState("start");
  const selected = PROCEDURES.find((procedure) => procedure.id === selectedId) ?? PROCEDURES[0];
  const guidance = selected.category ? getAdminSupportGuidance(selected.category) : null;
  const steps = selected.steps ?? guidance?.checks ?? [];
  const noteTitle = selected.noteTitle ?? "Safety boundary";
  const note = selected.note ?? guidance?.safety;

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className="admin-support-procedures-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-labelledby="admin-support-procedures-title"
        aria-modal="true"
        className="admin-support-procedures"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="admin-support-procedures-header">
          <div>
            <span>Support operations</span>
            <h2 id="admin-support-procedures-title">Support procedures</h2>
            <p>Use the relevant procedure while reviewing a candidate request.</p>
          </div>
          <button autoFocus onClick={onClose} type="button" aria-label="Close support procedures">×</button>
        </header>

        <div className="admin-support-procedures-picker">
          <label htmlFor="admin-support-procedure-topic">Procedure</label>
          <select id="admin-support-procedure-topic" onChange={(event) => setSelectedId(event.target.value)} value={selectedId}>
            {PROCEDURES.map((procedure) => <option key={procedure.id} value={procedure.id}>{procedure.label}</option>)}
          </select>
        </div>

        <article className="admin-support-procedure-content">
          <header>
            <span>{selected.label}</span>
            <h3>{selected.title}</h3>
            <p>{selected.introduction}</p>
          </header>

          <section>
            <h4>What to do</h4>
            <ol>
              {steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </section>

          {note && (
            <aside>
              <strong>{noteTitle}</strong>
              <p>{note}</p>
            </aside>
          )}

          {guidance?.escalate && (
            <section>
              <h4>When to escalate</h4>
              <p>{guidance.escalate}</p>
            </section>
          )}

          <section className="admin-support-procedure-verification">
            <h4>Before resolving</h4>
            <p>{selected.verify}</p>
          </section>
        </article>
      </section>
    </div>
  );
}
