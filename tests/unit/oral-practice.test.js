import assert from "node:assert/strict";
import test from "node:test";
import {
  clearOralResponseDraft,
  formatOralTime,
  getOralRemainingSeconds,
  getPracticeRoute,
  getServerOffset,
  readOralResponseDraft,
  storeOralResponseDraft,
} from "../../src/lib/oralPractice.js";

class MemoryStorage {
  #values = new Map();
  getItem(key) { return this.#values.has(key) ? this.#values.get(key) : null; }
  setItem(key, value) { this.#values.set(key, String(value)); }
  removeItem(key) { this.#values.delete(key); }
}

globalThis.window = { sessionStorage: new MemoryStorage() };

test("oral timers format without becoming negative", () => {
  assert.equal(formatOralTime(180), "3:00");
  assert.equal(formatOralTime(65), "1:05");
  assert.equal(formatOralTime(-4), "0:00");
});

test("oral countdown uses the server clock offset", () => {
  const clientNow = Date.parse("2026-07-15T12:00:00.000Z");
  const serverNow = "2026-07-15T12:00:05.000Z";
  const deadline = "2026-07-15T12:03:05.000Z";
  const offset = getServerOffset(serverNow, clientNow);

  assert.equal(offset, 5000);
  assert.equal(getOralRemainingSeconds(deadline, offset, clientNow), 180);
  assert.equal(getOralRemainingSeconds(deadline, offset, clientNow + 180_001), 0);
});

test("module practice routes are selected by explicit practice type", () => {
  assert.equal(
    getPracticeRoute({ slug: "oral-questions", practice_type: "oral" }, 2),
    "/oral-practice/oral-questions?batch=2",
  );
  assert.equal(
    getPracticeRoute({ slug: "public-service-rules", practice_type: "objective" }, 1),
    "/practice/public-service-rules?batch=1",
  );
});

test("oral response drafts remain local until the server confirms them", () => {
  assert.equal(storeOralResponseDraft("attempt-1", "question-1", "My latest answer"), true);
  assert.equal(readOralResponseDraft("attempt-1", "question-1"), "My latest answer");
  clearOralResponseDraft("attempt-1", "question-1");
  assert.equal(readOralResponseDraft("attempt-1", "question-1"), null);
});
