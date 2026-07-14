import { spawnSync } from "node:child_process";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseSupabaseEnvironment(output) {
  return Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=(?:"(.*)"|(.*))$/))
      .filter(Boolean)
      .map((match) => [match[1], match[2] ?? match[3] ?? ""]),
  );
}

const status = spawnSync("supabase", ["status", "-o", "env"], {
  cwd: process.cwd(),
  encoding: "utf8",
  shell: process.platform === "win32",
});

if (status.status !== 0) {
  fail("Local Supabase is not ready. Run `supabase start` before the E2E suite.");
}

const local = parseSupabaseEnvironment(status.stdout);
const apiUrl = local.API_URL;
const publicKey = local.PUBLISHABLE_KEY || local.ANON_KEY;
const secretKey = local.SECRET_KEY || local.SERVICE_ROLE_KEY;

if (!apiUrl || !publicKey || !secretKey) {
  fail("The local Supabase URL or test keys could not be resolved.");
}

const hostname = new URL(apiUrl).hostname;
if (hostname !== "127.0.0.1" && hostname !== "localhost") {
  fail("Regression tests refused to run because Supabase is not local.");
}

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(command, ["playwright", "test", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    E2E_LOCAL_SUPABASE: "true",
    E2E_SUPABASE_URL: apiUrl,
    E2E_SUPABASE_PUBLIC_KEY: publicKey,
    E2E_SUPABASE_SECRET_KEY: secretKey,
    VITE_E2E: "true",
    VITE_SUPABASE_URL: apiUrl,
    VITE_SUPABASE_ANON_KEY: publicKey,
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
