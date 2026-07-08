export const FREE_QUESTION_LIMIT = 20;

export function getAnsweredQuestionCount(summary) {
  return Number(summary?.answered_question_count ?? summary?.trial_questions_used ?? 0);
}

export function getFreeQuestionsRemaining(summary) {
  return Math.max(FREE_QUESTION_LIMIT - getAnsweredQuestionCount(summary), 0);
}

export function hasReachedFreeLimit(summary) {
  return !summary?.has_paid_access && getAnsweredQuestionCount(summary) >= FREE_QUESTION_LIMIT;
}
