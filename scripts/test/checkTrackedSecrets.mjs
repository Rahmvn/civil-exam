import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((path) => !path.endsWith("package-lock.json"));
const patterns = [
  { label: "Supabase secret key", expression: /sb_secret_[A-Za-z0-9_-]{20,}/ },
  { label: "Supabase service-role JWT", expression: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/ },
  { label: "Paystack secret", expression: /sk_(?:live|test)_[A-Za-z0-9]{20,}/ },
  { label: "Private key", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];
const findings = [];

for (const path of tracked) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch {
    continue;
  }

  patterns.forEach(({ label, expression }) => {
    if (expression.test(content)) findings.push(`${label}: ${path}`);
  });
}

if (findings.length > 0) {
  findings.forEach((finding) => console.error(`Tracked-secret check failed: ${finding}`));
  process.exit(1);
}

console.log(`Tracked-secret check passed across ${tracked.length} files.`);
