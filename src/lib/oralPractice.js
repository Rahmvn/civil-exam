export const ORAL_DURATION_OPTIONS = [
  { seconds: 180, label: "3 minutes", note: "Focused response" },
  { seconds: 300, label: "5 minutes", note: "More time to develop your answer" },
];

const ORAL_DRAFT_PREFIX = "oral-response-draft:";

function oralDraftKey(attemptId, questionId) {
  return `${ORAL_DRAFT_PREFIX}${attemptId}:${questionId}`;
}

export function storeOralResponseDraft(attemptId, questionId, responseText) {
  if (!attemptId || !questionId) return false;
  try {
    window.sessionStorage.setItem(oralDraftKey(attemptId, questionId), JSON.stringify({
      response_text: String(responseText ?? ""),
      saved_at: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function readOralResponseDraft(attemptId, questionId) {
  if (!attemptId || !questionId) return null;
  try {
    const raw = window.sessionStorage.getItem(oralDraftKey(attemptId, questionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.response_text === "string" ? parsed.response_text : null;
  } catch {
    return null;
  }
}

export function clearOralResponseDraft(attemptId, questionId) {
  if (!attemptId || !questionId) return;
  try {
    window.sessionStorage.removeItem(oralDraftKey(attemptId, questionId));
  } catch {
    // Storage can be unavailable in restricted browser modes.
  }
}

export function formatOralTime(totalSeconds) {
  const safeSeconds = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function getServerOffset(serverNow, clientNow = Date.now()) {
  const parsedServerNow = Date.parse(serverNow);
  return Number.isFinite(parsedServerNow) ? parsedServerNow - clientNow : 0;
}

export function getOralRemainingSeconds(deadline, serverOffset = 0, clientNow = Date.now()) {
  const deadlineMs = Date.parse(deadline);
  if (!Number.isFinite(deadlineMs)) return 0;
  return Math.max(0, Math.ceil((deadlineMs - (clientNow + serverOffset)) / 1000));
}

export function getPracticeRoute(subject, setNumber = 1) {
  if (!subject?.slug) return "/practice";
  const encodedSlug = encodeURIComponent(subject.slug);
  const safeSetNumber = Math.max(1, Number(setNumber) || 1);
  const basePath = subject.practice_type === "oral" ? "/oral-practice" : "/practice";
  return `${basePath}/${encodedSlug}?batch=${safeSetNumber}`;
}
