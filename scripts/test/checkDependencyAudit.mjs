import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const allowedReactRouterAdvisory = {
  id: "GHSA-qwww-vcr4-c8h2",
  packages: new Set(["react-router", "react-router-dom"]),
  sourceIds: new Set([1111445]),
  url: "https://github.com/advisories/GHSA-qwww-vcr4-c8h2",
};

const routeConfigPatterns = [/\bloader\s*:/, /\baction\s*:/];
const routerServerApiPatterns = [
  /\bclientAction\b/,
  /\bserverAction\b/,
  /\bcreateStaticHandler\b/,
  /\bcreateCallServer\b/,
  /\bServerRouter\b/,
  /\bRSCHydratedRouter\b/,
  /\bunstable_[A-Za-z0-9_]*RSC\b/,
];

function walkFiles(directory, extensions, results = []) {
  for (const entry of readdirSync(directory)) {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      walkFiles(fullPath, extensions, results);
    } else if (extensions.has(path.extname(entry))) {
      results.push(fullPath);
    }
  }
  return results;
}

function assertNoReactRouterServerSurface() {
  const files = walkFiles(path.resolve("src"), new Set([".js", ".jsx", ".ts", ".tsx"]));
  const matches = [];

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const patterns = path.basename(file).startsWith("App.")
      ? [...routeConfigPatterns, ...routerServerApiPatterns]
      : routerServerApiPatterns;
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        matches.push(`${path.relative(process.cwd(), file)} matched ${pattern}`);
      }
    }
  }

  if (matches.length) {
    throw new Error(
      [
        "React Router audit exception refused because server/RSC route patterns were found:",
        ...matches.map((match) => `- ${match}`),
      ].join("\n"),
    );
  }
}

function isAllowedReactRouterFinding(name, finding, allowedNames) {
  if (!allowedReactRouterAdvisory.packages.has(name)) return false;

  const via = Array.isArray(finding.via) ? finding.via : [];
  const directAdvisory = via.some((item) => (
    item
    && typeof item === "object"
    && (
      allowedReactRouterAdvisory.sourceIds.has(item.source)
      || item.url === allowedReactRouterAdvisory.url
      || item.title?.includes("RSC Mode CSRF Bypass")
    )
  ));

  const transitiveAllowed = via.some((item) => typeof item === "string" && allowedNames.has(item));
  return directAdvisory || transitiveAllowed;
}

function main() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["audit", "--audit-level=high", "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32",
  });

  const raw = result.stdout || result.stderr;
  let audit;
  try {
    audit = JSON.parse(raw);
  } catch {
    process.stdout.write(raw);
    process.exit(result.status ?? 1);
  }

  const vulnerabilities = audit.vulnerabilities ?? {};
  const actionable = Object.entries(vulnerabilities).filter(([, finding]) =>
    ["high", "critical"].includes(finding?.severity),
  );

  const allowedNames = new Set();
  for (const [name, finding] of actionable) {
    if (isAllowedReactRouterFinding(name, finding, allowedNames)) {
      allowedNames.add(name);
    }
  }

  const blocked = actionable.filter(([name, finding]) =>
    !isAllowedReactRouterFinding(name, finding, allowedNames),
  );

  if (blocked.length) {
    console.error("Dependency audit failed with unapproved high/critical vulnerabilities:");
    for (const [name, finding] of blocked) {
      console.error(`- ${name}: ${finding.title ?? finding.name ?? finding.severity}`);
    }
    process.exit(1);
  }

  if (allowedNames.size) {
    assertNoReactRouterServerSurface();
    console.warn(
      `Dependency audit passed with documented exception ${allowedReactRouterAdvisory.id} for ${[...allowedNames].join(", ")}.`,
    );
    return;
  }

  console.log("Dependency audit passed with no high/critical vulnerabilities.");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
