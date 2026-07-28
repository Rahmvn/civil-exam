import { spawn } from "node:child_process";
import process from "node:process";

const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const npmCliPath = process.env.npm_execpath;
const full = process.argv.includes("--full");

const baseStages = [
  ["Lint", ["run", "lint"]],
  ["Production build", ["run", "build"]],
  ["SEO discovery outputs", ["run", "test:seo"]],
  ["Tracked-secret scan", ["run", "test:secrets"]],
  ["Production configuration contract", ["run", "test:config"]],
  ["Unit tests", ["run", "test:unit"]],
  ["Database tests", ["run", "test:db"]],
  ["Payment edge tests", ["run", "test:edge"]],
  ["Operator read-only access", ["run", "test:operator-access"]],
];

const fullStages = [
  ["Authentication E2E", ["run", "test:e2e:auth-mock"]],
  ["Turnstile E2E", ["run", "test:e2e:turnstile"]],
  ["Candidate/admin E2E regression", ["run", "test:e2e"]],
  ["Performance E2E", ["run", "test:e2e:performance"]],
  ["Visual regression", ["run", "test:e2e:visual"]],
  ["Standard load smoke", ["run", "test:load"]],
];

const stages = full ? [...baseStages, ...fullStages] : baseStages;
const startedAt = Date.now();

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function runStage(name, args) {
  const stageStartedAt = Date.now();
  console.log(`\n▶ ${name}`);
  console.log(`  npm ${args.join(" ")}`);

  return new Promise((resolve, reject) => {
    const command = npmCliPath ? process.execPath : npmCommand;
    const commandArgs = npmCliPath ? [npmCliPath, ...args] : args;
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      env: process.env,
      shell: isWindows && !npmCliPath,
      stdio: "inherit",
      windowsHide: true,
    });

    child.on("error", reject);
    child.on("close", (code) => {
      const duration = formatDuration(Date.now() - stageStartedAt);
      if (code === 0) {
        console.log(`✓ ${name} passed in ${duration}`);
        resolve();
        return;
      }

      reject(new Error(`${name} failed with exit code ${code} after ${duration}`));
    });
  });
}

for (const [name, args] of stages) {
  try {
    await runStage(name, args);
  } catch (error) {
    console.error(`\n✕ Launch readiness stopped: ${error.message}`);
    process.exit(1);
  }
}

console.log(`\n✓ Launch readiness ${full ? "full" : "local"} check passed in ${formatDuration(Date.now() - startedAt)}.`);

if (!full) {
  console.log("  For browser and load gates, run: npm run launch:check:full");
}
