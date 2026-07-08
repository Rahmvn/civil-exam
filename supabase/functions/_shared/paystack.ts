import { createClient } from "https://esm.sh/@supabase/supabase-js@2.108.2";
import { requireEnv } from "./http.ts";

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

// The currently active exam pack. Not hardcoded to any single exam slug —
// mirrors the public.get_active_pack() SQL function so server and DB agree
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

export async function activateEntitlement(
  reference: string,
  paymentData: Record<string, unknown>,
) {
  const adminClient = getAdminClient();
  const pack = await getActivePack(adminClient);
  const metadata = paymentData.metadata as Record<string, unknown> | undefined;
  const userId = metadata?.user_id;

  if (!userId || typeof userId !== "string") {
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
