import { useMemo, useState } from "react";
import { formatModuleMoney } from "../../lib/pricing";
import { calculatePricingGuidance } from "../../lib/pricingGuidance";

function toNairaInput(kobo) {
  if (kobo == null || kobo === "") return "";
  const amount = Number(kobo);
  return Number.isFinite(amount) ? String(amount / 100) : "";
}

function toKobo(value) {
  if (value === "" || value == null) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

function normalizeBullets(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("\n");
  return "";
}

function splitBullets(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function titleFromCode(code) {
  return String(code ?? "")
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function formatPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return `${number.toFixed(Math.abs(number) < 10 && number % 1 !== 0 ? 1 : 0)}%`;
}

function initialPlanDraft(plan) {
  return {
    displayName: plan?.display_name ?? "",
    shortDescription: plan?.short_description ?? "",
    supportingText: plan?.supporting_text ?? "",
    includedBullets: normalizeBullets(plan?.included_bullets),
    savingsLabel: plan?.savings_label ?? "",
    ctaLabel: plan?.cta_label ?? "Continue",
    featured: Boolean(plan?.featured),
    sortOrder: String(plan?.sort_order ?? 100),
    enabled: Boolean(plan?.enabled),
  };
}

function initialPriceDraft(price) {
  return {
    price: toNairaInput(price?.price_kobo),
    listPrice: toNairaInput(price?.list_price_kobo ?? price?.price_kobo),
    discountLabel: price?.discount_label ?? "",
    enabled: Boolean(price?.enabled),
  };
}

function buildDrafts(plans, durations) {
  return plans.reduce((drafts, plan) => {
    drafts[plan.plan_code] = {
      plan: initialPlanDraft(plan),
      prices: durations.reduce((priceDrafts, duration) => {
        const months = Number(duration.months);
        const price = plan.prices?.find((item) => Number(item.duration_months) === months);
        priceDrafts[months] = initialPriceDraft(price);
        return priceDrafts;
      }, {}),
    };
    return drafts;
  }, {});
}

export function AdminPricingPlansPanel({
  busy,
  durations = [],
  guidance = [],
  loading,
  plans = [],
  onCreateDuration,
  onRefresh,
  onSavePlan,
  onSavePrice,
  onUpdateDuration,
}) {
  const [drafts, setDrafts] = useState(() => buildDrafts(plans, durations));
  const [durationDrafts, setDurationDrafts] = useState(() => durations.reduce((result, duration) => ({
    ...result,
    [duration.months]: {
      enabled: Boolean(duration.enabled),
      sortOrder: String(duration.sort_order ?? 100),
    },
  }), {}));
  const [newDurationMonths, setNewDurationMonths] = useState("");
  const [customDiscounts, setCustomDiscounts] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [expandedPlanCode, setExpandedPlanCode] = useState(null);

  const sortedPlans = useMemo(
    () => [...plans].sort((left, right) => Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0)),
    [plans],
  );
  const sortedDurations = useMemo(
    () => [...durations].sort((left, right) => Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0)),
    [durations],
  );

  const enabledCount = sortedPlans.filter((plan) => plan.enabled).length;
  const enabledDurationLabel = sortedDurations
    .filter((duration) => duration.enabled)
    .map((duration) => `${duration.months} month${Number(duration.months) === 1 ? "" : "s"}`)
    .join(", ");

  function updatePlan(planCode, field, value) {
    setDrafts((current) => ({
      ...current,
      [planCode]: {
        ...current[planCode],
        plan: { ...current[planCode]?.plan, [field]: value },
      },
    }));
  }

  function updatePrice(planCode, duration, field, value) {
    setDrafts((current) => ({
      ...current,
      [planCode]: {
        ...current[planCode],
        prices: {
          ...current[planCode]?.prices,
          [duration]: { ...current[planCode]?.prices?.[duration], [field]: value },
        },
      },
    }));
  }

  function updateDuration(months, field, value) {
    setDurationDrafts((current) => ({
      ...current,
      [months]: { ...current[months], [field]: value },
    }));
  }

  function updateCustomDiscount(planCode, months, value) {
    setCustomDiscounts((current) => ({
      ...current,
      [`${planCode}:${months}`]: value,
    }));
  }

  function applyRecommendedPrice(planCode, months, priceKobo) {
    if (!Number.isFinite(Number(priceKobo)) || Number(priceKobo) <= 0) return;
    updatePrice(planCode, months, "price", toNairaInput(priceKobo));
  }

  async function createDuration(event) {
    event.preventDefault();
    const months = Number(newDurationMonths);
    setSavingKey("duration:new");
    try {
      await onCreateDuration({ months, sortOrder: (sortedDurations.length + 1) * 10 });
      setNewDurationMonths("");
    } catch {
      // The parent admin shell reports the actionable error in the shared feedback area.
    } finally {
      setSavingKey(null);
    }
  }

  async function saveDuration(duration) {
    const draft = durationDrafts[duration.months];
    if (!draft) return;
    setSavingKey(`duration:${duration.months}`);
    try {
      await onUpdateDuration({
        months: Number(duration.months),
        enabled: draft.enabled,
        sortOrder: Number(draft.sortOrder),
      });
    } catch {
      // The parent admin shell reports the actionable error in the shared feedback area.
    } finally {
      setSavingKey(null);
    }
  }

  async function savePlan(event, plan) {
    event.preventDefault();
    const draft = drafts[plan.plan_code]?.plan;
    if (!draft) return;

    setSavingKey(`${plan.plan_code}:plan`);
    try {
      await onSavePlan({
        planCode: plan.plan_code,
        displayName: draft.displayName.trim(),
        shortDescription: draft.shortDescription.trim(),
        supportingText: draft.supportingText.trim(),
        includedBullets: splitBullets(draft.includedBullets),
        savingsLabel: draft.savingsLabel.trim(),
        ctaLabel: draft.ctaLabel.trim(),
        featured: draft.featured,
        sortOrder: Number(draft.sortOrder),
        enabled: draft.enabled,
      });
    } catch {
      // The parent admin shell reports the actionable error in the shared feedback area.
    } finally {
      setSavingKey(null);
    }
  }

  async function savePrice(plan, duration) {
    const draft = drafts[plan.plan_code]?.prices?.[duration];
    if (!draft) return;
    const priceKobo = toKobo(draft.price);
    const listPriceKobo = toKobo(draft.listPrice);

    setSavingKey(`${plan.plan_code}:${duration}`);
    try {
      await onSavePrice({
        planCode: plan.plan_code,
        durationMonths: duration,
        priceKobo,
        listPriceKobo,
        discountLabel: draft.discountLabel.trim(),
        enabled: draft.enabled,
      });
    } catch {
      // The parent admin shell reports the actionable error in the shared feedback area.
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <section className="admin-pricing-plans" aria-labelledby="admin-pricing-plans-title">
      <header className="admin-pricing-plans-header">
        <div>
          <h2 id="admin-pricing-plans-title">Pricing plans</h2>
          <p>{enabledCount} enabled plans{enabledDurationLabel ? ` · ${enabledDurationLabel}` : ""}</p>
        </div>
        <div className="admin-pricing-header-actions">
          {expanded && (
            <button className="ghost-button" disabled={busy || loading} type="button" onClick={onRefresh}>
              {loading ? "Refreshing" : "Refresh"}
            </button>
          )}
          <button
            className="ghost-button"
            type="button"
            aria-expanded={expanded}
            aria-controls="admin-pricing-plans-body"
            onClick={() => {
              setExpanded((current) => !current);
              setExpandedPlanCode(null);
            }}
          >
            {expanded ? "Close" : "Open"}
          </button>
        </div>
      </header>

      {!expanded ? null : (
        <div className="admin-pricing-plans-body" id="admin-pricing-plans-body">
          <section className="admin-pricing-durations" aria-labelledby="admin-pricing-durations-title">
            <div className="admin-pricing-durations-heading">
              <div>
                <h3 id="admin-pricing-durations-title">Access durations</h3>
                <p>Enabled durations appear in new checkout. Historical purchases remain unchanged.</p>
              </div>
              <form className="admin-pricing-duration-add" onSubmit={createDuration}>
                <label>
                  <span>Calendar months</span>
                  <input
                    min="1"
                    required
                    step="1"
                    type="number"
                    value={newDurationMonths}
                    onChange={(event) => setNewDurationMonths(event.target.value)}
                  />
                </label>
                <button disabled={busy || savingKey === "duration:new"} type="submit">
                  {savingKey === "duration:new" ? "Adding" : "Add duration"}
                </button>
              </form>
            </div>

            <div className="admin-pricing-duration-list">
              {sortedDurations.map((duration) => {
                const draft = durationDrafts[duration.months] ?? {
                  enabled: Boolean(duration.enabled),
                  sortOrder: String(duration.sort_order ?? 100),
                };
                const saving = savingKey === `duration:${duration.months}`;
                return (
                  <div className="admin-pricing-duration-config" key={duration.duration_id ?? duration.months}>
                    <div>
                      <strong>{duration.months} month{Number(duration.months) === 1 ? "" : "s"}</strong>
                      <small>{duration.used_by_orders ? "Used by historical orders" : "Not yet used by an order"}</small>
                    </div>
                    <label>
                      <span>Order</span>
                      <input
                        step="1"
                        type="number"
                        value={draft.sortOrder}
                        onChange={(event) => updateDuration(duration.months, "sortOrder", event.target.value)}
                      />
                    </label>
                    <label className="admin-pricing-price-enabled">
                      <input
                        checked={draft.enabled}
                        type="checkbox"
                        onChange={(event) => updateDuration(duration.months, "enabled", event.target.checked)}
                      />
                      Enabled
                    </label>
                    <button
                      className="ghost-button"
                      disabled={busy || saving}
                      type="button"
                      onClick={() => saveDuration(duration)}
                    >
                      {saving ? "Saving" : "Save"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {sortedPlans.length === 0 ? (
            <div className="admin-pricing-empty">
              <strong>No pricing plans found.</strong>
              <button className="ghost-button" disabled={busy || loading} type="button" onClick={onRefresh}>Refresh</button>
            </div>
          ) : (
        <div className="admin-pricing-plan-list">
          {sortedPlans.map((plan) => {
            const planDraft = drafts[plan.plan_code]?.plan ?? initialPlanDraft(plan);
            const isPlanExpanded = expandedPlanCode === plan.plan_code;
            const priceSummary = sortedDurations.map((duration) => {
              const months = Number(duration.months);
              const price = plan.prices?.find((item) => Number(item.duration_months) === months);
              return price?.price_kobo == null
                ? `${months}m unavailable`
                : `${months}m ${formatModuleMoney(price.price_kobo, price.currency)}`;
            });
            const previewBullets = splitBullets(planDraft.includedBullets);

            return (
              <article className={`admin-pricing-plan${isPlanExpanded ? " is-expanded" : ""}`} key={plan.plan_code}>
                <button
                  className="admin-pricing-plan-summary"
                  type="button"
                  aria-expanded={isPlanExpanded}
                  onClick={() => setExpandedPlanCode((current) => (current === plan.plan_code ? null : plan.plan_code))}
                >
                  <span className="admin-pricing-plan-title">
                    <span className={`admin-status ${plan.enabled ? "admin-status-live" : "admin-status-paused"}`}>
                      {plan.enabled ? "Enabled" : "Hidden"}
                    </span>
                    <span>
                      <strong>{plan.display_name || titleFromCode(plan.plan_code)}</strong>
                      <small>{plan.plan_code}</small>
                    </span>
                  </span>
                  <span className="admin-pricing-plan-summary-prices">{priceSummary.join(" · ")}</span>
                  <span className="admin-pricing-plan-expand">{isPlanExpanded ? "Close" : "Edit"}</span>
                </button>

                {isPlanExpanded && (
                  <>
                    <form className="admin-pricing-plan-form" onSubmit={(event) => savePlan(event, plan)}>
                  <aside className="admin-pricing-copy-preview" aria-label={`${plan.display_name} candidate preview`}>
                    {planDraft.savingsLabel && <span>{planDraft.savingsLabel}</span>}
                    <strong>{planDraft.displayName || "Plan card title"}</strong>
                    {planDraft.shortDescription && <p>{planDraft.shortDescription}</p>}
                    {planDraft.supportingText && <small>{planDraft.supportingText}</small>}
                    {previewBullets.length > 0 && (
                      <ul>
                        {previewBullets.slice(0, 4).map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    )}
                    <button type="button" tabIndex="-1">{planDraft.ctaLabel || "Button text"}</button>
                  </aside>

                  <label className="admin-pricing-field-wide">
                    <span className="admin-pricing-field-heading">
                      <strong>Plan card title</strong>
                      <small>Main heading candidates see when choosing access.</small>
                    </span>
                    <input
                      maxLength="80"
                      minLength="2"
                      required
                      value={planDraft.displayName}
                      onChange={(event) => updatePlan(plan.plan_code, "displayName", event.target.value)}
                    />
                  </label>
                  <label className="admin-pricing-field-wide">
                    <span className="admin-pricing-field-heading">
                      <strong>Subtitle</strong>
                      <small>One short sentence under the title.</small>
                    </span>
                    <input
                      maxLength="240"
                      value={planDraft.shortDescription}
                      onChange={(event) => updatePlan(plan.plan_code, "shortDescription", event.target.value)}
                    />
                  </label>
                  <label className="admin-pricing-field-wide">
                    <span className="admin-pricing-field-heading">
                      <strong>Helper line</strong>
                      <small>Extra reassurance below the subtitle. Use it for value or fit.</small>
                    </span>
                    <input
                      maxLength="320"
                      value={planDraft.supportingText}
                      onChange={(event) => updatePlan(plan.plan_code, "supportingText", event.target.value)}
                    />
                  </label>
                  <label className="admin-pricing-field-wide">
                    <span className="admin-pricing-field-heading">
                      <strong>Included lines</strong>
                      <small>One benefit per line. These appear as the plan checklist.</small>
                    </span>
                    <textarea
                      maxLength="720"
                      rows="3"
                      value={planDraft.includedBullets}
                      onChange={(event) => updatePlan(plan.plan_code, "includedBullets", event.target.value)}
                    />
                  </label>
                  <label>
                    <span className="admin-pricing-field-heading">
                      <strong>Badge text</strong>
                      <small>Optional small label, like “Best value”. Leave blank if not useful.</small>
                    </span>
                    <input
                      maxLength="80"
                      value={planDraft.savingsLabel}
                      onChange={(event) => updatePlan(plan.plan_code, "savingsLabel", event.target.value)}
                    />
                  </label>
                  <label>
                    <span className="admin-pricing-field-heading">
                      <strong>Button text</strong>
                      <small>The action button shown on this plan.</small>
                    </span>
                    <input
                      maxLength="40"
                      minLength="2"
                      required
                      value={planDraft.ctaLabel}
                      onChange={(event) => updatePlan(plan.plan_code, "ctaLabel", event.target.value)}
                    />
                  </label>
                  <label className="admin-pricing-field-small">
                    <span className="admin-pricing-field-heading">
                      <strong>Display order</strong>
                      <small>Lower numbers appear first.</small>
                    </span>
                    <input
                      type="number"
                      step="1"
                      value={planDraft.sortOrder}
                      onChange={(event) => updatePlan(plan.plan_code, "sortOrder", event.target.value)}
                    />
                  </label>

                  <div className="admin-pricing-plan-toggles">
                    <label>
                      <input
                        checked={planDraft.enabled}
                        type="checkbox"
                        onChange={(event) => updatePlan(plan.plan_code, "enabled", event.target.checked)}
                      />
                      <span><strong>Visible</strong><small>Show this plan to candidates.</small></span>
                    </label>
                    <label>
                      <input
                        checked={planDraft.featured}
                        type="checkbox"
                        onChange={(event) => updatePlan(plan.plan_code, "featured", event.target.checked)}
                      />
                      <span><strong>Highlight</strong><small>Give this plan extra emphasis.</small></span>
                    </label>
                  </div>

                  <div className="admin-pricing-plan-actions">
                    <button disabled={busy || savingKey === `${plan.plan_code}:plan`} type="submit">
                      {savingKey === `${plan.plan_code}:plan` ? "Saving" : "Save plan"}
                    </button>
                  </div>
                    </form>

                    <div className="admin-pricing-price-grid" aria-label={`${plan.display_name} prices`}>
                  {sortedDurations.map((duration) => {
                    const months = Number(duration.months);
                    const price = plan.prices?.find((item) => Number(item.duration_months) === months);
                    const priceDraft = drafts[plan.plan_code]?.prices?.[months] ?? initialPriceDraft(price);
                    const isSavingPrice = savingKey === `${plan.plan_code}:${months}`;
                    const guidanceKey = `${plan.plan_code}:${months}`;
                    const serverGuidance = guidance.find((item) => (
                      item.plan_code === plan.plan_code
                      && Number(item.duration_months) === months
                    ));
                    const hasConfiguredRecommendation = serverGuidance?.recommended_discount_bps != null;
                    const customDiscount = customDiscounts[guidanceKey] ?? "";
                    const recommendation = hasConfiguredRecommendation
                      ? {
                          discountPercent: Number(serverGuidance.recommended_discount_bps) / 100,
                          priceKobo: Number(serverGuidance.recommended_price_kobo),
                        }
                      : {
                          discountPercent: customDiscount === "" ? null : Number(customDiscount),
                          priceKobo: calculatePricingGuidance({
                            discountPercent: customDiscount === "" ? Number.NaN : Number(customDiscount),
                            durationMonths: months,
                            oneMonthPriceKobo: serverGuidance?.one_month_price_kobo,
                          })?.recommendedPriceKobo ?? null,
                        };
                    const actualPriceKobo = toKobo(priceDraft.price);
                    const actualGuidance = calculatePricingGuidance({
                      actualPriceKobo,
                      discountPercent: 0,
                      durationMonths: months,
                      oneMonthPriceKobo: serverGuidance?.one_month_price_kobo,
                    });
                    const actualMatchesRecommendation = actualPriceKobo != null
                      && recommendation.priceKobo != null
                      && actualPriceKobo === recommendation.priceKobo;
                    const currency = serverGuidance?.currency || price?.currency || "NGN";

                    return (
                      <section className="admin-pricing-price-row" key={duration.duration_id ?? months}>
                        <div className="admin-pricing-price-heading">
                          <div className="admin-pricing-duration">
                            <strong>{months} month{months === 1 ? "" : "s"}</strong>
                            <span>{duration.enabled ? (price?.enabled ? "Customer-visible" : "Price hidden") : "Duration disabled"}</span>
                          </div>
                          {plan.plan_type === "complete_bundle" && (
                            <small>{Number(serverGuidance?.current_available_module_count ?? 0)} currently purchasable modules</small>
                          )}
                        </div>
                        <dl className="admin-pricing-guidance">
                          <div>
                            <dt>1-month price</dt>
                            <dd>{formatModuleMoney(serverGuidance?.one_month_price_kobo, currency)}</dd>
                          </div>
                          <div>
                            <dt>{months}-month full total</dt>
                            <dd>{formatModuleMoney(serverGuidance?.full_monthly_total_kobo, currency)}</dd>
                          </div>
                          <div>
                            <dt>Recommended saving</dt>
                            <dd>
                              {hasConfiguredRecommendation ? (
                                `~${formatPercent(recommendation.discountPercent)}`
                              ) : (
                                <label className="admin-pricing-discount-input">
                                  <span className="sr-only">Recommended saving for {plan.display_name}, {months} months</span>
                                  <input
                                    max="99"
                                    min="0"
                                    placeholder="Set %"
                                    step="0.5"
                                    type="number"
                                    value={customDiscount}
                                    onChange={(event) => updateCustomDiscount(plan.plan_code, months, event.target.value)}
                                  />
                                  <span>%</span>
                                </label>
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>Recommended price</dt>
                            <dd>{recommendation.priceKobo == null ? "Choose a saving" : formatModuleMoney(recommendation.priceKobo, currency)}</dd>
                          </div>
                        </dl>
                        <label className="admin-pricing-selling-price">
                          {plan.plan_type === "complete_bundle"
                            ? `Selling price for ${Number(plan.current_available_module_count ?? 0)} available modules (NGN)`
                            : "Selling price (NGN)"}
                          <input
                            min="1"
                            step="500"
                            type="number"
                            value={priceDraft.price}
                            onChange={(event) => updatePrice(plan.plan_code, months, "price", event.target.value)}
                          />
                          <small>
                            {actualPriceKobo == null
                              ? "Enter the price future checkout should use."
                              : actualMatchesRecommendation
                                ? "Matches recommendation"
                                : recommendation.priceKobo != null
                                  ? `Custom price · Recommended ${formatModuleMoney(recommendation.priceKobo, currency)}`
                                  : "Custom price"}
                          </small>
                        </label>
                        <div className="admin-pricing-actual-saving">
                          <span>Actual saving</span>
                          <strong>
                            {actualGuidance?.actualSavingKobo == null
                              ? "Not set"
                              : `${formatModuleMoney(actualGuidance.actualSavingKobo, currency)} (${formatPercent(actualGuidance.actualSavingPercent)})`}
                          </strong>
                          {plan.plan_type === "complete_bundle" && <small>Guidance updates when available modules change. Your saved price remains separate.</small>}
                        </div>
                        <label className="admin-pricing-price-enabled">
                          <input
                            checked={priceDraft.enabled}
                            type="checkbox"
                            onChange={(event) => updatePrice(plan.plan_code, months, "enabled", event.target.checked)}
                          />
                          Price enabled
                        </label>
                        <div className="admin-pricing-price-actions">
                          <button
                            className="ghost-button"
                            disabled={busy || recommendation.priceKobo == null}
                            type="button"
                            onClick={() => applyRecommendedPrice(plan.plan_code, months, recommendation.priceKobo)}
                          >
                            Use recommended
                          </button>
                          <button
                            className="ghost-button"
                            disabled={busy || isSavingPrice}
                            type="button"
                            onClick={() => savePrice(plan, months)}
                          >
                            {isSavingPrice ? "Saving" : "Save price"}
                          </button>
                        </div>
                      </section>
                    );
                  })}
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
          )}
        </div>
      )}
    </section>
  );
}
