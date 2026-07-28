import { validateAdminImportRows } from "./adminContent.js";

const OBJECTIVE_CSV_HEADERS = [
  "position",
  "question_text",
  "option_a",
  "option_b",
  "option_c",
  "option_d",
  "correct_answer",
  "explanation",
  "reference",
  "difficulty",
];

const ANSWER_SECTION_PATTERN = /\banswers?\b/i;
const QUESTION_PATTERN = /^\s*(\d{1,4})\s*[).]?\s*(.+?)\s*$/;
const OPTION_PATTERN = /^\s*([a-d])\s*[).:]\s*(.+?)\s*$/i;
const ANSWER_ENTRY_PATTERN = /^\s*(\d{1,4})\s*[).:-]?\s*([a-d])\b[).]?\s*$/i;
const MAX_QUESTIONS_PER_FILE = 200;

function cleanText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function normalizeTitle(value) {
  return cleanText(value)
    .replace(/^[A-Z]\s*[).:-]\s*/i, "")
    .replace(/[(][^)]*answers?[^)]*[)]/gi, "")
    .replace(/\banswers?\b/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

function titleTokens(value) {
  return normalizeTitle(value)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !["and", "the", "for", "with", "questions", "objective"].includes(token));
}

function looksLikeHeading(line) {
  const cleaned = cleanText(line);
  if (!cleaned) return false;
  if (ANSWER_ENTRY_PATTERN.test(cleaned)) return false;
  if (cleaned.length > 140) return false;
  if (ANSWER_SECTION_PATTERN.test(cleaned) && !QUESTION_PATTERN.test(cleaned)) return true;
  if (QUESTION_PATTERN.test(cleaned)) return false;

  const letters = cleaned.replace(/[^a-z]/gi, "");
  if (letters.length < 4) return false;
  const uppercase = letters.replace(/[^A-Z]/g, "").length;
  return uppercase / letters.length >= 0.65;
}

function createQuestionSection(title, lineNumber) {
  return {
    id: `section-${lineNumber}`,
    title: cleanText(title) || "Untitled section",
    lineNumber,
    questions: [],
  };
}

function createAnswerSection(title, lineNumber) {
  return {
    id: `answers-${lineNumber}`,
    title: cleanText(title) || "Answers",
    lineNumber,
    answers: new Map(),
  };
}

function appendToQuestion(question, value) {
  const cleaned = cleanText(value);
  if (!cleaned) return;

  const activeOption = question.activeOption;
  if (activeOption) {
    question.options[activeOption] = cleanText(`${question.options[activeOption]} ${cleaned}`);
  } else {
    question.question_text = cleanText(`${question.question_text} ${cleaned}`);
  }
}

function finalizeQuestion(question) {
  if (!question) return null;
  const safeQuestion = { ...question };
  delete safeQuestion.activeOption;
  return {
    ...safeQuestion,
    question_text: cleanText(safeQuestion.question_text),
    options: Object.fromEntries(
      Object.entries(safeQuestion.options).map(([key, value]) => [key, cleanText(value)]),
    ),
  };
}

function sectionMatchScore(questionSection, answerSection) {
  const questionTokens = new Set(titleTokens(questionSection.title));
  const answerTokens = titleTokens(answerSection.title);
  if (answerTokens.length === 0 || questionTokens.size === 0) return 0;

  return answerTokens.reduce((score, token) => score + (questionTokens.has(token) ? 1 : 0), 0)
    / Math.max(answerTokens.length, questionTokens.size);
}

function findBestAnswerSection(questionSection, answerSections, allQuestionSections) {
  if (answerSections.length === 0) return null;
  if (answerSections.length === 1 && allQuestionSections.length === 1) return answerSections[0];

  const ranked = answerSections
    .map((answerSection) => ({
      answerSection,
      score: sectionMatchScore(questionSection, answerSection),
    }))
    .sort((left, right) => right.score - left.score);

  if (ranked[0]?.score > 0) return ranked[0].answerSection;

  const nextAnswerAfterSection = answerSections.find((answerSection) => answerSection.lineNumber > questionSection.lineNumber);
  return nextAnswerAfterSection ?? null;
}

export function parseBulkObjectiveText(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const questionSections = [];
  const answerSections = [];
  let activeQuestionSection = null;
  let activeAnswerSection = null;
  let activeQuestion = null;

  function ensureQuestionSection(lineNumber) {
    if (!activeQuestionSection) {
      activeQuestionSection = createQuestionSection("Questions", lineNumber);
      questionSections.push(activeQuestionSection);
    }
    activeAnswerSection = null;
    return activeQuestionSection;
  }

  function finishActiveQuestion() {
    const finalized = finalizeQuestion(activeQuestion);
    if (finalized && activeQuestionSection) activeQuestionSection.questions.push(finalized);
    activeQuestion = null;
  }

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const cleaned = cleanText(line);
    if (!cleaned) return;

    const answerEntry = cleaned.match(ANSWER_ENTRY_PATTERN);
    if (activeAnswerSection && answerEntry) {
      activeAnswerSection.answers.set(Number(answerEntry[1]), answerEntry[2].toUpperCase());
      return;
    }

    if (activeAnswerSection && !looksLikeHeading(cleaned)) return;

    const optionEntry = cleaned.match(OPTION_PATTERN);
    if (activeQuestion && optionEntry) {
      const option = optionEntry[1].toUpperCase();
      activeQuestion.options[option] = cleanText(optionEntry[2]);
      activeQuestion.activeOption = option;
      return;
    }

    if (looksLikeHeading(cleaned)) {
      finishActiveQuestion();
      if (ANSWER_SECTION_PATTERN.test(cleaned)) {
        activeAnswerSection = createAnswerSection(cleaned, lineNumber);
        answerSections.push(activeAnswerSection);
      } else {
        activeQuestionSection = createQuestionSection(cleaned, lineNumber);
        questionSections.push(activeQuestionSection);
        activeAnswerSection = null;
      }
      return;
    }

    const questionEntry = cleaned.match(QUESTION_PATTERN);
    if (questionEntry) {
      finishActiveQuestion();
      ensureQuestionSection(lineNumber);
      activeQuestion = {
        source_number: Number(questionEntry[1]),
        question_text: cleanText(questionEntry[2]),
        options: { A: "", B: "", C: "", D: "" },
        lineNumber,
        activeOption: "",
      };
      return;
    }

    if (activeQuestion) appendToQuestion(activeQuestion, cleaned);
  });

  finishActiveQuestion();

  const sections = questionSections
    .filter((section) => section.questions.length > 0)
    .map((section) => {
      const answerSection = findBestAnswerSection(section, answerSections, questionSections);
      return {
        ...section,
        matchedAnswerTitle: answerSection?.title ?? "",
        questions: section.questions.map((question, index) => ({
          batch_position: index + 1,
          source_number: question.source_number,
          question_text: question.question_text,
          option_a: question.options.A,
          option_b: question.options.B,
          option_c: question.options.C,
          option_d: question.options.D,
          correct_option: answerSection?.answers.get(question.source_number) ?? "",
          explanation: "",
          reference_note: "",
          difficulty: "medium",
          lineNumber: question.lineNumber,
        })),
      };
    });

  return {
    sections,
    answerSections: answerSections.map((section) => ({
      id: section.id,
      title: section.title,
      lineNumber: section.lineNumber,
      answerCount: section.answers.size,
    })),
  };
}

export function getBulkConversionReport(section) {
  const answerCount = section.questions.filter((question) => question.correct_option).length;
  const completeCount = section.questions.filter((question) => (
    question.question_text
    && question.option_a
    && question.option_b
    && question.option_c
    && question.option_d
    && question.correct_option
  )).length;
  const validationErrors = splitBulkObjectiveSection(section)
    .flatMap((chunk) => validateAdminImportRows(chunk.questions, 1, "objective").errors
      .map((error) => (
        chunk.chunkCount > 1 ? `File ${chunk.chunkIndex}: ${error}` : error
      )));

  return {
    title: section.title,
    questionCount: section.questions.length,
    answerCount,
    completeCount,
    needsAttentionCount: section.questions.length - completeCount,
    validationErrors,
    matchedAnswerTitle: section.matchedAnswerTitle,
    requiresSplit: section.questions.length > MAX_QUESTIONS_PER_FILE,
    fileCount: Math.max(1, Math.ceil(section.questions.length / MAX_QUESTIONS_PER_FILE)),
  };
}

function neutralizeSpreadsheetFormula(value) {
  const text = String(value ?? "");
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function csvCell(value) {
  const text = neutralizeSpreadsheetFormula(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toAdminImportCsv(questions) {
  const rows = [OBJECTIVE_CSV_HEADERS];
  questions.forEach((question, index) => {
    rows.push([
      question.batch_position || index + 1,
      question.question_text,
      question.option_a,
      question.option_b,
      question.option_c,
      question.option_d,
      question.correct_option,
      question.explanation ?? "",
      question.reference_note ?? "",
      question.difficulty || "medium",
    ]);
  });

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function splitBulkObjectiveSection(section, chunkSize = MAX_QUESTIONS_PER_FILE) {
  const chunks = [];
  for (let index = 0; index < section.questions.length; index += chunkSize) {
    chunks.push({
      ...section,
      chunkIndex: chunks.length + 1,
      chunkCount: Math.ceil(section.questions.length / chunkSize),
      questions: section.questions.slice(index, index + chunkSize).map((question, questionIndex) => ({
        ...question,
        batch_position: questionIndex + 1,
      })),
    });
  }
  return chunks;
}

export function convertBulkObjectiveTextToCsv(text, { sectionTitle = "" } = {}) {
  const parsed = parseBulkObjectiveText(text);
  const sections = sectionTitle
    ? parsed.sections.filter((section) => normalizeTitle(section.title).includes(normalizeTitle(sectionTitle)))
    : parsed.sections;

  return sections.map((section) => ({
    section,
    report: getBulkConversionReport(section),
    files: splitBulkObjectiveSection(section).map((chunk) => ({
      name: `${normalizeTitle(section.title).replace(/\s+/g, "-") || "questions"}${chunk.chunkCount > 1 ? `-${chunk.chunkIndex}` : ""}.csv`,
      csv: toAdminImportCsv(chunk.questions),
      questionCount: chunk.questions.length,
    })),
  }));
}
