import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  cancelAdminEmailCampaign,
  createAdminE2EmailCampaign,
  finalizeAdminEmailCampaign,
  getAdminEmailAudienceCatalog,
  getAdminEmailCampaign,
  getAdminEmailCampaignFinalization,
  getAdminEmailCampaignRecipients,
  getAdminEmailCampaigns,
  getAdminEmailAutomationHistory,
  getAdminEmailAutomations,
  getAdminEmailTemplates,
  getAdminTransactionalEmailEvents,
  getAdminUserApplicationEmailHistory,
  getAdminUserDirectory,
  pauseAdminEmailCampaign,
  previewAdminEmailAudience,
  resumeAdminEmailCampaign,
  retryAdminTransactionalEmailEvent,
  saveAdminEmailTemplate,
  sendAdminE2EmailCampaignTest,
  updateAdminEmailAutomation,
  updateAdminE2EmailCampaign,
} from "../../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../../lib/errors";
import { LoadingState } from "../LoadingState";
import "../../styles/admin-email.css";

const EMPTY_DRAFT = {
  internalName: "",
  audienceKind: "segment",
  userIds: [],
  segmentKey: "engagement_subscribers",
  moduleId: "",
  category: "engagement",
  templateId: "",
  subject: "",
  preheader: "",
  bodyText: "",
  ctaLabel: "",
  ctaUrl: "",
};

const STATUS_LABELS = {
  draft: "Draft", tested: "Tested", queued: "Queued", running: "Sending",
  paused: "Paused", completed: "Completed", cancelled: "Cancelled",
};

const EXCLUSION_LABELS = {
  opted_out: "Engagement opted out",
  suppressed: "Technically suppressed",
  invalid_recipient: "No valid current email",
  unconfirmed_account: "Account not confirmed",
  internal_account: "Internal account",
  recently_contacted: "Recently contacted",
  no_longer_eligible: "No longer eligible",
};

function formatDate(value) {
  return value ? new Date(value).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" }) : "Not yet";
}

function CampaignStatus({ value }) {
  return <span className={`admin-email-status is-${value}`}>{STATUS_LABELS[value] || value}</span>;
}

function ErrorNotice({ error }) {
  return error ? <p className="admin-email-notice is-error" role="alert">{error}</p> : null;
}

function AudiencePreview({ preview }) {
  if (!preview) return null;
  return (
    <section className="admin-email-preview" aria-labelledby="audience-preview-title">
      <header><h3 id="audience-preview-title">Audience preview</h3><span>Current server result</span></header>
      <dl className="admin-email-metrics">
        <div><dt>Eligible</dt><dd>{preview.eligible ?? 0}</dd></div>
        <div><dt>Excluded</dt><dd>{preview.excluded ?? 0}</dd></div>
        <div><dt>Total matched</dt><dd>{preview.total ?? 0}</dd></div>
      </dl>
      {Object.entries(preview.excluded_counts || {}).some(([, count]) => Number(count) > 0) && (
        <div className="admin-email-exclusions">
          {Object.entries(preview.excluded_counts).filter(([, count]) => Number(count) > 0).map(([reason, count]) => (
            <span key={reason}>{EXCLUSION_LABELS[reason] || reason}: {count}</span>
          ))}
        </div>
      )}
      <div className="admin-email-audience-list">
        {(preview.items || []).map((item) => (
          <div key={item.user_id}>
            <span><strong>{item.display_name || "Candidate"}</strong><small>{item.current_email || "No valid current email"}</small></span>
            <em>{item.eligible ? "Eligible" : EXCLUSION_LABELS[item.exclusion_reason] || item.exclusion_reason}</em>
          </div>
        ))}
      </div>
    </section>
  );
}

function UserPicker({ mode, selectedIds, onChange }) {
  const [directory, setDirectory] = useState({ items: [], total: 0 });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let current = true;
    getAdminUserDirectory({ query, limit: 25 }).then((result) => {
      if (current) setDirectory(result);
    }).catch((error) => logAppError("Admin email user picker", error)).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [query]);

  function toggle(id, checked) {
    if (mode === "individual") return onChange(checked ? [id] : []);
    onChange(checked ? [...new Set([...selectedIds, id])] : selectedIds.filter((value) => value !== id));
  }

  return (
    <div className="admin-email-user-picker">
      <label><span>Find users</span><input type="search" value={query} onChange={(event) => { setLoading(true); setQuery(event.target.value); }} placeholder="Search name or email" /></label>
      <div className="admin-email-user-picker-summary"><span>{selectedIds.length} selected</span>{selectedIds.length > 0 && <button type="button" onClick={() => onChange([])}>Clear</button>}</div>
      <div className="admin-email-user-options" aria-busy={loading}>
        {directory.items.map((user) => (
          <label key={user.id}>
            <input
              checked={selectedIds.includes(user.id)}
              name={mode === "individual" ? "individual-recipient" : undefined}
              onChange={(event) => toggle(user.id, event.target.checked)}
              type={mode === "individual" ? "radio" : "checkbox"}
            />
            <span><strong>{user.full_name || "Candidate"}</strong><small>{user.email}</small></span>
          </label>
        ))}
      </div>
    </div>
  );
}

function IndividualEmailContext({ userId, onChangeRecipient }) {
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    getAdminUserApplicationEmailHistory(userId, 5, 0)
      .then((result) => { if (current) setHistory(result); })
      .catch((caught) => {
        logAppError("Admin user application email history", caught);
        if (current) setError(friendlyErrorMessage(caught, "Application email history could not be loaded."));
      });
    return () => { current = false; };
  }, [userId]);

  if (!userId) return null;
  if (error) return <ErrorNotice error={error} />;
  if (!history) return <p className="admin-email-history-loading">Loading application email history...</p>;

  const preferenceEnabled = history.preference?.engagement_enabled !== false;
  const suppressions = history.suppressions || [];
  return (
    <section className="admin-email-user-context" aria-labelledby="application-email-history-title">
      <header>
        <span><strong>{history.user?.display_name || "Candidate"}</strong><small>{history.user?.current_email || "No current delivery address"}</small></span>
        <dl>
          <div><dt>Engagement</dt><dd>{preferenceEnabled ? "Subscribed" : "Unsubscribed"}</dd></div>
          <div><dt>Technical suppression</dt><dd>{suppressions.length ? "Suppressed" : "None"}</dd></div>
        </dl>
      </header>
      <button className="admin-email-change-recipient" type="button" onClick={onChangeRecipient}>Change recipient</button>
      {suppressions.length > 0 && <p className="admin-email-technical-warning">Technical suppression remains authoritative and cannot be bypassed here.</p>}
      <details className="admin-email-user-history">
        <summary id="application-email-history-title"><span>Application email history</span><small>{history.items.length}</small></summary>
        <p className="admin-email-history-scope">PromotionSure application email only. Auth OTP and recovery email are not included.</p>
        {history.items.length === 0 ? <p className="admin-email-history-empty">No application email events yet.</p> : (
          <div className="admin-email-history-list">
            {history.items.map((item) => (
              <div key={item.id}>
                <span><strong>{item.subject || item.campaign_name || item.event_type}</strong><small>{formatDate(item.created_at)} · {item.campaign_name || item.template_key}</small></span>
                <span><em>{item.dispatch_status}</em><small>{item.delivery_status} · {item.attempt_count} attempt{Number(item.attempt_count) === 1 ? "" : "s"}</small></span>
              </div>
            ))}
          </div>
        )}
      </details>
    </section>
  );
}

function ComposeView({ catalog, templates, initialUserIds, onComplete, onDraftSaved }) {
  const [draft, setDraft] = useState(() => ({
    ...EMPTY_DRAFT,
    audienceKind: initialUserIds.length === 1 ? "individual" : initialUserIds.length > 1 ? "selected" : "segment",
    userIds: initialUserIds,
    category: initialUserIds.length === 1 ? "support" : "engagement",
  }));
  const [campaign, setCampaign] = useState(null);
  const [preview, setPreview] = useState(null);
  const [finalization, setFinalization] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedNotice, setSavedNotice] = useState("");
  const [choosingRecipient, setChoosingRecipient] = useState(initialUserIds.length !== 1);

  const selectedSegment = catalog.segments?.find((item) => item.segment_key === draft.segmentKey);
  const isDirectSupport = draft.audienceKind === "individual" && draft.category === "support";
  const canPreview = draft.audienceKind === "segment" ? Boolean(draft.segmentKey) && (!selectedSegment?.requires_module || draft.moduleId) : draft.userIds.length > 0;
  const validMessage = (isDirectSupport || draft.internalName.trim()) && draft.subject.trim() && draft.bodyText.trim()
    && (Boolean(draft.ctaLabel.trim()) === Boolean(draft.ctaUrl.trim()));

  function update(values) {
    setDraft((current) => ({ ...current, ...values }));
    setPreview(null);
    setFinalization(null);
    setSavedNotice("");
  }

  function campaignPayload() {
    return {
      ...draft,
      internalName: isDirectSupport && !draft.internalName.trim()
        ? `Support: ${draft.subject.trim()}`.slice(0, 160)
        : draft.internalName,
      category: draft.audienceKind === "individual" ? draft.category : "engagement",
      segmentParams: selectedSegment?.requires_module ? { module_id: draft.moduleId } : {},
      templateId: draft.templateId || null,
    };
  }

  async function run(action, fallback) {
    setBusy(true); setError("");
    try { return await action(); }
    catch (caught) { logAppError("Admin Email Center", caught); setError(friendlyErrorMessage(caught, fallback)); return null; }
    finally { setBusy(false); }
  }

  async function handlePreview() {
    const result = await run(() => previewAdminEmailAudience({
      audienceKind: draft.audienceKind,
      userIds: draft.userIds,
      segmentKey: draft.audienceKind === "segment" ? draft.segmentKey : null,
      segmentParams: selectedSegment?.requires_module ? { module_id: draft.moduleId } : {},
      category: draft.audienceKind === "individual" ? draft.category : "engagement",
    }), "Audience preview failed.");
    if (result) setPreview(result);
  }

  async function saveDraft() {
    const payload = campaignPayload();
    const result = await run(
      () => campaign ? updateAdminE2EmailCampaign(campaign.id, payload) : createAdminE2EmailCampaign(payload),
      "The campaign draft could not be saved.",
    );
    if (result) {
      setCampaign(result);
      setSavedNotice("Draft saved.");
      onDraftSaved(result);
    }
    return result;
  }

  async function handleTest() {
    const saved = await saveDraft();
    if (!saved) return;
    const result = await run(() => sendAdminE2EmailCampaignTest(saved.id), "The test email failed.");
    if (result) setCampaign(await getAdminEmailCampaign(saved.id));
  }

  async function handleFinalReview() {
    const saved = await saveDraft();
    if (!saved) return;
    const result = await run(() => getAdminEmailCampaignFinalization(saved.id), "Final audience confirmation failed.");
    if (result) setFinalization(result);
  }

  async function handleQueue() {
    const result = await run(() => finalizeAdminEmailCampaign(campaign.id), "The campaign could not be queued.");
    if (result) onComplete(campaign.id);
  }

  function chooseTemplate(templateId) {
    const template = templates.find((item) => item.id === templateId);
    update(template ? {
      templateId,
      category: template.category,
      subject: template.subject,
      preheader: template.preheader || "",
      bodyText: template.body_text,
      ctaLabel: template.cta_label || "",
      ctaUrl: template.cta_url || "",
    } : { templateId: "" });
  }

  function chooseAudienceKind(audienceKind) {
    const userIds = audienceKind === "segment"
      ? []
      : audienceKind === "individual"
        ? draft.userIds.slice(0, 1)
        : draft.userIds;
    setChoosingRecipient(audienceKind !== "individual" || userIds.length === 0);
    update({
      audienceKind,
      userIds,
      category: audienceKind === "individual" ? "support" : "engagement",
    });
  }

  function chooseRecipients(userIds) {
    update({ userIds });
    if (draft.audienceKind === "individual" && userIds.length === 1) setChoosingRecipient(false);
  }

  const finalizationAllowsQueue = finalization
    && Number(finalization.eligible) > 0
    && (isDirectSupport || finalization.test_valid);

  return (
    <section className={`admin-email-compose${isDirectSupport ? " is-direct-support" : ""}`}>
      <header className="admin-email-compose-heading"><div><button type="button" onClick={() => onComplete(null)}>Back to campaigns</button><h1>Compose email</h1></div>{campaign && <CampaignStatus value={campaign.status} />}</header>
      <ErrorNotice error={error} />
      {savedNotice && <p className="admin-email-notice is-success" role="status">{savedNotice}</p>}
      <div className="admin-email-compose-grid">
        <div className="admin-email-compose-main">
          <fieldset className="admin-email-section"><legend>{draft.audienceKind === "individual" ? "Recipient" : "Audience"}</legend>
            <div className="admin-email-mode-options">
              {[['individual', 'Individual user'], ['selected', 'Selected users'], ['segment', 'Segment']].map(([value, label]) => (
                <label key={value}><input checked={draft.audienceKind === value} name="audience-mode" onChange={() => chooseAudienceKind(value)} type="radio" />{label}</label>
              ))}
            </div>
            {draft.audienceKind === "segment" ? (
              <div className="admin-email-field-row">
                <label><span>Audience segment</span><select value={draft.segmentKey} onChange={(event) => update({ segmentKey: event.target.value, moduleId: "" })}>{(catalog.segments || []).map((item) => <option key={item.segment_key} value={item.segment_key}>{item.name}</option>)}</select></label>
                {selectedSegment?.requires_module && <label><span>Module</span><select value={draft.moduleId} onChange={(event) => update({ moduleId: event.target.value })}><option value="">Choose module</option>{(catalog.modules || []).map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</select></label>}
              </div>
            ) : draft.audienceKind !== "individual" || choosingRecipient || !draft.userIds[0]
              ? <UserPicker mode={draft.audienceKind} selectedIds={draft.userIds} onChange={chooseRecipients} />
              : <IndividualEmailContext key={draft.userIds[0]} userId={draft.userIds[0]} onChangeRecipient={() => setChoosingRecipient(true)} />}
            {draft.audienceKind === "individual" && <label className="admin-email-category"><span>Message category</span><select value={draft.category} onChange={(event) => update({ category: event.target.value })}><option value="support">Support</option><option value="engagement">Engagement</option></select><small>{draft.category === "support" ? "For individual service or account communication, not promotional messaging." : "Engagement messages require a successful test and respect engagement preferences and frequency limits."}</small></label>}
            {!isDirectSupport && <button disabled={busy || !canPreview} type="button" onClick={handlePreview}>Preview audience</button>}
          </fieldset>
          {!isDirectSupport && <AudiencePreview preview={preview} />}
          <fieldset className="admin-email-section"><legend>Message</legend>
            {isDirectSupport ? (
              <label><span>Template</span><select value={draft.templateId} onChange={(event) => chooseTemplate(event.target.value)}><option value="">Custom message</option>{templates.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            ) : (
              <div className="admin-email-field-row">
                <label><span>Campaign name</span><input maxLength={160} value={draft.internalName} onChange={(event) => update({ internalName: event.target.value })} /></label>
                <label><span>Template</span><select value={draft.templateId} onChange={(event) => chooseTemplate(event.target.value)}><option value="">Custom message</option>{templates.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              </div>
            )}
            <label><span>Subject</span><input maxLength={160} value={draft.subject} onChange={(event) => update({ subject: event.target.value })} /></label>
            <label><span>Preheader <small>Optional</small></span><input maxLength={200} value={draft.preheader} onChange={(event) => update({ preheader: event.target.value })} /></label>
            <label><span>Body</span><textarea maxLength={5000} rows={10} value={draft.bodyText} onChange={(event) => update({ bodyText: event.target.value })} /></label>
            <p className="admin-email-helper">Use {"{{first_name}}"} for the candidate&apos;s first name.</p>
            <div className="admin-email-field-row"><label><span>CTA label <small>Optional</small></span><input maxLength={80} value={draft.ctaLabel} onChange={(event) => update({ ctaLabel: event.target.value })} /></label><label><span>CTA HTTPS URL <small>Optional</small></span><input type="url" value={draft.ctaUrl} onChange={(event) => update({ ctaUrl: event.target.value })} /></label></div>
          </fieldset>
        </div>
        <aside className="admin-email-send-panel">
          <h2>{isDirectSupport ? "Review and send" : "Preview and queue"}</h2>
          <p>{isDirectSupport ? "The recipient and suppression status are rechecked before Email Core queues this message." : "Production recipients are rechecked and queued through Email Core."}</p>
          {!isDirectSupport && <div className="admin-email-test-state"><span>Test</span><strong>{campaign?.test_status === "passed" && campaign?.test_valid ? "Passed" : campaign?.test_status === "failed" ? "Failed" : "Pending"}</strong></div>}
          {!isDirectSupport && campaign?.test_error_message && <p className="admin-email-inline-error">{campaign.test_error_message}</p>}
          {!isDirectSupport && <button disabled={busy || !validMessage || !canPreview} type="button" onClick={saveDraft}>Save draft</button>}
          {!isDirectSupport && <button disabled={busy || !validMessage || !canPreview} type="button" onClick={handleTest}>Send test to my email</button>}
          <button className="is-primary" disabled={busy || !validMessage || !canPreview} type="button" onClick={handleFinalReview}>{isDirectSupport ? "Review email" : "Review final audience"}</button>
          {finalization && <div className="admin-email-final-confirm" role="group" aria-label="Final campaign confirmation"><h3>{isDirectSupport ? "Send this email?" : "Queue this email?"}</h3><dl><div><dt>{isDirectSupport ? "Recipient available" : "Eligible now"}</dt><dd>{finalization.eligible}</dd></div><div><dt>Excluded</dt><dd>{finalization.excluded}</dd></div><div><dt>Subject</dt><dd>{finalization.subject}</dd></div></dl>{!isDirectSupport && !finalization.test_valid && <p>A successful test is required for this exact campaign.</p>}<button className="is-primary" disabled={busy || !finalizationAllowsQueue} type="button" onClick={handleQueue}>{isDirectSupport ? "Send email" : `Queue ${finalization.eligible} email${Number(finalization.eligible) === 1 ? "" : "s"}`}</button></div>}
        </aside>
      </div>
    </section>
  );
}

function CampaignDetail({ campaignId, onBack }) {
  const [campaign, setCampaign] = useState(null);
  const [recipients, setRecipients] = useState({ items: [], total: 0 });
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  async function refresh() {
    setBusy(true); setError("");
    try {
      const [nextCampaign, nextRecipients] = await Promise.all([getAdminEmailCampaign(campaignId), getAdminEmailCampaignRecipients({ campaignId, state: filter, query, offset: page * 50 })]);
      setCampaign(nextCampaign); setRecipients(nextRecipients);
    } catch (caught) { setError(friendlyErrorMessage(caught, "Campaign details could not be loaded.")); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let current = true;
    Promise.all([getAdminEmailCampaign(campaignId), getAdminEmailCampaignRecipients({ campaignId, state: filter, query, offset: page * 50 })])
      .then(([nextCampaign, nextRecipients]) => {
        if (current) { setCampaign(nextCampaign); setRecipients(nextRecipients); }
      })
      .catch((caught) => { if (current) setError(friendlyErrorMessage(caught, "Campaign details could not be loaded.")); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [campaignId, filter, page, query]);

  async function transition(action) {
    setBusy(true); setError("");
    try { await action(campaignId); await refresh(); }
    catch (caught) { setError(friendlyErrorMessage(caught, "Campaign could not be updated.")); setBusy(false); }
  }
  if (!campaign && busy) return <LoadingState />;
  if (!campaign) return <ErrorNotice error={error || "Campaign not found."} />;
  const counts = campaign.counts || {};
  return <section className="admin-email-detail"><header><div><button type="button" onClick={onBack}>Back to campaigns</button><h1>{campaign.internal_name}</h1><p>{campaign.subject}</p></div><CampaignStatus value={campaign.status} /></header><ErrorNotice error={error} />
    <dl className="admin-email-metrics is-wide">{[['Queued', counts.eligible], ['Pending', counts.pending], ['Accepted', counts.accepted], ['Delivered', counts.delivered], ['Bounced', counts.bounced], ['Suppressed', counts.suppressed], ['Failed', counts.failed], ['Cancelled', counts.cancelled]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 0}</dd></div>)}</dl>
    <div className="admin-email-detail-actions"><button disabled={busy || !['queued', 'running'].includes(campaign.status)} onClick={() => transition(pauseAdminEmailCampaign)} type="button">Pause</button><button disabled={busy || campaign.status !== 'paused'} onClick={() => transition(resumeAdminEmailCampaign)} type="button">Resume</button><button className="is-danger" disabled={busy || !['queued', 'running', 'paused'].includes(campaign.status)} onClick={() => transition(cancelAdminEmailCampaign)} type="button">Cancel remaining</button><button disabled={busy} onClick={refresh} type="button">Refresh</button></div>
    <section className="admin-email-message-snapshot"><h2>Approved message</h2><dl><div><dt>Category</dt><dd>{campaign.category}</dd></div><div><dt>Audience</dt><dd>{campaign.segment_key || campaign.audience_kind}</dd></div><div><dt>Created by</dt><dd>{campaign.created_by_email || "Admin"}</dd></div><div><dt>Queued</dt><dd>{formatDate(campaign.queued_at)}</dd></div></dl><h3>{campaign.subject}</h3>{campaign.preheader && <p className="is-muted">{campaign.preheader}</p>}<p className="admin-email-body-copy">{campaign.body_text}</p></section>
    <section className="admin-email-recipient-results"><header><h2>Recipients</h2><div className="admin-email-recipient-toolbar"><input aria-label="Search campaign recipients" onChange={(event) => { setPage(0); setQuery(event.target.value); }} placeholder="Search name or email" type="search" value={query} /><select aria-label="Recipient state" value={filter} onChange={(event) => { setPage(0); setFilter(event.target.value); }}><option value="all">All</option><option value="pending">Pending</option><option value="delivered">Delivered</option><option value="bounced">Bounced</option><option value="suppressed">Suppressed</option><option value="dead">Failed</option><option value="cancelled">Cancelled</option></select></div></header>{recipients.items.length === 0 ? <p className="admin-email-history-empty">No matching recipients.</p> : recipients.items.map((item) => <div key={item.id}><span><strong>{item.recipient_name || "Candidate"}</strong><small>{item.recipient_email_used || item.recipient_email || "Address resolved at dispatch"}</small></span><em>{EXCLUSION_LABELS[item.display_state] || item.display_state}</em></div>)}<footer className="admin-email-pagination"><span>{recipients.total} recipient{Number(recipients.total) === 1 ? "" : "s"}</span><div><button disabled={busy || page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} type="button">Previous</button><button disabled={busy || !recipients.has_more} onClick={() => setPage((current) => current + 1)} type="button">Next</button></div></footer></section>
  </section>;
}

function CampaignsView({ campaigns, onCompose, onOpen }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleCampaigns = campaigns.filter((campaign) => (
    (status === "all" || campaign.status === status)
    && (!normalizedQuery || [campaign.internal_name, campaign.subject, campaign.segment_key, campaign.audience_kind, campaign.created_by_email]
      .filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery))
  ));
  return <section><header className="admin-email-page-heading"><div><h1>Email</h1><p>Campaigns and direct application messages.</p></div><button className="is-primary" onClick={onCompose} type="button">Compose email</button></header><div className="admin-email-campaign-toolbar"><input aria-label="Search campaigns" onChange={(event) => setQuery(event.target.value)} placeholder="Search campaign or subject" type="search" value={query} /><select aria-label="Campaign status" onChange={(event) => setStatus(event.target.value)} value={status}><option value="all">All statuses</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="admin-email-campaign-list">{visibleCampaigns.length === 0 ? <div className="admin-empty-state"><h2>{campaigns.length ? "No matching campaigns" : "No campaigns yet"}</h2><p>{campaigns.length ? "Try another campaign name or status." : "Compose an email when there is a clear operational need."}</p></div> : visibleCampaigns.map((campaign) => <button key={campaign.id} type="button" onClick={() => onOpen(campaign.id)}><span><strong>{campaign.internal_name || campaign.subject}</strong><small>{campaign.segment_key || campaign.audience_kind} · {formatDate(campaign.created_at)} · {campaign.created_by_email || "Admin"}</small></span><span className="admin-email-campaign-progress"><CampaignStatus value={campaign.status} /><small>{campaign.counts?.delivered || 0} delivered · {campaign.counts?.pending || 0} pending</small></span></button>)}</div></section>;
}

function DeliveryView() {
  const [result, setResult] = useState({ items: [], total: 0, counts: {} });
  const [status, setStatus] = useState("all"); const [query, setQuery] = useState(""); const [loading, setLoading] = useState(true);
  async function refresh() { setLoading(true); try { setResult(await getAdminTransactionalEmailEvents({ status, query })); } finally { setLoading(false); } }
  useEffect(() => {
    let current = true;
    getAdminTransactionalEmailEvents({ status, query })
      .then((nextResult) => { if (current) setResult(nextResult); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [status, query]);
  return <section><header className="admin-email-page-heading"><div><h1>Delivery</h1><p>Transactional and campaign email use the same delivery record.</p></div><button disabled={loading} onClick={refresh} type="button">Refresh</button></header><div className="admin-email-delivery-toolbar"><input aria-label="Search email delivery" type="search" placeholder="Search user, campaign, template, message ID, or reference" value={query} onChange={(event) => setQuery(event.target.value)} /><select aria-label="Delivery status" value={status} onChange={(event) => setStatus(event.target.value)}>{['all','pending','processing','retrying','accepted','delivered','delayed','bounced','complained','suppressed','dead','cancelled'].map((value) => <option key={value} value={value}>{value}</option>)}</select></div><div className="admin-email-delivery-list" aria-busy={loading}>{result.items.map((event) => <article key={event.id}><div><strong>{event.subject || event.product_label || event.event_type}</strong><span>{event.recipient_email || 'Recipient resolved at dispatch'}</span><small>{formatDate(event.created_at)} · {event.campaign_name || event.template_name || event.template_key} · {event.category}</small></div><dl><div><dt>Dispatch</dt><dd>{event.dispatch_status}</dd></div><div><dt>Delivery</dt><dd>{event.delivery_status}</dd></div><div><dt>Attempts</dt><dd>{event.attempt_count}</dd></div></dl>{event.dispatch_status === 'dead' && <button type="button" onClick={async () => { await retryAdminTransactionalEmailEvent(event.id); await refresh(); }}>Retry</button>}</article>)}</div></section>;
}

function TemplatesView({ templates, onRefresh }) {
  const [selected, setSelected] = useState(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  function edit(template) { setSelected({ ...template, bodyText: template.body_text, ctaLabel: template.cta_label || '', ctaUrl: template.cta_url || '' }); }
  async function save(event) { event.preventDefault(); setBusy(true); setError(''); try { await saveAdminEmailTemplate(selected); setSelected(null); await onRefresh(); } catch (caught) { setError(friendlyErrorMessage(caught, 'Template could not be saved.')); } finally { setBusy(false); } }
  return <section><header className="admin-email-page-heading"><div><h1>Templates</h1><p>Reusable structured copy. Queued campaigns keep their own snapshot.</p></div></header><ErrorNotice error={error} /><div className="admin-email-template-list">{templates.map((template) => <button key={template.id} type="button" onClick={() => edit(template)}><span><strong>{template.name}</strong><small>{template.category} · {template.subject}</small></span><em>{template.active ? 'Active' : 'Inactive'}</em></button>)}</div>{selected && <form className="admin-email-template-editor" onSubmit={save}><h2>Edit template</h2><label><span>Name</span><input value={selected.name} onChange={(event) => setSelected({ ...selected, name: event.target.value })} /></label><label><span>Category</span><select value={selected.category} onChange={(event) => setSelected({ ...selected, category: event.target.value })}><option value="support">Support</option><option value="engagement">Engagement</option></select></label><label><span>Subject</span><input value={selected.subject} onChange={(event) => setSelected({ ...selected, subject: event.target.value })} /></label><label><span>Preheader</span><input value={selected.preheader || ''} onChange={(event) => setSelected({ ...selected, preheader: event.target.value })} /></label><label><span>Body</span><textarea rows={9} value={selected.bodyText} onChange={(event) => setSelected({ ...selected, bodyText: event.target.value })} /></label><div className="admin-email-field-row"><label><span>CTA label</span><input value={selected.ctaLabel} onChange={(event) => setSelected({ ...selected, ctaLabel: event.target.value })} /></label><label><span>CTA URL</span><input value={selected.ctaUrl} onChange={(event) => setSelected({ ...selected, ctaUrl: event.target.value })} /></label></div><label className="admin-email-checkbox"><input type="checkbox" checked={selected.active} onChange={(event) => setSelected({ ...selected, active: event.target.checked })} />Active</label><div><button type="button" onClick={() => setSelected(null)}>Cancel</button><button className="is-primary" disabled={busy} type="submit">Save template</button></div></form>}</section>;
}

function timingLabel(automation) {
  const minutes = Number(automation.delay_minutes) || 0;
  const amount = minutes % 1440 === 0
    ? `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`
    : minutes % 60 === 0
      ? `${minutes / 60} hour${minutes === 60 ? "" : "s"}`
      : `${minutes} minutes`;
  return automation.timing_mode === "before_expiry" ? `${amount} before expiry` : `${amount} after trigger`;
}

function automationDraft(automation) {
  if (!automation) return null;
  return {
    automationKey: automation.automation_key,
    enabled: automation.enabled,
    delayMinutes: automation.delay_minutes,
    templateId: automation.template_id,
    practiceMinIntervalHours: automation.practice_min_interval_hours ?? "",
    practiceRolling7dCap: automation.practice_rolling_7d_cap ?? "",
    practiceImprovementPoints: automation.practice_improvement_points ?? "",
  };
}

function AutomationsView({ automations, templates, onRefresh }) {
  const [selectedKey, setSelectedKey] = useState(automations[0]?.automation_key || "");
  const [draft, setDraft] = useState(() => automationDraft(automations[0]));
  const [history, setHistory] = useState({ items: [], total: 0 });
  const [stateFilter, setStateFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = automations.find((item) => item.automation_key === selectedKey) || automations[0];

  useEffect(() => {
    if (!selected?.automation_key) return;
    let current = true;
    getAdminEmailAutomationHistory({ automationKey: selected.automation_key, state: stateFilter, query })
      .then((result) => { if (current) setHistory(result); })
      .catch((caught) => { if (current) setError(friendlyErrorMessage(caught, "Automation history could not be loaded.")); });
    return () => { current = false; };
  }, [query, selected?.automation_key, stateFilter]);

  async function save() {
    setBusy(true); setError("");
    try {
      const saved = await updateAdminEmailAutomation(draft);
      setDraft(automationDraft(saved));
      await onRefresh();
    } catch (caught) {
      setError(friendlyErrorMessage(caught, "Automation settings could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  if (!selected || !draft) return <section><header className="admin-email-page-heading"><div><h1>Automations</h1></div></header><p>No lifecycle automations are configured.</p></section>;
  const compatibleTemplates = templates.filter((template) => template.active && template.category === "engagement");
  return (
    <section className="admin-email-automations">
      <header className="admin-email-page-heading"><div><h1>Automations</h1><p>Lifecycle email evaluated through Email Core.</p></div></header>
      <ErrorNotice error={error} />
      <div className="admin-email-automation-layout">
        <div className="admin-email-automation-list" aria-label="Lifecycle automations">
          {automations.map((automation) => (
            <button aria-current={automation.automation_key === selected.automation_key ? "true" : undefined} key={automation.automation_key} onClick={() => { setSelectedKey(automation.automation_key); setDraft(automationDraft(automation)); }} type="button">
              <span><strong>{automation.name}</strong><small>{timingLabel(automation)} · {automation.template_name}</small></span>
              <span><em>{automation.enabled ? "Enabled" : "Disabled"}</em><small>{automation.sent_count || 0} sent</small></span>
            </button>
          ))}
        </div>
        <div className="admin-email-automation-detail">
          <header><div><h2>{selected.name}</h2><p>{selected.purpose}</p></div><span className={`admin-email-status is-${selected.enabled ? "completed" : "cancelled"}`}>{selected.enabled ? "Enabled" : "Disabled"}</span></header>
          <dl className="admin-email-metrics admin-email-automation-metrics">
            <div><dt>Scheduled</dt><dd>{selected.scheduled_count || 0}</dd></div>
            <div><dt>Sent</dt><dd>{selected.sent_count || 0}</dd></div>
            <div><dt>Skipped / cancelled</dt><dd>{selected.skipped_cancelled_count || 0}</dd></div>
            <div><dt>Errors</dt><dd>{selected.error_count || 0}</dd></div>
          </dl>
          <div className="admin-email-automation-form">
            <label className="admin-email-checkbox"><input checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} type="checkbox" />Enabled</label>
            <label><span>{selected.timing_mode === "before_expiry" ? "Reminder lead time (minutes)" : "Delay after trigger (minutes)"}</span><input max={selected.max_delay_minutes} min={selected.min_delay_minutes} onChange={(event) => setDraft({ ...draft, delayMinutes: event.target.value })} step="1" type="number" value={draft.delayMinutes} /><small>Allowed: {selected.min_delay_minutes}–{selected.max_delay_minutes} minutes</small></label>
            <label><span>Template</span><select onChange={(event) => setDraft({ ...draft, templateId: event.target.value })} value={draft.templateId}>{compatibleTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
            {selected.automation_key === "practice_progress" && <>
              <p className="admin-email-automation-guidance">Only meaningful milestones are combined. Completing every set does not send an email.</p>
              <label><span>Minimum interval (hours)</span><input max="720" min="24" onChange={(event) => setDraft({ ...draft, practiceMinIntervalHours: event.target.value })} step="1" type="number" value={draft.practiceMinIntervalHours} /><small>At least 24 hours between practice-progress emails.</small></label>
              <label><span>Maximum in 7 days</span><input max="7" min="1" onChange={(event) => setDraft({ ...draft, practiceRolling7dCap: event.target.value })} step="1" type="number" value={draft.practiceRolling7dCap} /></label>
              <label><span>Personal-best improvement</span><input max="25" min="5" onChange={(event) => setDraft({ ...draft, practiceImprovementPoints: event.target.value })} step="1" type="number" value={draft.practiceImprovementPoints} /><small>Required percentage-point improvement.</small></label>
            </>}
            <button className="is-primary" disabled={busy} onClick={save} type="button">Save automation</button>
          </div>
          <dl className="admin-email-automation-run">
            <div><dt>Activated</dt><dd>{selected.activated_at ? formatDate(selected.activated_at) : "Not activated"}</dd></div>
            <div><dt>Last evaluation</dt><dd>{formatDate(selected.last_evaluated_at)}</dd></div>
            <div><dt>Last run</dt><dd>{selected.last_run_discovered || 0} discovered · {selected.last_run_queued || 0} queued · {selected.last_run_skipped || 0} skipped</dd></div>
          </dl>
          {selected.last_error && <p className="admin-email-notice is-error">{selected.last_error}</p>}
          <section className="admin-email-automation-history"><header><h3>History</h3><div><input aria-label="Search automation history" onChange={(event) => setQuery(event.target.value)} placeholder="Search user or reason" type="search" value={query} /><select aria-label="Automation history state" onChange={(event) => setStateFilter(event.target.value)} value={stateFilter}>{["all", "scheduled", "queued", "sent", "skipped", "cancelled", "error"].map((value) => <option key={value} value={value}>{value}</option>)}</select></div></header>
            {history.items?.length ? history.items.map((item) => <article key={item.id}><span><strong>{item.display_name}</strong><small>{item.current_email}</small><small>Triggered {formatDate(item.trigger_at)} · Due {formatDate(item.due_at)}</small></span><span><em>{item.state}</em><small>Eligibility: {item.eligibility_result}</small><small>{item.reason || item.delivery_status || "Eligible"}</small>{item.transactional_email_event_id && <small>Event {item.transactional_email_event_id}</small>}</span></article>) : <p className="admin-email-history-empty">No matching automation history.</p>}
          </section>
        </div>
      </div>
    </section>
  );
}

export function AdminEmailCenter() {
  const location = useLocation(); const navigate = useNavigate(); const { campaignId } = useParams();
  const [tab, setTab] = useState("campaigns"); const [composing, setComposing] = useState(Boolean(location.state?.emailUserIds?.length));
  const [campaigns, setCampaigns] = useState([]); const [templates, setTemplates] = useState([]); const [catalog, setCatalog] = useState({ segments: [], modules: [] }); const [loading, setLoading] = useState(true);
  const [automations, setAutomations] = useState([]);
  const initialUserIds = useMemo(() => location.state?.emailUserIds || [], [location.state]);
  async function load() { setLoading(true); try { const [nextCampaigns, nextTemplates, nextCatalog, nextAutomations] = await Promise.all([getAdminEmailCampaigns(50), getAdminEmailTemplates(), getAdminEmailAudienceCatalog(), getAdminEmailAutomations()]); setCampaigns(nextCampaigns); setTemplates(nextTemplates); setCatalog(nextCatalog); setAutomations(nextAutomations); } finally { setLoading(false); } }
  useEffect(() => {
    let current = true;
    Promise.all([getAdminEmailCampaigns(50), getAdminEmailTemplates(), getAdminEmailAudienceCatalog(), getAdminEmailAutomations()])
      .then(([nextCampaigns, nextTemplates, nextCatalog, nextAutomations]) => {
        if (current) { setCampaigns(nextCampaigns); setTemplates(nextTemplates); setCatalog(nextCatalog); setAutomations(nextAutomations); }
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);
  if (campaignId) return <CampaignDetail campaignId={campaignId} onBack={() => navigate('/admin/email')} />;
  if (loading) return <LoadingState />;
  if (composing) return <ComposeView catalog={catalog} templates={templates} initialUserIds={initialUserIds} onDraftSaved={(saved) => setCampaigns((current) => [saved, ...current.filter((campaign) => campaign.id !== saved.id)])} onComplete={(id) => { if (id) navigate(`/admin/email/campaigns/${id}`); else { setComposing(false); navigate('/admin/email', { replace: true }); } }} />;
  return <div className="admin-email-center"><nav className="admin-email-tabs" aria-label="Email sections">{[['campaigns','Campaigns'],['automations','Automations'],['delivery','Delivery'],['templates','Templates']].map(([value,label]) => <button aria-current={tab === value ? 'page' : undefined} key={value} onClick={() => setTab(value)} type="button">{label}</button>)}</nav>{tab === 'campaigns' ? <CampaignsView campaigns={campaigns} onCompose={() => setComposing(true)} onOpen={(id) => navigate(`/admin/email/campaigns/${id}`)} /> : tab === 'automations' ? <AutomationsView automations={automations} templates={templates} onRefresh={load} /> : tab === 'delivery' ? <DeliveryView /> : <TemplatesView templates={templates} onRefresh={load} />}</div>;
}
