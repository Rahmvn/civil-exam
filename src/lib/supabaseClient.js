import { createClient } from "@supabase/supabase-js";
import { assertLocalE2eSupabaseUrl, resolveSupabaseBrowserConfig } from "./supabaseConfig";

const { supabaseUrl, supabaseKey } = resolveSupabaseBrowserConfig(import.meta.env);
const isE2eRun = import.meta.env.VITE_E2E === "true";

assertLocalE2eSupabaseUrl(supabaseUrl, isE2eRun);

export const supabase = createClient(supabaseUrl, supabaseKey);
