import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const isE2eRun = import.meta.env.VITE_E2E === "true";

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Supabase environment variables are missing");
}

if (isE2eRun) {
  const hostname = new URL(supabaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error("E2E tests may only connect to local Supabase");
  }
}

export const supabase = createClient(supabaseUrl, supabaseKey);
