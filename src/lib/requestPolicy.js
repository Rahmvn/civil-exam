const inFlightReads = new Map();

function wait(delayMs) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function createTimeoutError() {
  const error = new Error("The request took too long. Please try again.");
  error.name = "RequestTimeoutError";
  error.isRequestTimeout = true;
  return error;
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(createTimeoutError()), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
}

function isTransientReadError(error) {
  if (error?.isRequestTimeout) return true;

  const status = Number(error?.status ?? error?.statusCode ?? 0);
  if (status === 408 || status === 429 || status >= 500) return true;

  const message = String(error?.message ?? "").toLowerCase();
  return ["fetch", "network", "timeout", "timed out", "connection", "failed to connect"].some(
    (part) => message.includes(part),
  );
}

async function executeRead(factory, { retries, timeoutMs }) {
  let attempt = 0;

  while (true) {
    try {
      return await withTimeout(Promise.resolve().then(factory), timeoutMs);
    } catch (error) {
      if (attempt >= retries || !isTransientReadError(error)) throw error;
      attempt += 1;
      await wait(450 * attempt);
    }
  }
}

export function readWithPolicy(key, factory, options = {}) {
  const requestKey = String(key);
  const existingRequest = inFlightReads.get(requestKey);
  if (existingRequest) return existingRequest;

  const request = executeRead(factory, {
    retries: options.retries ?? 1,
    timeoutMs: options.timeoutMs ?? 12000,
  }).finally(() => {
    if (inFlightReads.get(requestKey) === request) {
      inFlightReads.delete(requestKey);
    }
  });

  inFlightReads.set(requestKey, request);
  return request;
}

export function clearReadRequests() {
  inFlightReads.clear();
}
