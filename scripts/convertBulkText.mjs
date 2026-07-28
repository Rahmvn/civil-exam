import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  convertBulkObjectiveTextToCsv,
  parseBulkObjectiveText,
} from "../src/lib/bulkTextConverter.js";

// Internal-only content preparation helper.
// This is not an admin UI, does not write to the database, and must not be
// treated as a publishing/import authority. The normal admin upload validator
// remains the final gate before questions can enter PromotionSure.

function printUsage() {
  console.log([
    "Usage:",
    "  node scripts/convertBulkText.mjs <input.txt> --out <output-folder> [--section \"Public Financial Management\"]",
    "  node scripts/convertBulkText.mjs <input.txt> --list",
    "",
    "Purpose:",
    "  Converts bulk objective question text with A-D options and answer sections into PromotionSure upload CSV files.",
  ].join("\n"));
}

function getArgValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return "";
  return args[index + 1] ?? "";
}

const args = process.argv.slice(2);
const inputPath = args.find((arg) => !arg.startsWith("--"));

if (args.includes("--help")) {
  printUsage();
  process.exit(0);
}

if (!inputPath) {
  printUsage();
  process.exit(1);
}

const text = await readFile(inputPath, "utf8");

if (args.includes("--list")) {
  const parsed = parseBulkObjectiveText(text);
  parsed.sections.forEach((section) => {
    console.log(`${section.title} — ${section.questions.length} questions`);
  });
  process.exit(0);
}

const outputFolder = getArgValue(args, "--out");
if (!outputFolder) {
  console.error("Choose an output folder with --out.");
  process.exit(1);
}

const sectionTitle = getArgValue(args, "--section");
const conversions = convertBulkObjectiveTextToCsv(text, { sectionTitle });

if (conversions.length === 0) {
  console.error(sectionTitle
    ? `No objective question section matched "${sectionTitle}".`
    : "No objective question sections were found.");
  process.exit(1);
}

await mkdir(outputFolder, { recursive: true });

for (const conversion of conversions) {
  const { report, files } = conversion;
  console.log(`${report.title}`);
  console.log(`  ${report.questionCount} questions found`);
  console.log(`  ${report.answerCount} answers matched`);
  if (report.needsAttentionCount > 0) console.log(`  ${report.needsAttentionCount} need attention`);
  if (report.validationErrors.length > 0) {
    console.log("  Validation notes:");
    report.validationErrors.slice(0, 10).forEach((error) => console.log(`  - ${error}`));
    if (report.validationErrors.length > 10) console.log(`  - ${report.validationErrors.length - 10} more`);
  }

  for (const file of files) {
    const safeName = file.name.replace(/[^a-z0-9._-]+/gi, "-");
    const targetPath = path.join(outputFolder, safeName);
    await writeFile(targetPath, file.csv, "utf8");
    console.log(`  Wrote ${targetPath} (${file.questionCount} questions)`);
  }
}
