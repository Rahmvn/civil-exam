const PRACTICE_LAUNCH_PREFIX = "practice-launch:";
const ACTIVE_PRACTICE_PREFIX = "practice-active:";
const PRACTICE_DRAFT_PREFIX = "practice-draft:";
const OPTION_KEYS = ["A", "B", "C", "D"];

function getLaunchKey(subjectSlug) {
  return `${PRACTICE_LAUNCH_PREFIX}${subjectSlug}`;
}

function getActivePracticeKey(subjectSlug) {
  return `${ACTIVE_PRACTICE_PREFIX}${subjectSlug}`;
}

function getPracticeDraftKey(subjectSlug) {
  return `${PRACTICE_DRAFT_PREFIX}${subjectSlug}`;
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

export function storePracticeBatch(subjectSlug, questions) {
  if (!subjectSlug || !Array.isArray(questions) || questions.length === 0) return;

  writeSessionValue(
    getLaunchKey(subjectSlug),
    JSON.stringify({ questions }),
  );
}

export function consumePracticeBatch(subjectSlug) {
  if (!subjectSlug) return null;

  const key = getLaunchKey(subjectSlug);
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

export function clearPracticeBatch(subjectSlug) {
  if (!subjectSlug) return;
  removeSessionValue(getLaunchKey(subjectSlug));
}

export function readActivePractice(subjectSlug) {
  if (!subjectSlug) return null;

  const raw = readSessionValue(getActivePracticeKey(subjectSlug));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    removeSessionValue(getActivePracticeKey(subjectSlug));
    return null;
  }
}

export function markActivePractice(subjectSlug, details = {}) {
  if (!subjectSlug) return;

  writeSessionValue(
    getActivePracticeKey(subjectSlug),
    JSON.stringify({
      ...details,
      started_at: new Date().toISOString(),
    }),
  );
}

export function clearActivePractice(subjectSlug) {
  if (!subjectSlug) return;
  removeSessionValue(getActivePracticeKey(subjectSlug));
}

export function storePracticeDraft(subjectSlug, draft) {
  if (!subjectSlug || !Array.isArray(draft?.questions) || draft.questions.length === 0) return false;
  return writeSessionValue(
    getPracticeDraftKey(subjectSlug),
    JSON.stringify({ ...draft, saved_at: new Date().toISOString() }),
  );
}

export function readPracticeDraft(subjectSlug) {
  if (!subjectSlug) return null;
  const key = getPracticeDraftKey(subjectSlug);
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

export function clearPracticeDraft(subjectSlug) {
  if (!subjectSlug) return;
  removeSessionValue(getPracticeDraftKey(subjectSlug));
}
