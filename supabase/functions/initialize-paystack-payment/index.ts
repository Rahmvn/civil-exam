import {
  corsHeaders,
  getRequestErrorStatus,
  jsonResponse,
  readJsonBody,
  requireEnv,
} from "../_shared/http.ts";
import { getPaymentCallbackUrl } from "../_shared/payment-callback.js";
import { getPaystackEnvironment } from "../_shared/payment-validation.js";
import {
  enforceEdgeRateLimit,
  getActiveModuleAccess,
  getActivePack,
  getAdminClient,
  getAuthedUser,
  getModuleOffering,
  getPaystackTransactionStatus,
  isFinalUnsuccessfulPaystackPayment,
  recordModulePaymentStatus,
} from "../_shared/paystack.ts";
import { sanitizePaymentPayload } from "../_shared/payment-sanitization.js";

const CHECKOUT_RECHECK_AFTER_MS = 30 * 60 * 1000;
const SUBJECT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CheckoutItem = {
  offering: Record<string, unknown>;
  subject: Record<string, unknown>;
};

type PricingPlanCheckout = {
  amountKobo: number;
  listPriceKobo: number;
  catalogModuleCount: number;
  checkoutKey: string;
  currency: string;
  durationMonths: number;
  items: CheckoutItem[];
  plan: Record<string, unknown>;
  purchaseLabel: string;
  purchaseSnapshot: Record<string, unknown>;
};

function readSubjectSlugs(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) {
    throw new Error("Choose the modules included in this bundle");
  }

  const slugs = value.map((item) => String(item ?? "").trim());
  if (slugs.some((slug) => slug.length > 80 || !SUBJECT_SLUG_PATTERN.test(slug))) {
    throw new Error("One of the selected modules is invalid");
  }
  if (new Set(slugs).size !== slugs.length) {
    throw new Error("Choose each module only once");
  }
  return slugs.sort();
}

function readDurationMonths(value: unknown) {
  const durationMonths = Number(value);
  if (![1, 3, 6].includes(durationMonths)) {
    throw new Error("Choose a supported access duration");
  }
  return durationMonths;
}

function roundPriceKobo(amountKobo: number, incrementKobo = 50_000) {
  const increment = Number.isFinite(incrementKobo) && incrementKobo > 0 ? incrementKobo : 50_000;
  return Math.ceil(Math.max(0, amountKobo) / increment) * increment;
}

function getCompleteBundlePriceKobo(moduleCount: number, monthlyPerModuleKobo: number, durationMonths: number, roundingIncrementKobo: number) {
  const monthlyPrice = moduleCount * monthlyPerModuleKobo;
  if (durationMonths === 1) return monthlyPrice;
  if (durationMonths === 3) return roundPriceKobo(Math.floor(monthlyPrice * 3 * 0.86), roundingIncrementKobo);
  if (durationMonths === 6) return roundPriceKobo(Math.floor(monthlyPrice * 6 * 0.735), roundingIncrementKobo);
  throw new Error("Choose a supported access duration");
}

async function getPricingPlanCheckout(
  adminClient: ReturnType<typeof getAdminClient>,
  pack: Record<string, unknown>,
  planCode: string,
  requestedDurationMonths: unknown,
  requestedSubjectSlugs: unknown,
): Promise<PricingPlanCheckout> {
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(planCode)) {
    throw new Error("Choose a valid pricing plan");
  }

  const durationMonths = readDurationMonths(requestedDurationMonths);
  const { data: plan, error: planError } = await adminClient
    .from("purchase_plans")
    .select("id, code, plan_type, display_name, module_count, module_practice_type, complete_bundle_monthly_price_per_module_kobo, complete_bundle_rounding_increment_kobo, enabled")
    .eq("code", planCode)
    .maybeSingle();

  if (planError) throw planError;
  if (!plan?.enabled) throw new Error("This pricing plan is not currently available");

  const { data: price, error: priceError } = await adminClient
    .from("purchase_plan_prices")
    .select("duration_months, price_kobo, list_price_kobo, currency, generated_by_rule, enabled")
    .eq("purchase_plan_id", plan.id)
    .eq("duration_months", durationMonths)
    .maybeSingle();

  if (priceError) throw priceError;
  if (!price?.enabled) throw new Error("This access duration is not currently available");

  let subjectSlugs: string[];
  if (plan.plan_type === "complete_bundle") {
    const { data: subjects, error: subjectError } = await adminClient
      .from("subjects")
      .select("slug")
      .eq("is_active", true)
      .eq("lifecycle_status", "active")
      .eq("candidate_availability", "available")
      .order("sort_order")
      .order("name");
    if (subjectError) throw subjectError;
    subjectSlugs = (subjects ?? []).map((subject) => subject.slug);
  } else {
    subjectSlugs = readSubjectSlugs(requestedSubjectSlugs);
  }

  if (plan.plan_type === "single_module" && subjectSlugs.length !== 1) {
    throw new Error("Choose exactly one module for this plan");
  }
  if (plan.plan_type === "pick_n_modules" && subjectSlugs.length !== Number(plan.module_count)) {
    throw new Error(`Choose exactly ${plan.module_count} modules for this bundle`);
  }

  const itemResults = await Promise.all(subjectSlugs.map(async (subjectSlug) => {
    try {
      return await getModuleOffering(adminClient, String(pack.id), subjectSlug);
    } catch (error) {
      if (plan.plan_type !== "complete_bundle") throw error;
      return null;
    }
  }));
  const items = itemResults.filter(Boolean) as CheckoutItem[];

  if (plan.plan_type === "complete_bundle" && items.length === 0) {
    throw new Error("No modules are currently available for this bundle");
  }
  if (plan.plan_type === "single_module") {
    const practiceType = String(items[0]?.subject?.practice_type ?? "");
    if (practiceType !== String(plan.module_practice_type)) {
      throw new Error("Choose a module that matches this pricing plan");
    }
  }

  const catalogModuleCount = plan.plan_type === "complete_bundle" ? items.length : Number(plan.module_count ?? items.length);
  const amountKobo = plan.plan_type === "complete_bundle"
    ? getCompleteBundlePriceKobo(
      items.length,
      Number(plan.complete_bundle_monthly_price_per_module_kobo),
      durationMonths,
      Number(plan.complete_bundle_rounding_increment_kobo),
    )
    : Number(price.price_kobo);
  const listPriceKobo = plan.plan_type === "complete_bundle"
    ? items.length * Number(plan.complete_bundle_monthly_price_per_module_kobo) * durationMonths
    : Number(price.list_price_kobo ?? price.price_kobo);

  if (!Number.isInteger(amountKobo) || amountKobo <= 0) {
    throw new Error("This pricing plan does not have a valid price");
  }

  const sortedSubjectIds = items.map((item) => String(item.subject.id)).sort();
  const purchaseLabel = `${plan.display_name} - ${durationMonths} month${durationMonths === 1 ? "" : "s"}`;
  const modules = items.map((item) => ({
    subject_id: item.subject.id,
    subject_name: item.subject.name,
    subject_slug: item.subject.slug,
    practice_type: item.subject.practice_type,
  }));

  return {
    amountKobo,
    listPriceKobo,
    catalogModuleCount,
    checkoutKey: `plan:${plan.code}:${durationMonths}:${sortedSubjectIds.join(":")}`,
    currency: String(price.currency ?? "NGN"),
    durationMonths,
    items,
    plan,
    purchaseLabel,
    purchaseSnapshot: {
      plan_code: plan.code,
      plan_name: plan.display_name,
      plan_type: plan.plan_type,
      duration_months: durationMonths,
      price_kobo: amountKobo,
      list_price_kobo: listPriceKobo,
      currency: String(price.currency ?? "NGN"),
      module_count: items.length,
      catalog_module_count: catalogModuleCount,
      modules,
    },
  };
}

async function getBundleCheckout(
  adminClient: ReturnType<typeof getAdminClient>,
  userId: string,
  pack: Record<string, unknown>,
  offerId: string,
  requestedSubjectSlugs: unknown,
) {
  if (!UUID_PATTERN.test(offerId)) throw new Error("Choose a valid bundle offer");

  const { data: offer, error: offerError } = await adminClient
    .from("purchase_offers")
    .select("id, exam_pack_id, name, offer_type, selection_count, price_kobo, currency, starts_at, ends_at, enabled")
    .eq("id", offerId)
    .eq("exam_pack_id", pack.id)
    .maybeSingle();

  if (offerError) throw offerError;
  const now = Date.now();
  const startsAt = offer?.starts_at ? new Date(offer.starts_at).getTime() : null;
  const endsAt = offer?.ends_at ? new Date(offer.ends_at).getTime() : null;
  if (
    !offer?.enabled
    || (startsAt !== null && (!Number.isFinite(startsAt) || now < startsAt))
    || (endsAt !== null && (!Number.isFinite(endsAt) || now >= endsAt))
  ) {
    throw new Error("This bundle offer is not currently available");
  }

  let subjectSlugs: string[];
  if (offer.offer_type === "pick_n_modules") {
    subjectSlugs = readSubjectSlugs(requestedSubjectSlugs);
    if (subjectSlugs.length !== Number(offer.selection_count)) {
      throw new Error(`Choose exactly ${offer.selection_count} modules for this bundle`);
    }
  } else if (offer.offer_type === "full_bundle") {
    const { data: subjects, error: subjectError } = await adminClient
      .from("subjects")
      .select("slug")
      .eq("is_active", true)
      .eq("lifecycle_status", "active")
      .eq("candidate_availability", "available")
      .order("sort_order")
      .order("name");
    if (subjectError) throw subjectError;
    subjectSlugs = (subjects ?? []).map((subject) => subject.slug);
  } else {
    throw new Error("This bundle type is not supported");
  }

  const itemResults = await Promise.all(subjectSlugs.map(async (subjectSlug) => {
    try {
      return await getModuleOffering(adminClient, String(pack.id), subjectSlug);
    } catch (error) {
      if (offer.offer_type === "pick_n_modules") throw error;
      return null;
    }
  }));
  const items = itemResults.filter(Boolean) as CheckoutItem[];

  if (offer.offer_type === "pick_n_modules" && items.length !== Number(offer.selection_count)) {
    throw new Error(`Choose exactly ${offer.selection_count} available modules`);
  }
  if (offer.offer_type === "full_bundle" && items.length === 0) {
    throw new Error("No modules are currently available for this bundle");
  }

  const accessResults = await Promise.all(items.map((item) => getActiveModuleAccess(
    adminClient,
    userId,
    String(pack.id),
    String(item.subject.id),
  )));
  if (accessResults.some(Boolean)) {
    throw new Error(
      offer.offer_type === "full_bundle"
        ? "The full bundle is only available before you unlock an individual module"
        : "Choose modules that are not already unlocked on your account",
    );
  }

  const listPriceKobo = items.reduce(
    (total, item) => total + Number(item.offering.price_kobo),
    0,
  );
  if (Number(offer.price_kobo) >= listPriceKobo) {
    throw new Error("This bundle is not cheaper than the selected modules right now");
  }

  return {
    offer,
    items,
    amountKobo: Number(offer.price_kobo),
    listPriceKobo,
    currency: String(offer.currency),
    checkoutKey: `bundle:${offer.id}:${items.map((item) => item.subject.id).sort().join(":")}`,
    purchaseLabel: String(offer.name),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const user = await getAuthedUser(request);
    const adminClient = getAdminClient();
    const requestBody = await readJsonBody(request, 4_096) as Record<string, unknown>;
    const purchaseType = requestBody.purchase_type === "pricing_plan"
      ? "pricing_plan"
      : requestBody.purchase_type === "bundle_offer" ? "bundle_offer" : "single_module";
    const expectedPriceKobo = requestBody.expected_price_kobo;

    if (expectedPriceKobo !== undefined && (
      typeof expectedPriceKobo !== "number"
      || !Number.isInteger(expectedPriceKobo)
      || expectedPriceKobo <= 0
    )) return jsonResponse({ error: "The displayed price is invalid" }, 400);

    await enforceEdgeRateLimit(adminClient, user.id, "payment_initialize", 12, 600);
    const pack = await getActivePack(adminClient);

    let items: CheckoutItem[];
    let amountKobo: number;
    let listPriceKobo: number;
    let currency: string;
    let pricingType: string;
    let launchOfferEndsAt: string | null = null;
    let purchaseOfferId: string | null = null;
    let purchasePlanId: string | null = null;
    let planCode: string | null = null;
    let durationMonths: number | null = null;
    let catalogModuleCount: number | null = null;
    let purchaseSnapshot: Record<string, unknown> = {};
    let purchaseLabel: string;
    let checkoutKey: string;

    if (purchaseType === "pricing_plan") {
      const planCheckout = await getPricingPlanCheckout(
        adminClient,
        pack,
        String(requestBody.plan_code ?? ""),
        requestBody.duration_months,
        requestBody.subject_slugs,
      );
      items = planCheckout.items;
      amountKobo = planCheckout.amountKobo;
      listPriceKobo = planCheckout.listPriceKobo;
      currency = planCheckout.currency;
      pricingType = "pricing_plan";
      purchasePlanId = String(planCheckout.plan.id);
      planCode = String(planCheckout.plan.code);
      durationMonths = planCheckout.durationMonths;
      catalogModuleCount = planCheckout.catalogModuleCount;
      purchaseSnapshot = planCheckout.purchaseSnapshot;
      purchaseLabel = planCheckout.purchaseLabel;
      checkoutKey = planCheckout.checkoutKey;
    } else if (purchaseType === "bundle_offer") {
      const offerId = String(requestBody.purchase_offer_id ?? "");
      const bundle = await getBundleCheckout(
        adminClient,
        user.id,
        pack,
        offerId,
        requestBody.subject_slugs,
      );
      items = bundle.items;
      amountKobo = bundle.amountKobo;
      listPriceKobo = bundle.listPriceKobo;
      currency = bundle.currency;
      pricingType = "bundle_offer";
      purchaseOfferId = String(bundle.offer.id);
      purchaseLabel = bundle.purchaseLabel;
      checkoutKey = bundle.checkoutKey;
    } else {
      const subjectSlug = requestBody.subject_slug;
      if (
        typeof subjectSlug !== "string"
        || subjectSlug.length > 80
        || !SUBJECT_SLUG_PATTERN.test(subjectSlug)
      ) {
        return jsonResponse({ error: "Choose a module to unlock" }, 400);
      }

      const moduleCheckout = await getModuleOffering(adminClient, pack.id, subjectSlug);
      const existingAccess = await getActiveModuleAccess(
        adminClient,
        user.id,
        pack.id,
        moduleCheckout.subject.id,
      );
      if (existingAccess) {
        return jsonResponse({
          already_paid: true,
          expires_at: existingAccess.expires_at,
          subject_name: moduleCheckout.subject.name,
          subject_slug: moduleCheckout.subject.slug,
        });
      }

      items = [moduleCheckout];
      amountKobo = Number(moduleCheckout.offering.price_kobo);
      listPriceKobo = Number(moduleCheckout.offering.regular_price_kobo);
      currency = String(moduleCheckout.offering.currency);
      pricingType = String(moduleCheckout.offering.pricing_type);
      launchOfferEndsAt = moduleCheckout.offering.launch_offer_ends_at
        ? String(moduleCheckout.offering.launch_offer_ends_at)
        : null;
      purchaseLabel = String(moduleCheckout.subject.name);
      checkoutKey = `single:${moduleCheckout.subject.id}`;
    }

    if (expectedPriceKobo === undefined && (purchaseType === "pricing_plan" || purchaseType === "bundle_offer" || pricingType === "launch_offer")) {
      return jsonResponse({
        error: "Review and confirm the current price before continuing.",
        code: "PRICE_CONFIRMATION_REQUIRED",
      }, 409);
    }

    if (expectedPriceKobo !== undefined && expectedPriceKobo !== amountKobo) {
      return jsonResponse({
        error: "The price changed. Review the current price before continuing.",
        code: "PRICE_CHANGED",
      }, 409);
    }

    const paystackSecret = requireEnv("PAYSTACK_SECRET_KEY");
    getPaystackEnvironment(paystackSecret);
    const paystackApiUrl = Deno.env.get("PAYSTACK_API_URL") ?? "https://api.paystack.co";
    const callbackUrl = getPaymentCallbackUrl(Deno.env.get("APP_URL"));

    async function recoverCheckout() {
      const { data: existingOrder, error } = await adminClient
        .from("payment_orders")
        .select("provider_reference, provider_status, provider_payload, created_at")
        .eq("user_id", user.id)
        .eq("exam_pack_id", pack.id)
        .eq("checkout_key", checkoutKey)
        .eq("status", "pending")
        .in("provider_status", ["initializing", "initialized"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      if (!existingOrder) return null;

      const checkout = existingOrder?.provider_payload?.data;
      const createdAt = new Date(existingOrder.created_at).getTime();
      const shouldRecheck = Number.isFinite(createdAt)
        && Date.now() - createdAt >= CHECKOUT_RECHECK_AFTER_MS;

      if (shouldRecheck) {
        try {
          const verifyResponse = await fetch(
            `${paystackApiUrl}/transaction/verify/${encodeURIComponent(existingOrder.provider_reference)}`,
            { headers: { Authorization: `Bearer ${paystackSecret}`, "Content-Type": "application/json" } },
          );
          const verifyPayload = await verifyResponse.json();
          const providerStatus = getPaystackTransactionStatus(verifyPayload);

          if (verifyResponse.ok && providerStatus === "success") {
            await recordModulePaymentStatus(existingOrder.provider_reference, verifyPayload);
            return {
              authorization_url: `${callbackUrl}?reference=${encodeURIComponent(existingOrder.provider_reference)}`,
              reference: existingOrder.provider_reference,
              purchase_type: purchaseType,
              purchase_label: purchaseLabel,
              resumed: true,
            };
          }
          if (verifyResponse.ok && isFinalUnsuccessfulPaystackPayment(verifyPayload)) {
            await recordModulePaymentStatus(existingOrder.provider_reference, verifyPayload);
            return null;
          }
          if (verifyResponse.status === 404) {
            await adminClient.from("payment_orders").update({
              status: "failed",
              provider_status: "failed",
              provider_message: "Payment session expired before checkout was completed",
              provider_checked_at: new Date().toISOString(),
            }).eq("provider_reference", existingOrder.provider_reference).eq("status", "pending");
            return null;
          }
        } catch (recheckError) {
          console.warn("Could not recheck an older Paystack checkout", {
            reference: existingOrder.provider_reference,
            message: recheckError instanceof Error ? recheckError.message : "Unknown error",
          });
        }
      }

      if (existingOrder.provider_status === "initialized" && checkout?.authorization_url && checkout?.access_code) {
        return {
          authorization_url: checkout.authorization_url,
          access_code: checkout.access_code,
          reference: checkout.reference ?? existingOrder.provider_reference,
          purchase_type: purchaseType,
          purchase_label: purchaseLabel,
          resumed: true,
        };
      }
      return { preparing: true };
    }

    const existingCheckout = await recoverCheckout();
    if (existingCheckout && !("preparing" in existingCheckout)) return jsonResponse(existingCheckout);
    if (existingCheckout) {
      return jsonResponse({ error: "Payment setup is already in progress. Please try again in a moment." }, 409);
    }

    const reference = `PS-${crypto.randomUUID()}`;
    const singleItem = purchaseType === "single_module" ? items[0] : null;
    const { data: order, error: orderError } = await adminClient.from("payment_orders").insert({
      user_id: user.id,
      exam_pack_id: pack.id,
      subject_id: singleItem?.subject.id ?? null,
      module_offering_id: singleItem?.offering.id ?? null,
      purchase_type: purchaseType,
      purchase_offer_id: purchaseOfferId,
      purchase_plan_id: purchasePlanId,
      plan_code: planCode,
      duration_months: durationMonths,
      catalog_module_count: catalogModuleCount,
      pricing_version: purchaseType === "pricing_plan" ? "duration_pricing_v1" : null,
      purchase_snapshot: purchaseSnapshot,
      purchase_label: purchaseLabel,
      checkout_key: checkoutKey,
      provider_reference: reference,
      amount_kobo: amountKobo,
      list_price_kobo: listPriceKobo,
      pricing_type: pricingType,
      launch_offer_ends_at: launchOfferEndsAt,
      currency,
      status: "pending",
      provider_status: "initializing",
      provider_checked_at: new Date().toISOString(),
    }).select("id").single();

    if (orderError?.code === "23505") {
      const concurrentCheckout = await recoverCheckout();
      if (concurrentCheckout && !("preparing" in concurrentCheckout)) return jsonResponse(concurrentCheckout);
      return jsonResponse({ error: "Payment setup is already in progress. Please try again in a moment." }, 409);
    }
    if (orderError || !order) throw orderError ?? new Error("Unable to prepare this payment");

    const baseAllocation = Math.floor(amountKobo / items.length);
    const allocationRemainder = amountKobo - (baseAllocation * items.length);
    const { error: itemError } = await adminClient.from("payment_order_items").insert(items.map((item, index) => ({
      payment_order_id: order.id,
      subject_id: item.subject.id,
      module_offering_id: item.offering.id,
      list_price_kobo: item.offering.price_kobo,
      allocated_amount_kobo: baseAllocation + (index < allocationRemainder ? 1 : 0),
    })));
    if (itemError) {
      await adminClient.from("payment_orders").delete().eq("id", order.id);
      throw itemError;
    }

    const subjectIds = items.map((item) => item.subject.id);
    const initBody = {
      email: user.email,
      amount: amountKobo,
      currency,
      reference,
      callback_url: callbackUrl,
      metadata: {
        payment_order_id: order.id,
        user_id: user.id,
        exam_pack_id: pack.id,
        purchase_type: purchaseType,
        purchase_offer_id: purchaseOfferId,
        purchase_plan_id: purchasePlanId,
        plan_code: planCode,
        duration_months: durationMonths,
        subject_id: singleItem?.subject.id ?? null,
        subject_slug: singleItem?.subject.slug ?? null,
        subject_ids: subjectIds,
      },
    };

    console.log("Initializing Paystack payment", {
      userId: user.id,
      purchaseType,
      itemCount: items.length,
      amount: amountKobo,
      pricingType,
    });

    const paystackResponse = await fetch(`${paystackApiUrl}/transaction/initialize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify(initBody),
    });
    const payload = await paystackResponse.json();

    if (!paystackResponse.ok || !payload.status) {
      await adminClient.from("payment_orders").update({
        status: "failed",
        provider_status: "failed",
        provider_message: payload?.message ?? "Payment initialization failed",
        provider_payload: sanitizePaymentPayload(payload),
        provider_checked_at: new Date().toISOString(),
      }).eq("id", order.id);
      return jsonResponse({ error: payload.message ?? "Unable to initialize Paystack payment" }, 400);
    }

    const { error: checkoutSaveError } = await adminClient.from("payment_orders").update({
      provider_status: "initialized",
      provider_message: payload?.message ?? null,
      provider_payload: sanitizePaymentPayload(payload),
      provider_checked_at: new Date().toISOString(),
    }).eq("id", order.id);
    if (checkoutSaveError) throw checkoutSaveError;

    return jsonResponse({
      authorization_url: payload.data.authorization_url,
      access_code: payload.data.access_code,
      reference: payload.data.reference,
      purchase_type: purchaseType,
      purchase_label: purchaseLabel,
      plan_code: planCode,
      duration_months: durationMonths,
      subject_name: singleItem?.subject.name ?? null,
      subject_slug: singleItem?.subject.slug ?? null,
      subject_slugs: items.map((item) => item.subject.slug),
      amount_kobo: amountKobo,
      list_price_kobo: listPriceKobo,
      pricing_type: pricingType,
      resumed: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Payment initialization failed";
    const status = message.startsWith("Payment callback configuration error:")
      ? 500
      : getRequestErrorStatus(error);
    return jsonResponse({ error: message }, status);
  }
});
