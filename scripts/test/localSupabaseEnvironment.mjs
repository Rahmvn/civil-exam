import { spawnSync } from "node:child_process";

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function parseSupabaseEnvironment(output) {
  return Object.fromEntries(
    String(output ?? "")
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(?:"(.*)"|(.*))$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2] ?? match[3] ?? ""]),
  );
}

export function assertLocalSupabaseUrl(value, purpose = "Local testing") {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${purpose} refused to run because the Supabase URL is invalid.`);
  }

  if (!LOCAL_HOSTNAMES.has(url.hostname)) {
    throw new Error(`${purpose} refused to run because Supabase is not local.`);
  }

  return url.toString();
}

export function readLocalSupabaseEnvironment({
  cwd = process.cwd(),
  run = spawnSync,
} = {}) {
  const status = run("supabase", ["status", "-o", "env"], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    windowsHide: true,
  });

  if (status.error || status.status !== 0) {
    throw new Error("Local Supabase is not ready. Run `supabase start` first.");
  }

  const values = parseSupabaseEnvironment(status.stdout);
  const apiUrl = values.API_URL;
  const publicKey = values.PUBLISHABLE_KEY || values.ANON_KEY;
  const secretKey = values.SECRET_KEY || values.SERVICE_ROLE_KEY;

  if (!apiUrl || !publicKey || !secretKey) {
    throw new Error("The local Supabase URL or test keys could not be resolved.");
  }

  assertLocalSupabaseUrl(apiUrl);
  return { apiUrl, publicKey, secretKey };
}

export function localBrowserEnvironment(local) {
  assertLocalSupabaseUrl(local?.apiUrl, "Local browser development");
  if (!local?.publicKey) {
    throw new Error("Local browser development requires a local publishable key.");
  }

  return {
    VITE_SUPABASE_URL: local.apiUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: local.publicKey,
    VITE_SUPABASE_ANON_KEY: local.publicKey,
  };
}
