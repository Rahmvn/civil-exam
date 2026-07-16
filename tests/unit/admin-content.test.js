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

test("objective explanation and reference are optional import guidance", () => {
  const result = validateAdminImportRows([
    validQuestion({ explanation: "", reference_note: "" }),
  ]);

  assert.deepEqual(result.errors, []);
  assert.equal(result.questions[0].explanation, "");
  assert.equal(result.questions[0].reference_note, "");
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

test("oral CSV and JSON files normalize model answers and key points", async () => {
  const csv = new File([
    "position,question_text,model_answer,key_point_1,key_point_2,reference,difficulty\n"
      + '1,"Explain accountability","It is answerability for decisions.","Answerability","Responsible use of resources","PSR",medium',
  ], "oral.csv", { type: "text/csv" });
  const json = new File([JSON.stringify([{
    batch_position: 2,
    question_text: "Explain due process",
    model_answer: "Due process follows approved rules.",
    key_points: ["Approved procedure", "Documented decisions"],
    difficulty: "EASY",
  }])], "oral.json", { type: "application/json" });

  const csvResult = await parseAdminImportFile(csv, 1, "oral");
  const jsonResult = await parseAdminImportFile(json, 1, "oral");

  assert.deepEqual(csvResult.errors, []);
  assert.deepEqual(csvResult.questions[0].key_points, ["Answerability", "Responsible use of resources"]);
  assert.equal(csvResult.questions[0].model_answer, "It is answerability for decisions.");
  assert.deepEqual(jsonResult.errors, []);
  assert.deepEqual(jsonResult.questions[0].key_points, ["Approved procedure", "Documented decisions"]);
  assert.equal(jsonResult.questions[0].difficulty, "easy");
});

test("oral imports reject missing guidance and duplicate key points", () => {
  const result = validateAdminImportRows([{
    batch_position: 1,
    question_text: "Explain accountability",
    model_answer: "",
    key_points: ["Answerability", "answerability"],
  }], 1, "oral");

  assert.match(result.errors.join("\n"), /model answer is required/i);
  assert.match(result.errors.join("\n"), /key points must be different/i);
});

test("unsupported and oversized files are rejected before parsing", async () => {
  const textFile = new File(["questions"], "questions.txt", { type: "text/plain" });
  const oversized = new File([new Uint8Array((5 * 1024 * 1024) + 1)], "questions.json");

  await assert.rejects(() => parseAdminImportFile(textFile), /use a \.csv, \.xlsx, or \.json file/i);
  await assert.rejects(() => parseAdminImportFile(oversized), /smaller than 5 MB/i);
});

test("generated objective imports preserve ordering and answer-key invariants at the 200-row boundary", () => {
  const rows = Array.from({ length: 200 }, (_, index) => {
    const correctOption = ["A", "B", "C", "D"][index % 4];
    return validQuestion({
      batch_position: "",
      question_text: `Generated objective question ${index + 1}, with punctuation?`,
      option_a: `Choice A ${index + 1}`,
      option_b: `Choice B ${index + 1}`,
      option_c: `Choice C ${index + 1}`,
      option_d: `Choice D ${index + 1}`,
      correct_option: correctOption.toLowerCase(),
      difficulty: ["EASY", "medium", "Hard"][index % 3],
    });
  });

  const result = validateAdminImportRows(rows, 11);
  assert.deepEqual(result.errors, []);
  assert.equal(result.questions.length, 200);
  assert.equal(result.questions[0].batch_position, 11);
  assert.equal(result.questions[199].batch_position, 210);

  result.questions.forEach((question) => {
    assert.match(question.correct_option, /^[A-D]$/);
    assert.ok([question.option_a, question.option_b, question.option_c, question.option_d][
      question.correct_option.charCodeAt(0) - 65
    ]);
    assert.equal(new Set([
      question.option_a,
      question.option_b,
      question.option_c,
      question.option_d,
    ]).size, 4);
  });
});

test("generated invalid rows report every independent integrity failure", () => {
  const result = validateAdminImportRows([
    validQuestion({
      batch_position: -1,
      question_text: "",
      option_a: "same",
      option_b: "SAME",
      option_c: "",
      option_d: "same",
      correct_option: "Z",
      difficulty: "expert",
    }),
  ]);
  const errors = result.errors.join("\n");

  assert.match(errors, /question text is required/i);
  assert.match(errors, /option c is required/i);
  assert.match(errors, /position must be a positive whole number/i);
  assert.match(errors, /answer options must be different/i);
  assert.match(errors, /correct answer must be A, B, C, or D/i);
  assert.match(errors, /difficulty must be easy, medium, or hard/i);
  assert.throws(() => validateAdminImportRows([], 1), /no questions/i);
  assert.throws(() => validateAdminImportRows({}, 1), /list of questions/i);
  assert.throws(() => validateAdminImportRows([validQuestion()], 1, "essay"), /valid practice type/i);
});

test("file parsing rejects valid extensions containing the wrong structure without partial output", async () => {
  const objectJson = new File([JSON.stringify({ question_text: "Not an array" })], "questions.json");
  const malformedJson = new File(["[{"], "questions.json");
  const emptyCsv = new File(["position,question_text"], "questions.csv");

  await assert.rejects(() => parseAdminImportFile(objectJson), /list of questions/i);
  await assert.rejects(() => parseAdminImportFile(malformedJson), /JSON|position/i);
  await assert.rejects(() => parseAdminImportFile(emptyCsv), /header and at least one question/i);
});
