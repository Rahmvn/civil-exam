import assert from "node:assert/strict";
import test from "node:test";
import {
  convertBulkObjectiveTextToCsv,
  getBulkConversionReport,
  parseBulkObjectiveText,
  splitBulkObjectiveSection,
  toAdminImportCsv,
} from "../../src/lib/bulkTextConverter.js";
import { parseCsv, validateAdminImportRows } from "../../src/lib/adminContent.js";

const SAMPLE_TEXT = `
A. PUBLIC FINANCIAL MANAGEMENT- ACCOUNTS, ADMIN., AUDIT, PUBLIC PROCUREMENT QUESTIONS

1. In 1494, ...................published a treatise on the double-entry system of bookkeeping.
a. Thomas Aquinas
b. Akintola Williams
c. Luca Pacioli
d. Albert Einstein

2. ...............are the prices paid for living in an organized, and civilized society.
a. Stipends
b. Wages
c. Remunerations
d. Taxes

3. The Audit Ordinance Act 1956 requires the Accountant-General to submit a financial report to the Auditor-General within ..........after the end of each financial year.
a. Three (3) months
b. Nine (9) months
c. Seven (7) months
d. Six (6) months.

PUBLIC FINANCIAL MANAGEMENT (ANSWERS)
1. c
2. d
3. c
`;

test("bulk objective parser converts numbered questions and separate answer keys", () => {
  const parsed = parseBulkObjectiveText(SAMPLE_TEXT);

  assert.equal(parsed.sections.length, 1);
  assert.equal(parsed.sections[0].questions.length, 3);
  assert.equal(parsed.sections[0].questions[0].correct_option, "C");
  assert.equal(parsed.sections[0].questions[1].option_d, "Taxes");
  assert.match(parsed.sections[0].matchedAnswerTitle, /answers/i);
});

test("bulk objective parser handles compact option punctuation and wrapped option text", () => {
  const parsed = parseBulkObjectiveText(`
PUBLIC FINANCIAL MANAGEMENT QUESTIONS

18. .............. may be issued in very exceptional cases.
a.Circumstantial General Warrant
b. Supplementary (Contingencies) Warrant
continued wording for option B.
c. Provisional General Warrant
d. Development Fund Warrant.

PUBLIC FINANCIAL MANAGEMENT ANSWERS
18. b
`);

  const question = parsed.sections[0].questions[0];
  assert.equal(question.option_a, "Circumstantial General Warrant");
  assert.equal(question.option_b, "Supplementary (Contingencies) Warrant continued wording for option B.");
  assert.equal(question.correct_option, "B");
});

test("bulk conversion refuses to invent missing answers", () => {
  const parsed = parseBulkObjectiveText(`
CURRENT AFFAIRS QUESTIONS

1. Who is the current minister?
a. A person
b. Another person
c. Third person
d. Fourth person
`);
  const report = getBulkConversionReport(parsed.sections[0]);

  assert.equal(parsed.sections[0].questions[0].correct_option, "");
  assert.equal(report.answerCount, 0);
  assert.equal(report.needsAttentionCount, 1);
  assert.match(report.validationErrors.join("\n"), /correct answer must be A, B, C, or D/i);
});

test("bulk CSV output matches the existing admin import parser", () => {
  const [conversion] = convertBulkObjectiveTextToCsv(SAMPLE_TEXT);
  const csv = conversion.files[0].csv;
  const rows = parseCsv(csv);

  assert.deepEqual(rows[0], [
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
  ]);
  assert.equal(rows[1][6], "C");
  assert.deepEqual(validateAdminImportRows(conversion.section.questions).errors, []);
});

test("bulk CSV neutralizes spreadsheet formulas without changing normal question text", () => {
  const csv = toAdminImportCsv([{
    batch_position: 1,
    question_text: "=unsafe formula",
    option_a: "+bad",
    option_b: "Normal",
    option_c: "Normal C",
    option_d: "Normal D",
    correct_option: "B",
    explanation: "",
    reference_note: "",
    difficulty: "medium",
  }]);
  const rows = parseCsv(csv);

  assert.equal(rows[1][1], "'=unsafe formula");
  assert.equal(rows[1][2], "'+bad");
  assert.equal(rows[1][3], "Normal");
});

test("bulk sections split into upload-sized CSV chunks", () => {
  const questions = Array.from({ length: 201 }, (_, index) => ({
    batch_position: index + 1,
    source_number: index + 1,
    question_text: `Question ${index + 1}`,
    option_a: "A",
    option_b: "B",
    option_c: "C",
    option_d: "D",
    correct_option: "A",
    explanation: "",
    reference_note: "",
    difficulty: "medium",
  }));
  const chunks = splitBulkObjectiveSection({ title: "Large section", questions });

  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].questions.length, 200);
  assert.equal(chunks[1].questions.length, 1);
  assert.equal(chunks[1].questions[0].batch_position, 1);
});
