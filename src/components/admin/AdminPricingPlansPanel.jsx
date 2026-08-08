import { useMemo, useState } from "react";
import { formatModuleMoney } from "../../lib/pricing";

const DURATIONS = [1, 3, 6];

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

function roundUpKobo(amount, increment) {
  const safeIncrement = Math.max(Number(increment ?? 50000), 1);
  return Math.ceil(Math.max(Number(amount ?? 0), 0) / safeIncrement) * safeIncrement;
}

function generatedBundlePrice(plan, durationMonths) {
  if (plan?.plan_type !== "complete_bundle") return null;
  const moduleCount = Number(plan.current_available_module_count ?? 0);
  const monthlyPerModule = Number(plan.complete_bundle_monthly_price_per_module_kobo ?? 0);
  const listPriceKobo = moduleCount * monthlyPerModule * Number(durationMonths);
  if (durationMonths === 1) return { priceKobo: listPriceKobo, listPriceKobo };
  if (durationMonths === 3) {
    return {
      priceKobo: roundUpKobo(Math.floor(listPriceKobo * 0.86), plan.complete_bundle_rounding_increment_kobo),
      listPriceKobo,
    };
  }
  return {
    priceKobo: roundUpKobo(Math.floor(listPriceKobo * 0.735), plan.complete_bundle_rounding_increment_kobo),
    listPriceKobo,
  };
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

function buildDrafts(plans) {
  return plans.reduce((drafts, plan) => {
    drafts[plan.plan_code] = {
      plan: initialPlanDraft(plan),
      prices: DURATIONS.reduce((priceDrafts, duration) => {
        const price = plan.prices?.find((item) => Number(item.duration_months) === duration);
        priceDrafts[duration] = initialPriceDraft(price);
        return priceDrafts;
      }, {}),
    };
    return drafts;
  }, {});
}

export function AdminPricingPlansPanel({
  busy,
  loading,
  plans = [],
  onRefresh,
  onSavePlan,
  onSavePrice,
}) {
  const [drafts, setDrafts] = useState(() => buildDrafts(plans));
  const [savingKey, setSavingKey] = useState(null);

  const sortedPlans = useMemo(
    () => [...plans].sort((left, right) => Number(left.sort_order ?? 0) - Number(right.sort_order ?? 0)),
    [plans],
  );

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
          <p>Manage the plan names, support copy, visibility, and 1, 3, 6 month prices used at checkout.</p>
        </div>
        <button className="ghost-button" disabled={busy || loading} type="button" onClick={onRefresh}>
          {loading ? "Refreshing" : "Refresh"}
        </button>
      </header>

      {sortedPlans.length === 0 ? (
        <div className="admin-pricing-empty">
          <strong>No pricing plans found.</strong>
          <button className="ghost-button" disabled={busy || loading} type="button" onClick={onRefresh}>Refresh</button>
        </div>
      ) : (
        <div className="admin-pricing-plan-list">
          {sortedPlans.map((plan) => {
            const planDraft = drafts[plan.plan_code]?.plan ?? initialPlanDraft(plan);
            const isGeneratedBundle = plan.plan_type === "complete_bundle";

            return (
              <article className="admin-pricing-plan" key={plan.plan_code}>
                <form className="admin-pricing-plan-form" onSubmit={(event) => savePlan(event, plan)}>
                  <div className="admin-pricing-plan-title">
                    <span className={`admin-status ${plan.enabled ? "admin-status-live" : "admin-status-paused"}`}>
                      {plan.enabled ? "Enabled" : "Hidden"}
                    </span>
                    <h3>{plan.display_name || titleFromCode(plan.plan_code)}</h3>
                    <small>{plan.plan_code}</small>
                  </div>

                  <label>
                    Plan name
                    <input
                      maxLength="80"
                      minLength="2"
                      required
                      value={planDraft.displayName}
                      onChange={(event) => updatePlan(plan.plan_code, "displayName", event.target.value)}
                    />
                  </label>
                  <label>
                    Short description
                    <input
                      maxLength="240"
                      value={planDraft.shortDescription}
                      onChange={(event) => updatePlan(plan.plan_code, "shortDescription", event.target.value)}
                    />
                  </label>
                  <label>
                    Supporting text
                    <input
                      maxLength="320"
                      value={planDraft.supportingText}
                      onChange={(event) => updatePlan(plan.plan_code, "supportingText", event.target.value)}
                    />
                  </label>
                  <label>
                    Benefit bullets
                    <textarea
                      maxLength="720"
                      rows="4"
                      value={planDraft.includedBullets}
                      onChange={(event) => updatePlan(plan.plan_code, "includedBullets", event.target.value)}
                    />
                  </label>
                  <label>
                    Savings label
                    <input
                      maxLength="80"
                      value={planDraft.savingsLabel}
                      onChange={(event) => updatePlan(plan.plan_code, "savingsLabel", event.target.value)}
                    />
                  </label>
                  <label>
                    Button label
                    <input
                      maxLength="40"
                      minLength="2"
                      required
                      value={planDraft.ctaLabel}
                      onChange={(event) => updatePlan(plan.plan_code, "ctaLabel", event.target.value)}
                    />
                  </label>
                  <label>
                    Sort order
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
                      Visible
                    </label>
                    <label>
                      <input
                        checked={planDraft.featured}
                        type="checkbox"
                        onChange={(event) => updatePlan(plan.plan_code, "featured", event.target.checked)}
                      />
                      Featured
                    </label>
                  </div>

                  <div className="admin-pricing-plan-actions">
                    <button disabled={busy || savingKey === `${plan.plan_code}:plan`} type="submit">
                      {savingKey === `${plan.plan_code}:plan` ? "Saving" : "Save plan"}
                    </button>
                  </div>
                </form>

                <div className="admin-pricing-price-grid" aria-label={`${plan.display_name} prices`}>
                  {DURATIONS.map((duration) => {
                    const price = plan.prices?.find((item) => Number(item.duration_months) === duration);
                    const generated = generatedBundlePrice(plan, duration);
                    const priceDraft = drafts[plan.plan_code]?.prices?.[duration] ?? initialPriceDraft(price);
                    const visiblePriceKobo = generated?.priceKobo ?? price?.price_kobo;
                    const visibleListPriceKobo = generated?.listPriceKobo ?? price?.list_price_kobo;
                    const isSavingPrice = savingKey === `${plan.plan_code}:${duration}`;

                    return (
                      <section className="admin-pricing-price-row" key={duration}>
                        <div className="admin-pricing-duration">
                          <strong>{duration} month{duration > 1 ? "s" : ""}</strong>
                          <span>{price?.generated_by_rule || isGeneratedBundle ? "Generated" : price?.enabled ? "Enabled" : "Hidden"}</span>
                        </div>

                        {isGeneratedBundle ? (
                          <div className="admin-pricing-generated">
                            <strong>{formatModuleMoney(visiblePriceKobo, price?.currency)}</strong>
                            {Number(visibleListPriceKobo) > Number(visiblePriceKobo) && (
                              <small>{formatModuleMoney(visibleListPriceKobo, price?.currency)} list</small>
                            )}
                            <small>{Number(plan.current_available_module_count ?? 0)} active modules</small>
                          </div>
                        ) : (
                          <>
                            <label>
                              Price (NGN)
                              <input
                                min="1"
                                step="500"
                                type="number"
                                value={priceDraft.price}
                                onChange={(event) => updatePrice(plan.plan_code, duration, "price", event.target.value)}
                              />
                            </label>
                            <label>
                              List price
                              <input
                                min="1"
                                step="500"
                                type="number"
                                value={priceDraft.listPrice}
                                onChange={(event) => updatePrice(plan.plan_code, duration, "listPrice", event.target.value)}
                              />
                            </label>
                            <label>
                              Discount label
                              <input
                                maxLength="80"
                                value={priceDraft.discountLabel}
                                onChange={(event) => updatePrice(plan.plan_code, duration, "discountLabel", event.target.value)}
                              />
                            </label>
                            <label className="admin-pricing-price-enabled">
                              <input
                                checked={priceDraft.enabled}
                                type="checkbox"
                                onChange={(event) => updatePrice(plan.plan_code, duration, "enabled", event.target.checked)}
                              />
                              Enabled
                            </label>
                            <button
                              className="ghost-button"
                              disabled={busy || isSavingPrice}
                              type="button"
                              onClick={() => savePrice(plan, duration)}
                            >
                              {isSavingPrice ? "Saving" : "Save price"}
                            </button>
                          </>
                        )}
                      </section>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
