import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { requireEnv } from "./http.ts";
import {
  getPaymentUserId,
  getPublishedContentTable,
  validateLegacyPaymentData,
  validateModulePaymentData,
} from "./payment-validation.js";

export function getAdminClient() {
  return createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
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

  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_ANON_KEY"),
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

  const { count, error: questionError } = await adminClient
    .from(getPublishedContentTable(subject.practice_type))
    .select("id", { count: "exact", head: true })
    .eq("exam_pack_id", packId)
    .eq("subject_id", subject.id)
    .eq("status", "published");

  if (questionError || !count) {
    throw new Error("This module is not available for purchase yet");
  }

  const { data: offering, error: offeringError } = await adminClient
    .from("module_offerings")
    .select("id, exam_pack_id, subject_id, price_kobo, currency")
    .eq("exam_pack_id", packId)
    .eq("subject_id", subject.id)
    .eq("is_active", true)
    .maybeSingle();

  if (offeringError || !offering) {
    throw new Error("This module is not available for purchase yet");
  }

  return { offering, subject };
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
    .select("id, user_id, exam_pack_id, subject_id, provider_reference, status, amount_kobo, currency")
    .eq("provider_reference", reference)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
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
    payment_payload: paymentData,
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
        metadata: paymentData,
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
