import assert from "node:assert/strict";
import test from "node:test";
import {
  formatOralTime,
  getOralRemainingSeconds,
  getPracticeRoute,
  getServerOffset,
} from "../../src/lib/oralPractice.js";

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
