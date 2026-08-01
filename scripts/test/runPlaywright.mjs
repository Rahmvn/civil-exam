import { spawnSync } from "node:child_process";
import { readLocalSupabaseEnvironment } from "./localSupabaseEnvironment.mjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

let local;
try {
  local = readLocalSupabaseEnvironment();
} catch (error) {
  fail(error.message);
}
const { apiUrl, publicKey, secretKey } = local;

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const requestedArgs = process.argv.slice(2);
const visual = requestedArgs.includes("--visual");
const performance = requestedArgs.includes("--performance");
const playwrightArgs = requestedArgs.filter((argument) => !["--visual", "--performance"].includes(argument));
const result = spawnSync(command, ["playwright", "test", ...playwrightArgs], {
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
    E2E_VISUAL: visual ? "true" : "false",
    E2E_PERFORMANCE: performance ? "true" : "false",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
