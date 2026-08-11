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
  updateAdminE2EmailCampaign,
} from "../../lib/appApi";
import { friendlyErrorMessage, logAppError } from "../../lib/errors";
import { LoadingState } from "../LoadingState";
import "../../styles/admin-email.css";

const EMPTY_DRAFT = {
  internalName: "",
  audienceKind: "segment",
  userIds: [],
  segmentKey: "all_confirmed",
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

function IndividualEmailContext({ userId }) {
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
      {suppressions.length > 0 && <p className="admin-email-technical-warning">Technical suppression remains authoritative and cannot be bypassed here.</p>}
      <h3 id="application-email-history-title">Application email history</h3>
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
    </section>
  );
}

function ComposeView({ catalog, templates, initialUserIds, onComplete }) {
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

  const selectedSegment = catalog.segments?.find((item) => item.segment_key === draft.segmentKey);
  const canPreview = draft.audienceKind === "segment" ? Boolean(draft.segmentKey) && (!selectedSegment?.requires_module || draft.moduleId) : draft.userIds.length > 0;
  const validMessage = draft.internalName.trim() && draft.subject.trim() && draft.bodyText.trim()
    && (Boolean(draft.ctaLabel.trim()) === Boolean(draft.ctaUrl.trim()));

  function update(values) {
    setDraft((current) => ({ ...current, ...values }));
    setPreview(null);
    setFinalization(null);
  }

  function campaignPayload() {
    return {
      ...draft,
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
    if (result) setCampaign(result);
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

  return (
    <section className="admin-email-compose">
      <header className="admin-email-compose-heading"><div><button type="button" onClick={() => onComplete(null)}>Back to campaigns</button><h1>Compose email</h1></div>{campaign && <CampaignStatus value={campaign.status} />}</header>
      <ErrorNotice error={error} />
      <div className="admin-email-compose-grid">
        <div className="admin-email-compose-main">
          <fieldset className="admin-email-section"><legend>Audience</legend>
            <div className="admin-email-mode-options">
              {[['individual', 'Individual user'], ['selected', 'Selected users'], ['segment', 'Segment']].map(([value, label]) => (
                <label key={value}><input checked={draft.audienceKind === value} name="audience-mode" onChange={() => update({ audienceKind: value, userIds: value === "segment" ? [] : draft.userIds, category: value === "individual" ? draft.category : "engagement" })} type="radio" />{label}</label>
              ))}
            </div>
            {draft.audienceKind === "segment" ? (
              <div className="admin-email-field-row">
                <label><span>Audience segment</span><select value={draft.segmentKey} onChange={(event) => update({ segmentKey: event.target.value, moduleId: "" })}>{(catalog.segments || []).map((item) => <option key={item.segment_key} value={item.segment_key}>{item.name}</option>)}</select></label>
                {selectedSegment?.requires_module && <label><span>Module</span><select value={draft.moduleId} onChange={(event) => update({ moduleId: event.target.value })}><option value="">Choose module</option>{(catalog.modules || []).map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</select></label>}
              </div>
            ) : <UserPicker mode={draft.audienceKind} selectedIds={draft.userIds} onChange={(userIds) => update({ userIds })} />}
            {draft.audienceKind === "individual" && draft.userIds[0] && <IndividualEmailContext key={draft.userIds[0]} userId={draft.userIds[0]} />}
            {draft.audienceKind === "individual" && <label className="admin-email-category"><span>Message category</span><select value={draft.category} onChange={(event) => update({ category: event.target.value })}><option value="support">Support</option><option value="engagement">Engagement</option></select><small>Support is for individual service or account communication, not promotional messaging.</small></label>}
            <button disabled={busy || !canPreview} type="button" onClick={handlePreview}>Preview audience</button>
          </fieldset>
          <AudiencePreview preview={preview} />
          <fieldset className="admin-email-section"><legend>Message</legend>
            <div className="admin-email-field-row">
              <label><span>Campaign name</span><input maxLength={160} value={draft.internalName} onChange={(event) => update({ internalName: event.target.value })} /></label>
              <label><span>Template</span><select value={draft.templateId} onChange={(event) => chooseTemplate(event.target.value)}><option value="">Custom message</option>{templates.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            </div>
            <label><span>Subject</span><input maxLength={160} value={draft.subject} onChange={(event) => update({ subject: event.target.value })} /></label>
            <label><span>Preheader <small>Optional</small></span><input maxLength={200} value={draft.preheader} onChange={(event) => update({ preheader: event.target.value })} /></label>
            <label><span>Body</span><textarea maxLength={5000} rows={10} value={draft.bodyText} onChange={(event) => update({ bodyText: event.target.value })} /></label>
            <p className="admin-email-helper">Use {"{{first_name}}"} for the candidate&apos;s first name.</p>
            <div className="admin-email-field-row"><label><span>CTA label <small>Optional</small></span><input maxLength={80} value={draft.ctaLabel} onChange={(event) => update({ ctaLabel: event.target.value })} /></label><label><span>CTA HTTPS URL <small>Optional</small></span><input type="url" value={draft.ctaUrl} onChange={(event) => update({ ctaUrl: event.target.value })} /></label></div>
          </fieldset>
        </div>
        <aside className="admin-email-send-panel">
          <h2>Preview and queue</h2>
          <p>Production recipients are rechecked and queued through Email Core.</p>
          <div className="admin-email-test-state"><span>Test</span><strong>{campaign?.test_status === "passed" && campaign?.test_valid ? "Passed" : campaign?.test_status === "failed" ? "Failed" : "Pending"}</strong></div>
          {campaign?.test_error_message && <p className="admin-email-inline-error">{campaign.test_error_message}</p>}
          <button disabled={busy || !validMessage || !canPreview} type="button" onClick={saveDraft}>Save draft</button>
          <button disabled={busy || !validMessage || !canPreview} type="button" onClick={handleTest}>Send test to my email</button>
          <button className="is-primary" disabled={busy || !validMessage || !canPreview} type="button" onClick={handleFinalReview}>Review final audience</button>
          {finalization && <div className="admin-email-final-confirm" role="group" aria-label="Final campaign confirmation"><h3>Queue this email?</h3><dl><div><dt>Eligible now</dt><dd>{finalization.eligible}</dd></div><div><dt>Excluded</dt><dd>{finalization.excluded}</dd></div><div><dt>Subject</dt><dd>{finalization.subject}</dd></div></dl>{!finalization.test_valid && <p>A successful test is required for this exact campaign.</p>}<button className="is-primary" disabled={busy || !finalization.test_valid} type="button" onClick={handleQueue}>Queue {finalization.eligible} email{Number(finalization.eligible) === 1 ? "" : "s"}</button></div>}
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

export function AdminEmailCenter() {
  const location = useLocation(); const navigate = useNavigate(); const { campaignId } = useParams();
  const [tab, setTab] = useState("campaigns"); const [composing, setComposing] = useState(Boolean(location.state?.emailUserIds?.length));
  const [campaigns, setCampaigns] = useState([]); const [templates, setTemplates] = useState([]); const [catalog, setCatalog] = useState({ segments: [], modules: [] }); const [loading, setLoading] = useState(true);
  const initialUserIds = useMemo(() => location.state?.emailUserIds || [], [location.state]);
  async function load() { setLoading(true); try { const [nextCampaigns, nextTemplates, nextCatalog] = await Promise.all([getAdminEmailCampaigns(50), getAdminEmailTemplates(), getAdminEmailAudienceCatalog()]); setCampaigns(nextCampaigns); setTemplates(nextTemplates); setCatalog(nextCatalog); } finally { setLoading(false); } }
  useEffect(() => {
    let current = true;
    Promise.all([getAdminEmailCampaigns(50), getAdminEmailTemplates(), getAdminEmailAudienceCatalog()])
      .then(([nextCampaigns, nextTemplates, nextCatalog]) => {
        if (current) { setCampaigns(nextCampaigns); setTemplates(nextTemplates); setCatalog(nextCatalog); }
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, []);
  if (campaignId) return <CampaignDetail campaignId={campaignId} onBack={() => navigate('/admin/email')} />;
  if (loading) return <LoadingState />;
  if (composing) return <ComposeView catalog={catalog} templates={templates} initialUserIds={initialUserIds} onComplete={(id) => { if (id) navigate(`/admin/email/campaigns/${id}`); else { setComposing(false); navigate('/admin/email', { replace: true }); } }} />;
  return <div className="admin-email-center"><nav className="admin-email-tabs" aria-label="Email sections">{[['campaigns','Campaigns'],['delivery','Delivery'],['templates','Templates']].map(([value,label]) => <button aria-current={tab === value ? 'page' : undefined} key={value} onClick={() => setTab(value)} type="button">{label}</button>)}</nav>{tab === 'campaigns' ? <CampaignsView campaigns={campaigns} onCompose={() => setComposing(true)} onOpen={(id) => navigate(`/admin/email/campaigns/${id}`)} /> : tab === 'delivery' ? <DeliveryView /> : <TemplatesView templates={templates} onRefresh={load} />}</div>;
}
