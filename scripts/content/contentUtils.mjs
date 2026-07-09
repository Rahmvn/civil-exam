import fs from "node:fs/promises";
import path from "node:path";

export function parseCliArgs(argv = process.argv.slice(2)) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

export async function ensureDirectoryExists(targetDirectory) {
  await fs.mkdir(targetDirectory, { recursive: true });
}

export function sanitizeFilename(value) {
  return String(value)
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function createTimestamp(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}${month}${day}-${hours}${minutes}`;
}

export async function writeMarkdownReport({
  directory,
  prefix,
  sourceFile,
  content,
  timestamp = createTimestamp(),
}) {
  await ensureDirectoryExists(directory);

  const reportName = `${prefix}-${sanitizeFilename(path.basename(sourceFile))}-${timestamp}.md`;
  const reportPath = path.join(directory, reportName);

  await fs.writeFile(reportPath, content, "utf8");

  return reportPath;
}

export async function readTextFile(filePath) {
  return fs.readFile(filePath, "utf8");
}

export async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export function summarizeCounts(items, getKey) {
  const counts = new Map();

  for (const item of items) {
    const key = getKey(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => {
      if (typeof left.key === "number" && typeof right.key === "number") {
        return left.key - right.key;
      }

      return String(left.key).localeCompare(String(right.key));
    });
}

export function toBulletList(items, fallback = "- None") {
  if (!items.length) {
    return fallback;
  }

  return items.map((item) => `- ${item}`).join("\n");
}

export function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function hasValue(value) {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}
