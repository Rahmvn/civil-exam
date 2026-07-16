import assert from "node:assert/strict";
import test from "node:test";
import {
  clearActivePractice,
  consumePracticeBatch,
  markActivePractice,
  preparePracticeQuestions,
  readActivePractice,
  shufflePracticeItems,
  storePracticeBatch,
} from "../../src/lib/practiceSession.js";

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
}

globalThis.window = { sessionStorage: new MemoryStorage() };

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
  storePracticeBatch("psr", [{ id: "q1" }]);
  assert.deepEqual(consumePracticeBatch("psr"), [{ id: "q1" }]);
  assert.equal(consumePracticeBatch("psr"), null);

  window.sessionStorage.setItem("practice-launch:psr", "{broken");
  assert.equal(consumePracticeBatch("psr"), null);
  storePracticeBatch("", [{ id: "q1" }]);
  assert.equal(consumePracticeBatch(""), null);
});

test("active practice markers are durable, timestamped, and safely cleared", () => {
  markActivePractice("pfm", { batch_number: 2, question_count: 30 });
  const active = readActivePractice("pfm");

  assert.equal(active.batch_number, 2);
  assert.equal(active.question_count, 30);
  assert.equal(Number.isNaN(Date.parse(active.started_at)), false);

  window.sessionStorage.setItem("practice-active:broken", "not-json");
  assert.equal(readActivePractice("broken"), null);
  assert.equal(window.sessionStorage.getItem("practice-active:broken"), null);

  clearActivePractice("pfm");
  assert.equal(readActivePractice("pfm"), null);
});
