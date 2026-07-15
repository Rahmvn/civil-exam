import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import {
  parseAdminImportFile,
  parseCsv,
  slugifyModuleName,
  validateAdminImportRows,
} from "../../src/lib/adminContent.js";

function validQuestion(overrides = {}) {
  return {
    batch_position: 1,
    question_text: "Which record should be checked first?",
    option_a: "Vote book",
    option_b: "Visitor log",
    option_c: "Blank form",
    option_d: "Personal note",
    correct_option: "A",
    explanation: "The vote book is the official control record.",
    reference_note: "Test source",
    difficulty: "medium",
    ...overrides,
  };
}

test("module names become stable URL slugs", () => {
  assert.equal(slugifyModuleName("  Public Financial Management (2026)  "), "public-financial-management-2026");
  assert.equal(slugifyModuleName("Rules---and   Conduct"), "rules-and-conduct");
});

test("CSV parsing preserves quoted commas, line breaks, and escaped quotes", () => {
  const rows = parseCsv('question,answer\r\n"What, exactly?","A ""quoted""\nanswer"');

  assert.deepEqual(rows, [
    ["question", "answer"],
    ["What, exactly?", 'A "quoted"\nanswer'],
  ]);
  assert.throws(() => parseCsv('question\n"unfinished'), /unclosed quoted value/i);
});

test("blank positions are assigned, but explicit zero is rejected", () => {
  const blank = validateAdminImportRows([validQuestion({ batch_position: "" })], 4);
  const zero = validateAdminImportRows([validQuestion({ batch_position: 0 })]);

  assert.equal(blank.questions[0].batch_position, 4);
  assert.deepEqual(blank.errors, []);
  assert.match(zero.errors.join("\n"), /position must be a positive whole number/i);
});

test("question validation reports content and ordering conflicts together", () => {
  const result = validateAdminImportRows([
    validQuestion({ option_b: "Vote book", correct_option: "E", difficulty: "expert" }),
    validQuestion({ question_text: "  WHICH RECORD SHOULD BE CHECKED FIRST?  " }),
  ]);

  const errors = result.errors.join("\n");
  assert.match(errors, /answer options must be different/i);
  assert.match(errors, /correct answer must be A, B, C, or D/i);
  assert.match(errors, /difficulty must be easy, medium, or hard/i);
  assert.match(errors, /position 1 is duplicated/i);
  assert.match(errors, /question text is duplicated/i);
});

test("question validation enforces required fields and the 200-row limit", () => {
  const missing = validateAdminImportRows([validQuestion({ option_d: "" })]);

  assert.match(missing.errors.join("\n"), /option d is required/i);
  assert.throws(
    () => validateAdminImportRows(Array.from({ length: 201 }, (_, index) => validQuestion({ batch_position: index + 1 }))),
    /no more than 200 questions/i,
  );
});

test("CSV and JSON files normalize into the same import shape", async () => {
  const csv = new File([
    "position,question_text,option_a,option_b,option_c,option_d,correct_answer,explanation,reference,difficulty\n"
      + '1,"Which record?","A","B","C","D",B,"Because B","Source",easy',
  ], "questions.csv", { type: "text/csv" });
  const json = new File([
    JSON.stringify([validQuestion({ batch_position: 2, correct_option: "b", difficulty: "HARD" })]),
  ], "questions.json", { type: "application/json" });

  const csvResult = await parseAdminImportFile(csv);
  const jsonResult = await parseAdminImportFile(json);

  assert.deepEqual(csvResult.errors, []);
  assert.equal(csvResult.questions[0].correct_option, "B");
  assert.equal(csvResult.questions[0].reference_note, "Source");
  assert.deepEqual(jsonResult.errors, []);
  assert.equal(jsonResult.questions[0].correct_option, "B");
  assert.equal(jsonResult.questions[0].difficulty, "hard");
  assert.equal(csvResult.metadata.format, "csv");
  assert.equal(jsonResult.metadata.format, "json");
});

test("unsupported and oversized files are rejected before parsing", async () => {
  const textFile = new File(["questions"], "questions.txt", { type: "text/plain" });
  const oversized = new File([new Uint8Array((5 * 1024 * 1024) + 1)], "questions.json");

  await assert.rejects(() => parseAdminImportFile(textFile), /use a \.csv, \.xlsx, or \.json file/i);
  await assert.rejects(() => parseAdminImportFile(oversized), /smaller than 5 MB/i);
});
