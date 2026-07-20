import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { requireEnv } from "./http.ts";
import {
  getPaymentUserId,
  getPublishedContentTable,
  validateLegacyPaymentData,
  validateModulePaymentData,
} from "./payment-validation.js";
import { resolveSupabaseKey } from "./supabase-keys.js";
import { sanitizePaymentPayload, sanitizePaystackPostPaymentEvent } from "./payment-sanitization.js";

function getSupabasePublishableKey() {
  return resolveSupabaseKey({
    dictionaryEnvName: "SUPABASE_PUBLISHABLE_KEYS",
    legacyEnvName: "SUPABASE_ANON_KEY",
    label: "Supabase publishable key",
  });
}

function getSupabaseSecretKey() {
  return resolveSupabaseKey({
    dictionaryEnvName: "SUPABASE_SECRET_KEYS",
    legacyEnvName: "SUPABASE_SERVICE_ROLE_KEY",
    label: "Supabase secret key",
  });
}

export function getAdminClient() {
  return createClient(
    requireEnv("SUPABASE_URL"),
    getSupabaseSecretKey(),
    {
      auth: {
        persistSession: false,
      },
    },
  );
}

export async function getAuthedUser(request: Request) {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    throw new Error("Missing authorization header");
  }

  if (!/^Bearer\s+\S+$/i.test(authHeader)) {
    throw new Error("Invalid authorization header");
  }

  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    getSupabasePublishableKey(),
    {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
      auth: {
        persistSession: false,
      },
    },
  );

  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw new Error("Invalid user session");
  }

  return data.user;
}

// The currently active exam pack. This is not hardcoded to one exam slug;
// it mirrors public.get_active_pack() so server and database agree
// on which pack is "active" when multiple packs exist.
export async function getActivePack(adminClient: ReturnType<typeof getAdminClient>) {
  const { data, error } = await adminClient
    .from("exam_packs")
    .select("*")
    .eq("is_active", true)
    .order("active_from", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error("No active exam pack is configured");
  }

  return data;
}

export async function getModuleOffering(
  adminClient: ReturnType<typeof getAdminClient>,
  packId: string,
  subjectSlug: string,
) {
  const { data: subject, error: subjectError } = await adminClient
    .from("subjects")
    .select("id, name, slug, lifecycle_status, practice_type")
    .eq("slug", subjectSlug)
    .eq("is_active", true)
    .eq("lifecycle_status", "active")
    .maybeSingle();

  if (subjectError || !subject) {
    throw new Error("This module is not available");
  }

  const hasPublishedContent = subject.practice_type === "oral"
    ? await hasPublishedOralSet(adminClient, packId, subject.id)
    : await hasPublishedObjectiveQuestions(adminClient, packId, subject.id);

  if (!hasPublishedContent) {
    throw new Error("This module has no published practice sets available for purchase yet");
  }

  const { data: offering, error: offeringError } = await adminClient
    .from("module_offerings")
    .select("id, exam_pack_id, subject_id, price_kobo, currency")
    .eq("exam_pack_id", packId)
    .eq("subject_id", subject.id)
    .eq("is_active", true)
    .maybeSingle();

  if (offeringError || !offering) {
    throw new Error("This module does not have an active payment offering yet");
  }

  return { offering, subject };
}

async function hasPublishedObjectiveQuestions(
  adminClient: ReturnType<typeof getAdminClient>,
  packId: string,
  subjectId: string,
) {
  const { count, error } = await adminClient
    .from(getPublishedContentTable("objective"))
    .select("id", { count: "exact", head: true })
    .eq("exam_pack_id", packId)
    .eq("subject_id", subjectId)
    .eq("status", "published");

  if (error) throw error;
  return Number(count ?? 0) > 0;
}

async function hasPublishedOralSet(
  adminClient: ReturnType<typeof getAdminClient>,
  packId: string,
  subjectId: string,
) {
  const { count, error } = await adminClient
    .from("oral_questions")
    .select("id, practice_sets!inner(id)", { count: "exact", head: true })
    .eq("exam_pack_id", packId)
    .eq("subject_id", subjectId)
    .eq("status", "published")
    .eq("practice_sets.practice_type", "oral")
    .eq("practice_sets.status", "published");

  if (error) throw error;
  return Number(count ?? 0) > 0;
}

export async function getActiveModuleAccess(
  adminClient: ReturnType<typeof getAdminClient>,
  userId: string,
  packId: string,
  subjectId: string,
) {
  const now = new Date().toISOString();
  const [legacyResult, moduleResult] = await Promise.all([
    adminClient
      .from("entitlements")
      .select("id, expires_at")
      .eq("user_id", userId)
      .eq("exam_pack_id", packId)
      .eq("status", "active")
      .gt("expires_at", now)
      .maybeSingle(),
    adminClient
      .from("module_entitlements")
      .select("id, expires_at")
      .eq("user_id", userId)
      .eq("exam_pack_id", packId)
      .eq("subject_id", subjectId)
      .eq("status", "active")
      .gt("expires_at", now)
      .maybeSingle(),
  ]);

  if (legacyResult.error) throw legacyResult.error;
  if (moduleResult.error) throw moduleResult.error;

  return moduleResult.data ?? legacyResult.data ?? null;
}

export async function getModulePaymentOrder(reference: string) {
  const adminClient = getAdminClient();
  const { data, error } = await adminClient
    .from("payment_orders")
    .select("id, user_id, exam_pack_id, subject_id, provider_reference, status, amount_kobo, currency, provider_status, fulfillment_status")
    .eq("provider_reference", reference)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export function getPaystackTransactionStatus(payload: Record<string, unknown>) {
  const data = payload?.data as Record<string, unknown> | undefined;
  const status = data?.status ?? payload?.status;
  return typeof status === "string" ? status.trim().toLowerCase() : "";
}

export function getPaystackTransactionMessage(payload: Record<string, unknown>) {
  const data = payload?.data as Record<string, unknown> | undefined;
  const gatewayResponse = data?.gateway_response;
  const message = data?.message ?? payload?.message ?? gatewayResponse;
  return typeof message === "string" ? message.trim() : "";
}

export function getPaystackGatewayResponseCode(payload: Record<string, unknown>) {
  const data = payload?.data as Record<string, unknown> | undefined;
  const code = data?.gateway_response_code ?? payload?.gateway_response_code;
  return typeof code === "string" ? code.trim().toLowerCase() : "";
}

function getPaystackPaidAt(payload: Record<string, unknown>) {
  const data = payload?.data as Record<string, unknown> | undefined;
  const value = data?.paid_at ?? data?.paidAt;
  if (typeof value !== "string") return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

export function isFinalUnsuccessfulPaystackPayment(payload: Record<string, unknown>) {
  const status = getPaystackTransactionStatus(payload);
  return [
    "abandoned",
    "cancelled",
    "canceled",
    "declined",
    "failed",
    "reversed",
    "timeout",
  ].includes(status);
}

export async function recordModulePaymentStatus(
  reference: string,
  paymentPayload: Record<string, unknown>,
) {
  const adminClient = getAdminClient();
  const order = await getModulePaymentOrder(reference);
  if (!order) return null;

  const providerStatus = getPaystackTransactionStatus(paymentPayload);
  const isSuccessful = providerStatus === "success";
  const isProcessing = ["ongoing", "pending", "processing", "queued"].includes(providerStatus);
  const isUnsuccessful = isFinalUnsuccessfulPaystackPayment(paymentPayload);
  const alreadyFulfilled = order.status === "active" || order.fulfillment_status === "fulfilled";
  const updates: Record<string, unknown> = {
    provider_payload: sanitizePaymentPayload(paymentPayload),
    provider_checked_at: new Date().toISOString(),
    provider_message: getPaystackTransactionMessage(paymentPayload) || null,
    gateway_response_code: getPaystackGatewayResponseCode(paymentPayload) || null,
    updated_at: new Date().toISOString(),
  };

  if (providerStatus) updates.provider_status = providerStatus;
  if (isSuccessful) {
    updates.paid_at = getPaystackPaidAt(paymentPayload) ?? new Date().toISOString();
    if (!alreadyFulfilled) updates.fulfillment_status = "pending";
  } else if (isProcessing) {
    if (!alreadyFulfilled) updates.status = "pending";
  } else if (isUnsuccessful && !alreadyFulfilled) {
    updates.status = providerStatus === "reversed" ? "expired" : "failed";
    if (providerStatus === "reversed") updates.fulfillment_status = "revoked";
  }

  const { error } = await adminClient
    .from("payment_orders")
    .update(updates)
    .eq("provider_reference", reference)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return order;
}

export async function applyPaystackPostPaymentEvent(
  eventKey: string,
  eventPayload: Record<string, unknown>,
) {
  const adminClient = getAdminClient();
  const sanitizedPayload = sanitizePaystackPostPaymentEvent(eventPayload);
  if (!sanitizedPayload.event) throw new Error("Unsupported Paystack post-payment event");

  const { data, error } = await adminClient.rpc("apply_paystack_post_payment_event", {
    requested_event_key: eventKey,
    requested_payload: sanitizedPayload,
  });

  if (error) throw error;
  return data?.[0] ?? null;
}

export async function markModulePaymentFulfillmentFailed(
  reference: string,
  error: unknown,
) {
  const adminClient = getAdminClient();
  const message = error instanceof Error ? error.message : "Module access activation failed";
  const { error: updateError } = await adminClient
    .from("payment_orders")
    .update({
      fulfillment_status: "failed",
      fulfillment_error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("provider_reference", reference)
    .eq("provider_status", "success")
    .neq("fulfillment_status", "fulfilled");

  if (updateError) throw updateError;
}

export function validateModulePayment(
  order: Record<string, unknown>,
  paymentData: Record<string, unknown>,
) {
  validateModulePaymentData(order, paymentData);
}

export async function validateLegacyPayment(paymentData: Record<string, unknown>) {
  const adminClient = getAdminClient();
  const pack = await getActivePack(adminClient);
  validateLegacyPaymentData(pack, paymentData);
}

export async function activateModulePurchase(
  reference: string,
  paymentData: Record<string, unknown>,
) {
  const adminClient = getAdminClient();
  const { data, error } = await adminClient.rpc("activate_module_purchase", {
    requested_reference: reference,
    payment_payload: sanitizePaymentPayload(paymentData),
  });

  if (error) throw error;
  const result = data?.[0];
  if (!result) throw new Error("Module access could not be activated");
  return result;
}

export async function activateEntitlement(
  reference: string,
  paymentData: Record<string, unknown>,
) {
  const adminClient = getAdminClient();
  const pack = await getActivePack(adminClient);
  const userId = getPaymentUserId(paymentData);

  if (!userId) {
    throw new Error("Payment metadata does not include a user id");
  }

  const expiresAt = new Date(`${pack.active_until}T23:59:59.999Z`).toISOString();

  const { data: existingByReference, error: existingReferenceError } = await adminClient
    .from("entitlements")
    .select("id, expires_at, exam_pack_id, status")
    .eq("paystack_reference", reference)
    .maybeSingle();

  if (existingReferenceError) {
    throw existingReferenceError;
  }

  if (existingByReference?.id) {
    return {
      expires_at: existingByReference.expires_at,
      pack,
      already_active: existingByReference.status === "active",
    };
  }

  const { data: existingActive, error: existingActiveError } = await adminClient
    .from("entitlements")
    .select("id, expires_at")
    .eq("user_id", userId)
    .eq("exam_pack_id", pack.id)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (existingActiveError) {
    throw existingActiveError;
  }

  if (existingActive?.id) {
    return {
      expires_at: existingActive.expires_at,
      pack,
      already_active: true,
    };
  }

  const { error } = await adminClient
    .from("entitlements")
    .upsert(
      {
        user_id: userId,
        exam_pack_id: pack.id,
        paystack_reference: reference,
        status: "active",
        amount_kobo: paymentData.amount,
        currency: paymentData.currency ?? "NGN",
        expires_at: expiresAt,
        metadata: sanitizePaymentPayload(paymentData),
      },
      { onConflict: "paystack_reference" },
    );

  if (error) {
    throw error;
  }

  return {
    expires_at: expiresAt,
    pack,
    already_active: false,
  };
}
