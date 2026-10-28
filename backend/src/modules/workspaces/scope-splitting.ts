export type ValidatedScopeSplit = Readonly<{ businessQuestion: string; unrelatedQuestion: string }>;

/** A split is admissible only when both parts are verbatim spans of this turn. */
export function validateScopeSplit(value: unknown, originalMessage: string): ValidatedScopeSplit | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => key !== 'businessQuestion' && key !== 'unrelatedQuestion')) return null;
  const businessQuestion = candidate.businessQuestion;
  const unrelatedQuestion = candidate.unrelatedQuestion;
  if (typeof businessQuestion !== 'string' || typeof unrelatedQuestion !== 'string'
    || businessQuestion.trim().length < 3 || unrelatedQuestion.trim().length < 3
    || businessQuestion.length > 300 || unrelatedQuestion.length > 300
    || /[\u0000-\u001f\u007f]/u.test(businessQuestion + unrelatedQuestion)) return null;
  if (!originalMessage.includes(businessQuestion) || !originalMessage.includes(unrelatedQuestion)) return null;
  const businessStart = originalMessage.indexOf(businessQuestion);
  const unrelatedStart = originalMessage.indexOf(unrelatedQuestion);
  const overlaps = businessStart < unrelatedStart + unrelatedQuestion.length && unrelatedStart < businessStart + businessQuestion.length;
  if (overlaps || businessQuestion.trim() === unrelatedQuestion.trim()) return null;
  return Object.freeze({ businessQuestion, unrelatedQuestion });
}
