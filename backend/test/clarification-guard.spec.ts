import { clarificationReply, decideClarification } from '../src/modules/workspaces/clarification-guard';
import { validateInterpretation } from '../src/modules/workspaces/conversation-intent';
import { unknownSemanticInterpretation } from '../src/modules/workspaces/multilingual-semantics';
import type { MultilingualSemanticInterpretation } from '../src/modules/workspaces/multilingual-semantics';

const semantic = (overrides: Partial<MultilingualSemanticInterpretation> = {}): MultilingualSemanticInterpretation => ({
  language: { primary: 'English', scripts: ['Latin'], mixed: false, certainty: 'CLEAR', signals: [] },
  responseLanguagePreference: null, socialClassification: 'OTHER', informationNeed: 'UNKNOWN', businessScopeAssessment: 'UNKNOWN',
  intents: [{ category: 'UNKNOWN', polarity: 'UNCERTAIN' }], entities: [], uncertainty: 'UNKNOWN', clarificationRequired: true,
  ...overrides,
});

describe('clarification guard', () => {
  it('asks one focused question for ambiguous payment intent and avoids sensitive data', () => {
    const decision = decideClarification(semantic({ informationNeed: 'AMBIGUOUS', uncertainty: 'AMBIGUOUS', intents: [{ category: 'PAYMENT_INQUIRY', polarity: 'AFFIRMATIVE' }], clarificationRequired: true }));
    expect(decision).toEqual({ required: true, reason: 'AMBIGUOUS_INTENT' });
    const reply = clarificationReply(decision.reason!, 'Hinglish');
    expect(reply).toContain('general payment ya refund');
    expect(reply).not.toMatch(/password|OTP|card|CVV|secret/i);
    expect(reply.match(/[?؟]/gu)).toHaveLength(1);
  });
  it('clarifies unresolved follow-ups and inconsistent polarity', () => {
    expect(decideClarification(semantic({ uncertainty: 'NONE', clarificationRequired: false, intents: [{ category: 'FOLLOW_UP', polarity: 'AFFIRMATIVE' }] } )).reason).toBe('AMBIGUOUS_REFERENCE');
    expect(decideClarification(semantic({ uncertainty: 'NONE', clarificationRequired: false, intents: [{ category: 'FOLLOW_UP', polarity: 'AFFIRMATIVE' }] } ), 'follow_up', true)).toEqual({ required: false });
    expect(decideClarification(semantic({ uncertainty: 'NONE', clarificationRequired: false, intents: [{ category: 'CORRECTION', polarity: 'UNCERTAIN' }] } )).reason).toBe('CONTRADICTORY_SIGNALS');
    expect(decideClarification(semantic({ uncertainty: 'NONE', clarificationRequired: false, intents: [{ category: 'SUPPORT_REQUEST', polarity: 'AFFIRMATIVE' }] }), 'business', false, 'CONTRADICTION')).toEqual({ required: true, reason: 'CONTRADICTORY_SIGNALS' });
  });
  it('provides bounded Hindi and English rephrase requests for unknown interpretation', () => {
    expect(decideClarification(unknownSemanticInterpretation())).toMatchObject({ required: true, reason: 'UNCERTAIN_LANGUAGE_INTERPRETATION' });
    expect(clarificationReply('UNCERTAIN_LANGUAGE_INTERPRETATION', 'Hindi')).toContain('कृपया थोड़ा और स्पष्ट करें');
    expect(clarificationReply('UNCERTAIN_LANGUAGE_INTERPRETATION', 'English')).toBe('Could you rephrase what you need help with?');
  });
  it('treats a missing structured semantic payload with an unknown legacy intent as a clarification case', () => {
    const parsed = validateInterpretation(JSON.stringify({ retrievalQueries: ['What?'], language: 'English', intent: 'unknown', needsClarification: true }), 'What?');
    expect(parsed.value).not.toBeNull();
    expect(decideClarification(parsed.value!.semantics, parsed.value!.intent)).toEqual({ required: true, reason: 'UNCERTAIN_LANGUAGE_INTERPRETATION' });
  });
});
