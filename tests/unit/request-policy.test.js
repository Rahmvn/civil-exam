import assert from "node:assert/strict";
import test from "node:test";
import { clearReadRequests, readWithPolicy } from "../../src/lib/requestPolicy.js";

const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
globalThis.window = {
  setTimeout(callback, delay) {
    return nativeSetTimeout(callback, delay >= 1000 ? delay : 0);
  },
  clearTimeout: nativeClearTimeout,
};

test("read policy deduplicates concurrent reads with the same key", async () => {
  clearReadRequests();
  let calls = 0;
  const factory = async () => {
    calls += 1;
    await new Promise((resolve) => nativeSetTimeout(resolve, 5));
    return { ok: true };
  };
  const first = readWithPolicy("same-key", factory);
  const second = readWithPolicy("same-key", factory);

  assert.strictEqual(first, second);
  assert.deepEqual(await first, { ok: true });
  assert.equal(calls, 1);
});

test("transient reads retry once while business errors fail immediately", async () => {
  clearReadRequests();
  let transientCalls = 0;
  const value = await readWithPolicy("retry", async () => {
    transientCalls += 1;
    if (transientCalls === 1) throw Object.assign(new Error("network request failed"), { status: 503 });
    return "recovered";
  });
  assert.equal(value, "recovered");
  assert.equal(transientCalls, 2);

  let businessCalls = 0;
  await assert.rejects(
    () => readWithPolicy("business", async () => {
      businessCalls += 1;
      throw Object.assign(new Error("validation failed"), { status: 400 });
    }),
    /validation failed/,
  );
  assert.equal(businessCalls, 1);
});

test("slow reads fail with a classified timeout and can be retried later", async () => {
  clearReadRequests();
  await assert.rejects(
    () => readWithPolicy("timeout", () => new Promise(() => {}), { retries: 0, timeoutMs: 5 }),
    (error) => error.name === "RequestTimeoutError" && error.isRequestTimeout === true,
  );
  assert.equal(await readWithPolicy("timeout", async () => "fresh", { retries: 0 }), "fresh");
});
