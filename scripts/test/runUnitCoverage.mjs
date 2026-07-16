import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const baseline = JSON.parse(await readFile(new URL("./coverage-baseline.json", import.meta.url), "utf8"));
const result = spawnSync(process.execPath, ["--test", "--experimental-test-coverage", "tests/unit"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: process.env,
});

process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const summary = (result.stdout ?? "").match(/# all files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)/);
if (!summary) {
  console.error("The unit coverage summary could not be read.");
  process.exit(1);
}

const actual = {
  line: Number(summary[1]),
  branch: Number(summary[2]),
  functions: Number(summary[3]),
};
const failures = Object.entries(baseline)
  .filter(([name, minimum]) => actual[name] < minimum)
  .map(([name, minimum]) => `${name} coverage ${actual[name].toFixed(2)}% is below ${minimum}%`);

if (failures.length > 0) {
  failures.forEach((failure) => console.error(`Coverage gate failed: ${failure}`));
  process.exit(1);
}

console.log(
  `Coverage gate passed: lines ${actual.line.toFixed(2)}%, branches ${actual.branch.toFixed(2)}%, functions ${actual.functions.toFixed(2)}%.`,
);
