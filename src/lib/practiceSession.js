const PRACTICE_LAUNCH_PREFIX = "practice-launch:";
const ACTIVE_PRACTICE_PREFIX = "practice-active:";
const OPTION_KEYS = ["A", "B", "C", "D"];

function getLaunchKey(subjectSlug) {
  return `${PRACTICE_LAUNCH_PREFIX}${subjectSlug}`;
}

function getActivePracticeKey(subjectSlug) {
  return `${ACTIVE_PRACTICE_PREFIX}${subjectSlug}`;
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

  window.sessionStorage.setItem(
    getLaunchKey(subjectSlug),
    JSON.stringify({ questions }),
  );
}

export function consumePracticeBatch(subjectSlug) {
  if (!subjectSlug) return null;

  const key = getLaunchKey(subjectSlug);
  const raw = window.sessionStorage.getItem(key);
  window.sessionStorage.removeItem(key);
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
  window.sessionStorage.removeItem(getLaunchKey(subjectSlug));
}

export function readActivePractice(subjectSlug) {
  if (!subjectSlug) return null;

  const raw = window.sessionStorage.getItem(getActivePracticeKey(subjectSlug));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    window.sessionStorage.removeItem(getActivePracticeKey(subjectSlug));
    return null;
  }
}

export function markActivePractice(subjectSlug, details = {}) {
  if (!subjectSlug) return;

  window.sessionStorage.setItem(
    getActivePracticeKey(subjectSlug),
    JSON.stringify({
      ...details,
      started_at: new Date().toISOString(),
    }),
  );
}

export function clearActivePractice(subjectSlug) {
  if (!subjectSlug) return;
  window.sessionStorage.removeItem(getActivePracticeKey(subjectSlug));
}
