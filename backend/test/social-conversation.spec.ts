import { classifyDeterministicSocialMessage, decideSocialResponse } from '../src/modules/workspaces/social-conversation';
import { unknownSemanticInterpretation } from '../src/modules/workspaces/multilingual-semantics';

describe('safe conversational recovery classification', () => {
  it.each([
    ['Kaise ho bhai?', 'WELLBEING_EXCHANGE', 'Hinglish'],
    ['Thik hai', 'ACKNOWLEDGMENT', 'Hinglish'],
    ['Thanks', 'GRATITUDE', 'English'],
  ] as const)('recognizes a whole-message social act: %s', (message, category, language) => {
    expect(classifyDeterministicSocialMessage(message)).toEqual({ category, language });
  });

  it.each(['Nahi, blue wale', 'Nahi, mujhe refund chahiye'])('does not classify substantive corrections or requests as social: %s', (message) => {
    expect(classifyDeterministicSocialMessage(message)).toBeNull();
  });

  it('uses validated semantics as advisory social routing and keeps a business request on the normal path', () => {
    const social = {
      ...unknownSemanticInterpretation(), socialClassification: 'WELLBEING_EXCHANGE' as const,
      informationNeed: 'UNKNOWN' as const, uncertainty: 'NONE' as const, clarificationRequired: false,
      intents: [{ category: 'WELLBEING_EXCHANGE' as const, polarity: 'AFFIRMATIVE' as const }],
    };
    expect(decideSocialResponse({ classification: social.socialClassification, semantic: social, legacyIntent: 'wellbeing', message: 'Kaise ho bhai?' }).decision).toBe('SAFE_SOCIAL_RESPONSE');
    expect(decideSocialResponse({ classification: 'BUSINESS_REQUEST_WITH_GREETING', semantic: social, legacyIntent: 'wellbeing', message: 'Kaise ho? refund policy kya hai?' }).decision).toBe('CONTINUE_BUSINESS_PIPELINE');
  });

  it('does not let a stale legacy label route a validated social act into evidence retrieval', () => {
    const social = {
      ...unknownSemanticInterpretation(), socialClassification: 'WELLBEING_EXCHANGE' as const,
      informationNeed: 'UNKNOWN' as const, uncertainty: 'NONE' as const, clarificationRequired: false,
      intents: [{ category: 'WELLBEING_EXCHANGE' as const, polarity: 'AFFIRMATIVE' as const }],
    };
    expect(decideSocialResponse({ classification: social.socialClassification, semantic: social, legacyIntent: 'conversation_continuation', message: 'Main bhi thik hu' }))
      .toMatchObject({ decision: 'SAFE_SOCIAL_RESPONSE' });
  });
});
