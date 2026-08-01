import { spawn } from "node:child_process";
import {
  localBrowserEnvironment,
  readLocalSupabaseEnvironment,
} from "./test/localSupabaseEnvironment.mjs";

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

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(command, ["vite", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...localBrowserEnvironment(local),
    VITE_LOCAL_DEVELOPMENT: "true",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
  windowsHide: true,
});

child.on("error", (error) => fail(`Could not start local development: ${error.message}`));
child.on("close", (code) => process.exit(code ?? 1));
