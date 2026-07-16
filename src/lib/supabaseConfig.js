export function resolveSupabaseBrowserConfig(env) {
  const supabaseUrl = env?.VITE_SUPABASE_URL;
  const supabaseKey = env?.VITE_SUPABASE_PUBLISHABLE_KEY || env?.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase browser configuration is missing");
  }

  return { supabaseUrl, supabaseKey };
}

export function assertLocalE2eSupabaseUrl(supabaseUrl, isE2eRun) {
  if (!isE2eRun) return;

  const hostname = new URL(supabaseUrl).hostname;
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error("E2E tests may only connect to local Supabase");
  }
}
