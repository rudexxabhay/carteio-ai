import { classifyDeterministicSocialMessage, decideSocialResponse } from '../src/modules/workspaces/social-conversation';
import { unknownSemanticInterpretation } from '../src/modules/workspaces/multilingual-semantics';

describe('safe conversational recovery classification', () => {
  it.each(['Thank you. ', 'धन्यवाद। ', 'Shukriya. '])('does not infer factual requirements or unsafe intent from length: %s', (phrase) => {
    const message = phrase.repeat(60);
    const semantic = { ...unknownSemanticInterpretation(), socialClassification: 'GRATITUDE' as const, informationNeed: 'UNKNOWN' as const, uncertainty: 'NONE' as const, clarificationRequired: false, intents: [{ category: 'GRATITUDE' as const, polarity: 'AFFIRMATIVE' as const }] };
    expect(message.length).toBeGreaterThan(240);
    expect(decideSocialResponse({ classification: 'GRATITUDE', semantic, message }).decision).toBe('SAFE_SOCIAL_RESPONSE');
  });
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

  it.each(['AFFIRMATIVE', 'NEGATED', 'NOT_APPLICABLE'] as const)('accepts a sole nonfactual continuation with %s polarity', (polarity) => {
    const semantic = { ...unknownSemanticInterpretation(), socialClassification: 'ACKNOWLEDGMENT' as const, informationNeed: 'UNKNOWN' as const, uncertainty: 'NONE' as const, clarificationRequired: false, intents: [{ category: 'CONVERSATION_CONTINUATION' as const, polarity }] };
    expect(decideSocialResponse({ classification: 'ACKNOWLEDGMENT', semantic, message: 'contextual fixture' })).toMatchObject({ decision: 'SAFE_SOCIAL_RESPONSE', reason: 'VALIDATED_PURE_SOCIAL_MESSAGE' });
    if (polarity !== 'NEGATED') {
      const invitation = { ...semantic, socialClassification: 'OTHER' as const };
      expect(decideSocialResponse({ classification: 'OTHER', semantic: invitation, message: 'contextual fixture' })).toMatchObject({ decision: 'SAFE_SOCIAL_RESPONSE', reason: 'VALIDATED_PURE_SOCIAL_MESSAGE' });
    }
    expect(decideSocialResponse({ classification: 'ACKNOWLEDGMENT', semantic: { ...semantic, informationNeed: 'PERSONAL_LIVE_RECORD' }, message: 'contextual fixture' }).decision).toBe('CONTINUE_BUSINESS_PIPELINE');
    expect(decideSocialResponse({ classification: 'ACKNOWLEDGMENT', semantic: { ...semantic, intents: [...semantic.intents, { category: 'STATUS_INQUIRY' as const, polarity: 'AFFIRMATIVE' as const }] }, message: 'contextual fixture' }).decision).toBe('CONTINUE_BUSINESS_PIPELINE');
    expect(decideSocialResponse({ classification: 'ACKNOWLEDGMENT', semantic: { ...semantic, uncertainty: 'AMBIGUOUS' }, message: 'contextual fixture' }).decision).toBe('CONTINUE_BUSINESS_PIPELINE');
    expect(decideSocialResponse({ classification: 'ACKNOWLEDGMENT', semantic: { ...semantic, intents: [{ ...semantic.intents[0]!, polarity: 'UNCERTAIN' }] }, message: 'contextual fixture' }).decision).toBe('CONTINUE_BUSINESS_PIPELINE');
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
