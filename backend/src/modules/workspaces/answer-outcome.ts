import type { GroundedAnswerPlan } from './grounded-answer-plan';
import type { ConversationVerification } from './conversation.contracts';

export type AnswerOutcome = 'ANSWER_SUPPORTED' | 'ANSWER_PARTIALLY_SUPPORTED' | 'EVIDENCE_INSUFFICIENT' | 'EVIDENCE_CONFLICTING' | 'LIVE_INFORMATION_UNAVAILABLE' | 'GENERATED_CLAIM_REJECTED' | 'PROVIDER_UNAVAILABLE';

/** Server decision from observed stage results, never a model classification.
 * SUPPORTED means existing verification checks passed, not universal entailment.
 */
export function answerOutcome(plan: GroundedAnswerPlan, verification?: ConversationVerification, partialPreserved = false): AnswerOutcome {
  if (verification && !verification.accepted) return 'GENERATED_CLAIM_REJECTED';
  if (plan.requiresLiveLimitation) return 'LIVE_INFORMATION_UNAVAILABLE';
  if (plan.aspects.some((aspect) => aspect.status === 'POTENTIAL_CONFLICT')) return 'EVIDENCE_CONFLICTING';
  if (plan.coverage === 'NO_EVIDENCE') return 'EVIDENCE_INSUFFICIENT';
  if (!verification) return 'EVIDENCE_INSUFFICIENT';
  return partialPreserved || plan.coverage === 'PARTIAL_CANDIDATES' ? 'ANSWER_PARTIALLY_SUPPORTED' : 'ANSWER_SUPPORTED';
}
