const PRACTICE_SESSION_PREFIX = "practice-batch:";

function getSessionKey(subjectSlug) {
  return `${PRACTICE_SESSION_PREFIX}${subjectSlug}`;
}

export function storePracticeBatch(subjectSlug, questions) {
  if (!subjectSlug || !Array.isArray(questions) || questions.length === 0) return;

  window.sessionStorage.setItem(
    getSessionKey(subjectSlug),
    JSON.stringify({
      savedAt: Date.now(),
      questions,
    }),
  );
}

export function readPracticeBatch(subjectSlug) {
  if (!subjectSlug) return null;

  const raw = window.sessionStorage.getItem(getSessionKey(subjectSlug));
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
  window.sessionStorage.removeItem(getSessionKey(subjectSlug));
}
