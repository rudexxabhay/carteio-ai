import type { MultilingualSemanticInterpretation } from './multilingual-semantics';

export type BusinessScopeOutcome = 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'PARTIALLY_IN_SCOPE' | 'UNCERTAIN';
export type BusinessScopeReason = 'TRUSTED_BUSINESS_CONTEXT_AND_RELEVANT_REQUEST' | 'MODEL_CANDIDATE_OUTSIDE_CONFIGURED_BUSINESS' | 'MODEL_CANDIDATE_PARTIAL_SCOPE' | 'SCOPE_SIGNAL_CONFLICT' | 'BUSINESS_CONTEXT_NOT_CONFIGURED' | 'SCOPE_INTERPRETATION_UNKNOWN';
export type BusinessScopeDecision = Readonly<{ outcome: BusinessScopeOutcome; reason: BusinessScopeReason; redirectAllowed: boolean }>;

const potentiallyBusinessRelatedIntents = new Set([
  'BUSINESS_INFORMATION', 'KNOWLEDGE_QUESTION', 'PRODUCT_INQUIRY', 'PRICING_INQUIRY',
  'AVAILABILITY_INQUIRY', 'STATUS_INQUIRY', 'BOOKING_INQUIRY', 'APPOINTMENT_INFORMATION',
  'PAYMENT_INQUIRY', 'REFUND_INQUIRY', 'SUPPORT_REQUEST', 'COMPLAINT', 'CLARIFICATION',
  'CORRECTION', 'FOLLOW_UP',
]);

/**
 * Scope assessment can only narrow conversational scope. It never enables a
 * capability or source. Redirects require a server-resolved business context;
 * contradictory or missing signals remain uncertain and use normal grounding.
 */
export function decideBusinessScope(input: {
  semantic: MultilingualSemanticInterpretation | null;
  businessName?: string | null;
  businessPurpose?: string | null;
  businessDescription?: string | null;
}): BusinessScopeDecision {
  const scopeDescriptions = [input.businessPurpose, input.businessDescription]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLocaleLowerCase())
    .filter((value) => value.length > 0 && !/^(?:answer business questions?|customer support|general support|general business(?: information)?|business assistant|support)$/u.test(value));
  // The authenticated organization name establishes which workspace the
  // assistant serves; configured purpose/description provide its domain.
  // Scope decisions still require the validated semantic out-of-scope act.
  const configured = scopeDescriptions.length > 0 || Boolean(input.businessName?.trim());
  if (!configured) return { outcome: 'UNCERTAIN', reason: 'BUSINESS_CONTEXT_NOT_CONFIGURED', redirectAllowed: false };
  if (!input.semantic || input.semantic.businessScopeAssessment === 'UNKNOWN' || input.semantic.businessScopeAssessment === 'UNCERTAIN') {
    return { outcome: 'UNCERTAIN', reason: 'SCOPE_INTERPRETATION_UNKNOWN', redirectAllowed: false };
  }
  const activeIntents = input.semantic.intents.filter((intent) => intent.polarity === 'AFFIRMATIVE').map((intent) => intent.category);
  if (input.semantic.businessScopeAssessment === 'OUT_OF_SCOPE'
      && (activeIntents.some((intent) => potentiallyBusinessRelatedIntents.has(intent))
        || input.semantic.informationNeed === 'MIXED_STATIC_AND_PERSONAL')) {
    return { outcome: 'UNCERTAIN', reason: 'SCOPE_SIGNAL_CONFLICT', redirectAllowed: false };
  }
  if (input.semantic.businessScopeAssessment === 'OUT_OF_SCOPE') {
    // An advisory scope estimate alone is insufficient to stop evidence
    // discovery. Require an explicit out-of-scope candidate and no competing
    // business, unknown, or social intent before redirecting.
    const onlyExplicitOutOfScope = activeIntents.length > 0
      && activeIntents.every((intent) => intent === 'OUT_OF_SCOPE_CANDIDATE')
      && input.semantic.informationNeed !== 'MIXED_STATIC_AND_PERSONAL';
    return onlyExplicitOutOfScope
      ? { outcome: 'OUT_OF_SCOPE', reason: 'MODEL_CANDIDATE_OUTSIDE_CONFIGURED_BUSINESS', redirectAllowed: true }
      : { outcome: 'UNCERTAIN', reason: 'SCOPE_SIGNAL_CONFLICT', redirectAllowed: false };
  }
  if (input.semantic.businessScopeAssessment === 'PARTIALLY_IN_SCOPE') {
    return { outcome: 'PARTIALLY_IN_SCOPE', reason: 'MODEL_CANDIDATE_PARTIAL_SCOPE', redirectAllowed: false };
  }
  return { outcome: 'IN_SCOPE', reason: 'TRUSTED_BUSINESS_CONTEXT_AND_RELEVANT_REQUEST', redirectAllowed: false };
}

