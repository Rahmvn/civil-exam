import path from "node:path";

import { REPORT_DIRECTORIES } from "./contentRules.mjs";
import {
  parseCliArgs,
  readTextFile,
  toBulletList,
  writeMarkdownReport,
} from "./contentUtils.mjs";

function detectHeadings(lines) {
  const headingPattern = /^[#A-Z0-9\s/,&().:'"-]{6,}$/;

  return lines
    .map((line, index) => ({
      index,
      value: line.trim(),
    }))
    .filter(({ value }) => {
      if (!value) {
        return false;
      }

      const normalized = value.replace(/^#+/, "").trim();

      if (!headingPattern.test(value) && !headingPattern.test(normalized)) {
        return false;
      }

      return (
        normalized.includes("FINANCIAL") ||
        normalized.includes("SERVICE") ||
        normalized.includes("CURRENT") ||
        normalized.includes("ANSWER") ||
        normalized.includes("ORAL") ||
        normalized.includes("SECRETAR") ||
        normalized.includes("QUESTIONS")
      );
    })
    .map((heading) => ({
      ...heading,
      value: heading.value.replace(/^#+/, "").trim(),
    }));
}

function inspectSections(lines, headings) {
  const sections = [];

  for (let index = 0; index < headings.length; index += 1) {
    const start = headings[index].index;
    const end = headings[index + 1]?.index ?? lines.length;
    const sectionLines = lines.slice(start, end);
    const heading = headings[index].value;
    const joined = sectionLines.join("\n");
    const normalizedHeading = heading.toLowerCase();

    const numberedQuestionMatches = joined.match(/^\s*\d+[.)]\s+/gm) || [];
    const answerKeyMatches = joined.match(/^\s*\d+[.)]\s*[A-Da-d]\b/gm) || [];
    const looksOral = /oral|interview|permanent secretar/i.test(normalizedHeading);
    const isAnswerSection = normalizedHeading.includes("answer");
    const optionAnomalyMatches =
      joined.match(/^\s*[A-Da-d][.)]\s+/gm)?.length || 0;

    sections.push({
      heading,
      startLine: start + 1,
      endLine: end,
      numberedQuestionCount: numberedQuestionMatches.length,
      answerKeyCount: answerKeyMatches.length,
      looksOral,
      isAnswerSection,
      optionLabelCount: optionAnomalyMatches,
    });
  }

  return sections;
}

function buildWarnings(sections) {
  const warnings = [];

  for (const section of sections) {
    if (section.isAnswerSection && section.answerKeyCount > 0) {
      warnings.push(
        `${section.heading}: answer-key-like entries detected (${section.answerKeyCount}).`,
      );
    }

    if (section.looksOral) {
      warnings.push(`${section.heading}: oral/interview-style content detected.`);
    }

    if (section.numberedQuestionCount === 0 && section.answerKeyCount === 0) {
      warnings.push(
        `${section.heading}: no obvious numbered questions detected; manual inspection recommended.`,
      );
    }
  }

  return warnings;
}

function renderReport({ sourceFile, headings, sections, warnings }) {
  const objectiveSections = sections.filter(
    (section) =>
      section.numberedQuestionCount > 0 &&
      !section.looksOral &&
      !section.isAnswerSection,
  );
  const answerSections = sections.filter(
    (section) => section.isAnswerSection && section.answerKeyCount > 0,
  );
  const oralSections = sections.filter((section) => section.looksOral);

  return `# Content Inspection Report

## Source File

- \`${sourceFile}\`

## Detected Headings

${toBulletList(headings.map((heading) => `${heading.value} (line ${heading.index + 1})`))}

## Estimated Objective Question Counts

- Estimated numbered items are heuristic and should be confirmed by conversion/validation reports.

${toBulletList(
  objectiveSections.map(
    (section) =>
      `${section.heading}: ${section.numberedQuestionCount} numbered items`,
  ),
)}

## Answer-Key Sections

${toBulletList(
  answerSections.map(
    (section) => `${section.heading}: ${section.answerKeyCount} answer-key-like lines`,
  ),
)}

## Oral Sections

${toBulletList(
  oralSections.map(
    (section) => `${section.heading}: oral/interview-style content detected`,
  ),
)}

## Warnings

${toBulletList(warnings)}

## Recommended Next Action

- Run conversion into review JSON only after confirming the detected section boundaries.
- Keep oral/interview content separate from CBT questions.
- Review answer-key alignment and any malformed numbering before treating the file as import-ready.
`;
}

async function main() {
  const args = parseCliArgs();
  const sourceFile = args.file;

  if (!sourceFile) {
    console.error('Missing required argument: --file "path/to/source.txt"');
    process.exitCode = 1;
    return;
  }

  const rawText = await readTextFile(sourceFile);
  const lines = rawText.split(/\r?\n/);
  const headings = detectHeadings(lines);
  const sections = inspectSections(lines, headings);
  const warnings = buildWarnings(sections);

  const report = renderReport({
    sourceFile,
    headings,
    sections,
    warnings,
  });

  const reportPath = await writeMarkdownReport({
    directory: REPORT_DIRECTORIES.reports,
    prefix: "inspection",
    sourceFile,
    content: report,
  });

  const objectiveCount = sections.reduce(
    (total, section) =>
      total +
      (section.looksOral || section.isAnswerSection ? 0 : section.numberedQuestionCount),
    0,
  );
  const answerSectionCount = sections.filter(
    (section) => section.isAnswerSection && section.answerKeyCount > 0,
  ).length;
  const oralCount = sections.filter((section) => section.looksOral).length;

  console.log(`Inspection complete for ${path.basename(sourceFile)}`);
  console.log(`Headings detected: ${headings.length}`);
  console.log(`Estimated objective items: ${objectiveCount}`);
  console.log(`Answer-key-like sections: ${answerSectionCount}`);
  console.log(`Oral-like sections: ${oralCount}`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`Report: ${reportPath}`);
}

main().catch((error) => {
  console.error(`Inspection failed: ${error.message}`);
  process.exitCode = 1;
});
