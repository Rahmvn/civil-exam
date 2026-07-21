const PRACTICE_LAUNCH_PREFIX = "practice-launch:";
const ACTIVE_PRACTICE_PREFIX = "practice-active:";
const PRACTICE_DRAFT_PREFIX = "practice-draft:";
const OPTION_KEYS = ["A", "B", "C", "D"];

function getScopedKey(prefix, subjectSlug, userId) {
  if (!subjectSlug || !userId) return null;
  return `${prefix}${userId}:${subjectSlug}`;
}

function getLaunchKey(subjectSlug, userId) {
  return getScopedKey(PRACTICE_LAUNCH_PREFIX, subjectSlug, userId);
}

function getActivePracticeKey(subjectSlug, userId) {
  return getScopedKey(ACTIVE_PRACTICE_PREFIX, subjectSlug, userId);
}

function getPracticeDraftKey(subjectSlug, userId) {
  return getScopedKey(PRACTICE_DRAFT_PREFIX, subjectSlug, userId);
}

function removeLegacyValue(prefix, subjectSlug) {
  if (!subjectSlug) return;
  removeSessionValue(`${prefix}${subjectSlug}`);
}

function readSessionValue(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionValue(key, value) {
  try {
    window.sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeSessionValue(key) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in restricted browser modes.
  }
}

function randomIndex(maxExclusive) {
  if (maxExclusive <= 1) return 0;

  if (globalThis.crypto?.getRandomValues) {
    const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
    const buffer = new Uint32Array(1);

    do {
      globalThis.crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);

    return buffer[0] % maxExclusive;
  }

  return Math.floor(Math.random() * maxExclusive);
}

export function shufflePracticeItems(items) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

export function preparePracticeQuestions(questions, batchNumber) {
  if (!Array.isArray(questions)) return [];

  const shouldShuffle = Number(batchNumber ?? questions[0]?.batch_number ?? 1) >= 2;
  const orderedQuestions = shouldShuffle ? shufflePracticeItems(questions) : [...questions];

  return orderedQuestions.map((question, index) => ({
    ...question,
    display_order: index + 1,
    option_order: shouldShuffle ? shufflePracticeItems(OPTION_KEYS) : [...OPTION_KEYS],
  }));
}

export function storePracticeBatch(subjectSlug, questions, userId) {
  const key = getLaunchKey(subjectSlug, userId);
  if (!key || !Array.isArray(questions) || questions.length === 0) return;

  removeLegacyValue(PRACTICE_LAUNCH_PREFIX, subjectSlug);
  writeSessionValue(
    key,
    JSON.stringify({ questions }),
  );
}

export function consumePracticeBatch(subjectSlug, userId) {
  const key = getLaunchKey(subjectSlug, userId);
  if (!key) return null;

  removeLegacyValue(PRACTICE_LAUNCH_PREFIX, subjectSlug);
  const raw = readSessionValue(key);
  removeSessionValue(key);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.questions) ? parsed.questions : null;
  } catch {
    return null;
  }
}

export function clearPracticeBatch(subjectSlug, userId) {
  const key = getLaunchKey(subjectSlug, userId);
  removeLegacyValue(PRACTICE_LAUNCH_PREFIX, subjectSlug);
  if (key) removeSessionValue(key);
}

export function readActivePractice(subjectSlug, userId) {
  const key = getActivePracticeKey(subjectSlug, userId);
  if (!key) return null;

  removeLegacyValue(ACTIVE_PRACTICE_PREFIX, subjectSlug);
  const raw = readSessionValue(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    removeSessionValue(key);
    return null;
  }
}

export function markActivePractice(subjectSlug, details = {}, userId) {
  const key = getActivePracticeKey(subjectSlug, userId);
  if (!key) return;

  removeLegacyValue(ACTIVE_PRACTICE_PREFIX, subjectSlug);
  writeSessionValue(
    key,
    JSON.stringify({
      ...details,
      started_at: new Date().toISOString(),
    }),
  );
}

export function clearActivePractice(subjectSlug, userId) {
  const key = getActivePracticeKey(subjectSlug, userId);
  removeLegacyValue(ACTIVE_PRACTICE_PREFIX, subjectSlug);
  if (key) removeSessionValue(key);
}

export function storePracticeDraft(subjectSlug, draft, userId) {
  const key = getPracticeDraftKey(subjectSlug, userId);
  if (!key || !Array.isArray(draft?.questions) || draft.questions.length === 0) return false;
  removeLegacyValue(PRACTICE_DRAFT_PREFIX, subjectSlug);
  return writeSessionValue(
    key,
    JSON.stringify({ ...draft, saved_at: new Date().toISOString() }),
  );
}

export function readPracticeDraft(subjectSlug, userId) {
  const key = getPracticeDraftKey(subjectSlug, userId);
  if (!key) return null;
  removeLegacyValue(PRACTICE_DRAFT_PREFIX, subjectSlug);
  const raw = readSessionValue(key);
  if (!raw) return null;

  try {
    const draft = JSON.parse(raw);
    if (!Array.isArray(draft?.questions) || draft.questions.length === 0) throw new Error("Invalid practice draft");
    if (!Number.isFinite(Number(draft.deadline_at))) throw new Error("Invalid practice deadline");
    return draft;
  } catch {
    removeSessionValue(key);
    return null;
  }
}

export function clearPracticeDraft(subjectSlug, userId) {
  const key = getPracticeDraftKey(subjectSlug, userId);
  removeLegacyValue(PRACTICE_DRAFT_PREFIX, subjectSlug);
  if (key) removeSessionValue(key);
}
