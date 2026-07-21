import assert from "node:assert/strict";
import test from "node:test";
import {
  clearActivePractice,
  clearPracticeDraft,
  consumePracticeBatch,
  markActivePractice,
  preparePracticeQuestions,
  readActivePractice,
  readPracticeDraft,
  shufflePracticeItems,
  storePracticeBatch,
  storePracticeDraft,
} from "../../src/lib/practiceSession.js";

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
}

globalThis.window = { sessionStorage: new MemoryStorage() };
const USER_A = "user-a";
const USER_B = "user-b";

test("question preparation preserves batch one and randomizes later batches safely", () => {
  const source = [
    { id: "q1", batch_number: 1 },
    { id: "q2", batch_number: 1 },
    { id: "q3", batch_number: 1 },
  ];
  const firstBatch = preparePracticeQuestions(source, 1);
  const laterBatch = preparePracticeQuestions(source, 2);

  assert.deepEqual(firstBatch.map((question) => question.id), ["q1", "q2", "q3"]);
  assert.deepEqual(firstBatch.map((question) => question.display_order), [1, 2, 3]);
  assert.deepEqual(firstBatch[0].option_order, ["A", "B", "C", "D"]);
  assert.deepEqual([...laterBatch.map((question) => question.id)].sort(), ["q1", "q2", "q3"]);
  laterBatch.forEach((question) => assert.deepEqual([...question.option_order].sort(), ["A", "B", "C", "D"]));
  assert.equal(source[0].display_order, undefined);
  assert.deepEqual(shufflePracticeItems([]), []);
});

test("launch batches are consumed once and malformed storage is discarded", () => {
  storePracticeBatch("psr", [{ id: "q1" }], USER_A);
  assert.equal(consumePracticeBatch("psr", USER_B), null);
  assert.deepEqual(consumePracticeBatch("psr", USER_A), [{ id: "q1" }]);
  assert.equal(consumePracticeBatch("psr", USER_A), null);

  window.sessionStorage.setItem("practice-launch:psr", "{broken");
  assert.equal(consumePracticeBatch("psr", USER_A), null);
  assert.equal(window.sessionStorage.getItem("practice-launch:psr"), null);
  storePracticeBatch("", [{ id: "q1" }], USER_A);
  assert.equal(consumePracticeBatch("", USER_A), null);
});

test("active practice markers are durable, timestamped, and safely cleared", () => {
  markActivePractice("pfm", { batch_number: 2, question_count: 30 }, USER_A);
  const active = readActivePractice("pfm", USER_A);

  assert.equal(active.batch_number, 2);
  assert.equal(active.question_count, 30);
  assert.equal(Number.isNaN(Date.parse(active.started_at)), false);
  assert.equal(readActivePractice("pfm", USER_B), null);

  window.sessionStorage.setItem(`practice-active:${USER_A}:broken`, "not-json");
  assert.equal(readActivePractice("broken", USER_A), null);
  assert.equal(window.sessionStorage.getItem(`practice-active:${USER_A}:broken`), null);

  clearActivePractice("pfm", USER_A);
  assert.equal(readActivePractice("pfm", USER_A), null);
});

test("practice drafts preserve answers and reject corrupt recovery data", () => {
  assert.equal(storePracticeDraft("pfm", {
    questions: [{ id: "q1", option_order: ["A", "B", "C", "D"] }],
    answers: { q1: "B" },
    flagged: ["q1"],
    current_index: 0,
    deadline_at: Date.now() + 60_000,
  }, USER_A), true);

  const draft = readPracticeDraft("pfm", USER_A);
  assert.equal(draft.answers.q1, "B");
  assert.deepEqual(draft.flagged, ["q1"]);
  assert.equal(readPracticeDraft("pfm", USER_B), null);

  window.sessionStorage.setItem(`practice-draft:${USER_A}:broken`, JSON.stringify({ questions: [] }));
  assert.equal(readPracticeDraft("broken", USER_A), null);
  assert.equal(window.sessionStorage.getItem(`practice-draft:${USER_A}:broken`), null);

  clearPracticeDraft("pfm", USER_A);
  assert.equal(readPracticeDraft("pfm", USER_A), null);
});
