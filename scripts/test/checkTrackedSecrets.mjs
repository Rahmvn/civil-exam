import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { scanTrackedContent } from "./secretPatterns.mjs";

const tracked = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .filter((path) => !path.endsWith("package-lock.json"));
const findings = [];

for (const path of tracked) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch {
    continue;
  }

  findings.push(...scanTrackedContent(path, content));
}

if (findings.length > 0) {
  findings.forEach((finding) => console.error(`Tracked-secret check failed: ${finding}`));
  process.exit(1);
}

console.log(`Tracked-secret check passed across ${tracked.length} files.`);
