import { validateInterpretation } from '../src/modules/workspaces/conversation-intent';
import { buildCapabilityRegistry, decideSource } from '../src/modules/workspaces/intelligence-foundation';
import { validateMultilingualSemanticInterpretation, validateMultilingualSemanticInterpretationDetailed } from '../src/modules/workspaces/multilingual-semantics';
import { semanticInterpretationFixturesV1, semanticPayloadForFixture } from './fixtures/semantic-interpretation.v1';

describe('multilingual semantic interpretation contract', () => {
  it('returns a safe specific rejection code while preserving the nullable validator contract', () => {
    const invalid = { intents: [{ category: 'UNRECOGNIZED', polarity: 'AFFIRMATIVE' }] };
    expect(validateMultilingualSemanticInterpretation(invalid, 'shipping?')).toBeNull();
    expect(validateMultilingualSemanticInterpretationDetailed(invalid, 'shipping?')).toMatchObject({ value: null, reason: 'semantic_language_shape', detail: 'language_object_shape' });
  });

  it.each(semanticInterpretationFixturesV1)('validates fixture $category without treating it as model accuracy evidence', (fixture) => {
    const result = validateMultilingualSemanticInterpretation(semanticPayloadForFixture(fixture), fixture.input);
    expect(result).not.toBeNull();
    expect(result?.language.primary).toBe(fixture.language);
    expect(result?.entities.map(({ type, raw }) => ({ type, raw }))).toEqual(fixture.entities);
    for (const entity of result?.entities ?? []) expect(fixture.input.includes(entity.raw)).toBe(true);
  });

  it('preserves the order identifier exactly and rejects an invented or fuzzy-repaired value', () => {
    const message = 'Order 00-12345 kaha hai?';
    const payload = semanticPayloadForFixture(semanticInterpretationFixturesV1[0]!);
    const exact = { ...payload, entities: [{ type: 'ORDER_ID', raw: '00-12345' }] };
    expect(validateMultilingualSemanticInterpretation(exact, message)?.entities[0]?.raw).toBe('00-12345');
    expect(validateMultilingualSemanticInterpretation({ ...exact, entities: [{ type: 'ORDER_ID', raw: '0012345' }] }, message)).toBeNull();
    expect(validateMultilingualSemanticInterpretation({ ...exact, entities: [{ type: 'ORDER_ID', raw: '00-12346' }] }, message)).toBeNull();
  });

  it('keeps affirmative and negated mixed-language actions distinct', () => {
    const affirmative = { language: { primary: 'Hindi and English', scripts: ['Latin'], mixed: true, certainty: 'CLEAR', signals: [] }, responseLanguagePreference: null, intents: [{ category: 'BOOKING_INQUIRY', polarity: 'AFFIRMATIVE' }], entities: [], uncertainty: 'NONE', clarificationRequired: false };
    const negated = { ...affirmative, intents: [{ category: 'BOOKING_INQUIRY', polarity: 'NEGATED' }] };
    expect(validateMultilingualSemanticInterpretation(affirmative, 'Please meri booking confirm karo')?.intents[0]?.polarity).toBe('AFFIRMATIVE');
    expect(validateMultilingualSemanticInterpretation(negated, 'Booking cancel nahi karna')?.intents[0]?.polarity).toBe('NEGATED');
  });

  it('keeps an explicit requested reply language separate from detected message language', () => {
    const fixture = semanticInterpretationFixturesV1[0]!;
    const payload = { ...semanticPayloadForFixture(fixture), responseLanguagePreference: 'Hindi' };
    const result = validateMultilingualSemanticInterpretation(payload, fixture.input);
    expect(result?.language.primary).toBe('English');
    expect(result?.responseLanguagePreference).toBe('Hindi');
    expect(validateMultilingualSemanticInterpretation({ ...payload, responseLanguagePreference: 7 }, fixture.input)).toBeNull();
  });

  it('accepts assistant identity as an advisory intent without adding authorization', () => {
    const fixture = semanticInterpretationFixturesV1[0]!;
    const payload = { ...semanticPayloadForFixture(fixture), entities: [], intents: [{ category: 'ASSISTANT_IDENTITY_INQUIRY', polarity: 'AFFIRMATIVE' }] };
    expect(validateMultilingualSemanticInterpretation(payload, 'Where are you based?')?.intents[0]?.category).toBe('ASSISTANT_IDENTITY_INQUIRY');
    expect(validateMultilingualSemanticInterpretation({ ...payload, authorized: true }, 'Where are you based?')).toBeNull();
  });

  it('accepts conversational feedback as an intent without treating it as business evidence or authorization', () => {
    const payload = { language: { primary: 'English', scripts: ['Latin'], mixed: false, certainty: 'CLEAR', signals: [] }, responseLanguagePreference: null, socialClassification: 'OTHER', informationNeed: 'UNKNOWN', businessScopeAssessment: 'UNKNOWN', intents: [{ category: 'CONVERSATION_FEEDBACK', polarity: 'AFFIRMATIVE' }], entities: [], uncertainty: 'NONE', clarificationRequired: false };
    const validated = validateMultilingualSemanticInterpretation(payload, 'Why do you keep repeating that?');
    expect(validated?.intents).toEqual([{ category: 'CONVERSATION_FEEDBACK', polarity: 'AFFIRMATIVE' }]);
    expect(validateMultilingualSemanticInterpretation({ ...payload, sourceId: 'untrusted' }, 'Why do you keep repeating that?')).toBeNull();
  });

  it('rejects invalid enums, contradictory uncertainty, source claims and authorization claims', () => {
    const fixture = semanticInterpretationFixturesV1[0]!;
    const base = semanticPayloadForFixture(fixture);
    expect(validateMultilingualSemanticInterpretation({ ...base, intents: [{ category: 'DROP_DATABASE', polarity: 'AFFIRMATIVE' }] }, fixture.input)).toBeNull();
    expect(validateMultilingualSemanticInterpretation({ ...base, uncertainty: 'AMBIGUOUS', clarificationRequired: false }, fixture.input)).toBeNull();
    expect(validateMultilingualSemanticInterpretation({ ...base, authorized: true }, fixture.input)).toBeNull();
    expect(validateMultilingualSemanticInterpretation({ ...base, sourceId: 'tenant-source' }, fixture.input)).toBeNull();
    expect(validateMultilingualSemanticInterpretation({ ...base, socialClassification: 'BYPASS_GROUNDING' }, fixture.input)).toBeNull();
    expect(validateMultilingualSemanticInterpretation({ ...base, informationNeed: 'CALL_USER_URL' }, fixture.input)).toBeNull();
    expect(validateMultilingualSemanticInterpretation({ ...base, businessScopeAssessment: 'ALLOW_ALL_TOPICS' }, fixture.input)).toBeNull();
  });

  it('keeps unknown and ambiguous meanings as first-class outcomes', () => {
    const base = { language: { primary: null, scripts: [], mixed: false, certainty: 'UNKNOWN', signals: [] }, responseLanguagePreference: null, intents: [{ category: 'UNKNOWN', polarity: 'UNCERTAIN' }], entities: [], uncertainty: 'UNKNOWN', clarificationRequired: true };
    expect(validateMultilingualSemanticInterpretation(base, '??')?.intents[0]?.category).toBe('UNKNOWN');
    expect(validateMultilingualSemanticInterpretation({ ...base, intents: [{ category: 'FOLLOW_UP', polarity: 'UNCERTAIN' }], uncertainty: 'AMBIGUOUS' }, 'kal wala?')?.clarificationRequired).toBe(true);
    expect(validateMultilingualSemanticInterpretation({ ...base, intents: [{ category: 'UNKNOWN', polarity: 'UNCERTAIN' }], uncertainty: 'NONE' }, '??')).toBeNull();
  });

  it('preserves legacy retrieval interpretation while exposing validated semantics to later stages', () => {
    const fixture = semanticInterpretationFixturesV1[0]!;
    const parsed = validateInterpretation(JSON.stringify({
      retrievalQueries: ['Where is order 12345?'], language: 'English', script: 'Latin', style: 'plain', intent: 'business',
      semantics: semanticPayloadForFixture(fixture),
    }), fixture.input);
    expect(parsed.value?.retrievalQueries).toEqual(['Where is order 12345?']);
    expect(parsed.value?.semantics?.intents[0]?.category).toBe('STATUS_INQUIRY');
    const legacy = validateInterpretation(JSON.stringify({ retrievalQueries: ['Where is order 12345?'], language: 'English', script: 'Latin', style: 'plain', intent: 'business' }), fixture.input);
    expect(legacy.value?.semantics).toMatchObject({ uncertainty: 'UNKNOWN', clarificationRequired: true, intents: [{ category: 'UNKNOWN' }] });
    const recovered = validateInterpretation(JSON.stringify({ retrievalQueries: ['question'], language: 'English', script: 'Latin', style: 'plain', intent: 'business', semantics: { ...semanticPayloadForFixture(fixture), sourceId: 'untrusted' } }), fixture.input).value;
    expect(recovered?.semantics).toMatchObject({ uncertainty: 'UNKNOWN', clarificationRequired: true, intents: [{ category: 'UNKNOWN' }] });
    expect(recovered?.semantics).not.toHaveProperty('sourceId');
  });

  it('does not turn cross-domain semantic labels into tenant capabilities or source authorization', () => {
    const registry = buildCapabilityRegistry('workspace-a', 'assistant-a', 'Education admissions', 0);
    const semanticStatusIntent = validateMultilingualSemanticInterpretation(semanticPayloadForFixture(semanticInterpretationFixturesV1[12]!), 'When is my appointment?');
    expect(semanticStatusIntent?.intents[0]?.category).toBe('APPOINTMENT_INFORMATION');
    expect(decideSource(registry.capabilities.find((item) => item.category === 'BOOKING_STATUS'), 0)).toMatchObject({ outcome: 'UNSUPPORTED_CAPABILITY' });
    expect(registry.capabilities.every((item) => item.support !== 'AUTHORIZED_CONNECTED_API')).toBe(true);
  });
});
