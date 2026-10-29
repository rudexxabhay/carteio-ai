import { isRepeatedUserRequest, resolveConversationReference } from '../src/modules/workspaces/conversation-context';
import { unknownSemanticInterpretation } from '../src/modules/workspaces/multilingual-semantics';
import type { MultilingualSemanticInterpretation } from '../src/modules/workspaces/multilingual-semantics';
import type { PlaygroundTurn } from '../src/modules/workspaces/conversation-intent';
import { describeInterpretationShape, describeInterpretationSocialGuard, recoverRetrievalQueriesAfterSemanticFailure, recoverValidatedSemanticInterpretation, validateInterpretation } from '../src/modules/workspaces/conversation-intent';

const semantic = (category: 'FOLLOW_UP' | 'CORRECTION' = 'FOLLOW_UP', entities: Array<{ type: 'ORDER_ID' | 'DATE_REFERENCE'; raw: string }> = []): MultilingualSemanticInterpretation => ({
  ...unknownSemanticInterpretation(),
  uncertainty: 'NONE', clarificationRequired: false,
  intents: [{ category, polarity: 'AFFIRMATIVE' }], entities,
});

describe('bounded conversation context resolution', () => {
  it('reports the exact social guard and final empty-query validator predicate without message text', () => {
    const semantics = { ...unknownSemanticInterpretation(), socialClassification: 'ACKNOWLEDGMENT' as const, informationNeed: 'UNKNOWN' as const, uncertainty: 'NONE' as const, clarificationRequired: false, intents: [{ category: 'ACKNOWLEDGMENT' as const, polarity: 'NEGATED' as const }] };
    const raw = JSON.stringify({ retrievalQueries: [], answerAspects: [], language: 'English', intent: 'unknown', semantics });
    const metadata = describeInterpretationSocialGuard(raw, 'contextual refusal fixture');
    expect(metadata).toMatchObject({ socialGuardStatus: 'EVALUATED', socialDecision: 'SAFE_SOCIAL_RESPONSE', standaloneConversationalAct: true, actualRetrievalRejected: false, finalValidatorRule: 'none', semanticIntents: 'ACKNOWLEDGMENT:NEGATED' });
    expect(JSON.stringify(metadata)).not.toContain('contextual refusal fixture');
  });
  it('accepts the confirmed acknowledgment plus continuation semantic contract but rejects ticket-pending and factual conflicts', () => {
    const semantics = { ...unknownSemanticInterpretation(), socialClassification: 'ACKNOWLEDGMENT' as const, informationNeed: 'UNKNOWN' as const, uncertainty: 'NONE' as const, clarificationRequired: false, intents: [{ category: 'CONVERSATION_CONTINUATION' as const, polarity: 'AFFIRMATIVE' as const }] };
    const base = { retrievalQueries: ['contextual query'], answerAspects: [], language: 'English', intent: 'conversation_continuation', semantics };
    expect(validateInterpretation(JSON.stringify(base), 'contextual fixture').value?.answerAspects).toEqual([]);
    expect(validateInterpretation(JSON.stringify({ ...base, retrievalQueries: [] }), 'contextual fixture').value?.answerAspects).toEqual([]);
    expect(validateInterpretation(JSON.stringify({ ...base, ticketIntent: { ticketRequest: 'EXPLICIT', draftAction: 'CONFIRM' } }), 'contextual fixture').value?.answerAspects).not.toEqual([]);
    expect(validateInterpretation(JSON.stringify({ ...base, semantics: { ...semantics, informationNeed: 'MIXED_STATIC_AND_PERSONAL' } }), 'contextual fixture').value?.answerAspects).not.toEqual([]);
  });
  it('distinguishes present unusable query fields from missing fields without exposing text', () => {
    const raw = JSON.stringify({ retrievalQueries: ['', 42, 'private '.repeat(50)], answerAspects: [], semantics: null });
    const shape = describeInterpretationShape(raw, '', true);
    expect(shape).toMatchObject({ retrievalQueriesPresent: true, retrievalQueriesCount: 3, usableRetrievalQueriesCount: 0, answerAspectsPresent: true, answerAspectsCount: 0, semanticValid: false, validatorFunction: 'validateInterpretation' });
    expect(JSON.stringify(shape)).not.toContain('private');
  });
  it('preserves validated factual aspects during recovery and strips action authorization', () => {
    const message = 'Shipping policy and return policy?';
    const answerAspects = [
      { questionSpan: 'Shipping policy', retrievalQuery: 'shipping policy' },
      { questionSpan: 'return policy', retrievalQuery: 'return policy' },
    ];
    const raw = JSON.stringify({ language: 'English', intent: 'business', retrievalQueries: ['shipping policy', 'return policy'], answerAspects,
      semantics: { ...unknownSemanticInterpretation(), informationNeed: 'STATIC_BUSINESS_INFORMATION', uncertainty: 'NONE', clarificationRequired: false, intents: [{ category: 'KNOWLEDGE_QUESTION', polarity: 'AFFIRMATIVE' }] },
      ticketIntent: { ticketRequest: 'EXPLICIT', draftAction: 'CONFIRM' },
    });
    expect(recoverValidatedSemanticInterpretation(raw, message)).toMatchObject({ answerAspects, retrievalQueries: ['shipping policy', 'return policy'], ticketIntent: { ticketRequest: 'NONE', draftAction: 'NONE' } });
  });
  it.each([
    ['What is the shipping policy?', 'KNOWLEDGE_QUESTION'],
    ['Is this product available?', 'AVAILABILITY_INQUIRY'],
    ['Thanks, how long does shipping take?', 'KNOWLEDGE_QUESTION'],
    ['How long does that take?', 'FOLLOW_UP'],
  ])('retains factual retrieval requirements for %s', (message, category) => {
    const interpretation = { language: 'English', intent: 'business', semantics: {
      ...unknownSemanticInterpretation(), informationNeed: 'STATIC_BUSINESS_INFORMATION', uncertainty: 'NONE', clarificationRequired: false,
      intents: [{ category, polarity: 'AFFIRMATIVE' }],
    }, retrievalQueries: [message], answerAspects: [{ questionSpan: message, retrievalQuery: message }] };
    expect(validateInterpretation(JSON.stringify(interpretation), message).value?.answerAspects).toHaveLength(1);
    expect(validateInterpretation(JSON.stringify({ ...interpretation, retrievalQueries: [] }), message).value).toBeNull();
    expect(validateInterpretation(JSON.stringify({ ...interpretation, answerAspects: [] }), message).value).toBeNull();
  });
  it('treats a quoted reference word as literal text without requiring prior history', () => {
    expect(resolveConversationReference({ message: 'What does "previous instructions" mean?', turns: [], semantic: unknownSemanticInterpretation(), legacyIntent: 'business' })).toMatchObject({ status: 'NOT_APPLICABLE', contextualQuery: null });
  });
  it('retains a bounded search rewrite when only semantic metadata fails validation', () => {
    const raw = JSON.stringify({ intent: 'business', language: 'Hinglish', retrievalQueries: ['carteio ki shipping policy kya h', 'Carteio shipping and delivery policy'], semantics: { intents: [{ category: 'UNRECOGNIZED', polarity: 'AFFIRMATIVE' }] } });
    expect(validateInterpretation(raw, 'carteio ki shipping policy kya h')).toMatchObject({ value: { retrievalQueries: ['carteio ki shipping policy kya h', 'Carteio shipping and delivery policy'], semantics: { uncertainty: 'UNKNOWN', clarificationRequired: true } }, reason: 'valid' });
    expect(recoverRetrievalQueriesAfterSemanticFailure(raw, 'carteio ki shipping policy kya h')).toEqual(['Carteio shipping and delivery policy']);
  });

  it('rejects partial rewrites with mismatched originals, malformed variants, or unsafe bounds', () => {
    expect(recoverRetrievalQueriesAfterSemanticFailure(JSON.stringify({ language: 'Hindi', retrievalQueries: ['different question', 'Shipping policy'] }), 'Shipping?')).toEqual([]);
    expect(recoverRetrievalQueriesAfterSemanticFailure(JSON.stringify({ language: 'Hindi', retrievalQueries: ['Shipping?', 'x'.repeat(301)] }), 'Shipping?')).toEqual([]);
    expect(recoverRetrievalQueriesAfterSemanticFailure('{bad', 'Shipping?')).toEqual([]);
  });

  it('classifies malformed, truncated, and incomplete interpretation output with specific safe reasons', () => {
    expect(validateInterpretation('{"retrievalQueries":[', 'Show me products.')).toMatchObject({ value: null, reason: 'json_object_missing' });
    expect(validateInterpretation('{ broken }', 'Show me products.')).toMatchObject({ value: null, reason: 'malformed_json' });
    expect(validateInterpretation(JSON.stringify({ language: 'Hindi', intent: 'business' }), 'Tumhare paas kaunse products available hain?')).toMatchObject({ value: null, reason: 'invalid_retrieval_queries' });
    expect(validateInterpretation('', 'Hi')).toMatchObject({ value: null, reason: 'json_object_missing' });
  });

  it('resolves a multilingual follow-up to the latest authorized user topic and exact identifier', () => {
    const turns: PlaygroundTurn[] = [
      { role: 'user', content: 'Order 00-12345 ka status?' },
      { role: 'assistant', content: 'I cannot access a live order status.', responseCategory: 'capability_unavailable' },
    ];
    const result = resolveConversationReference({ message: 'Uska refund?', turns, semantic: semantic() });
    expect(result).toMatchObject({ status: 'RESOLVED', sourceTurnOffset: 0, entity: { type: 'ORDER_ID', raw: '00-12345' } });
    expect(result.contextualQuery).toContain('Order 00-12345 ka status?');
    expect(result.entity?.raw).toBe('00-12345');
  });

  it('keeps multiple identifiers ambiguous instead of choosing one', () => {
    const turns: PlaygroundTurn[] = [
      { role: 'user', content: 'Order 12345 and order 67890' },
      { role: 'assistant', content: 'Which one?', responseCategory: 'source_clarification' },
    ];
    expect(resolveConversationReference({ message: 'Uska status?', turns, semantic: semantic() }).status).toBe('AMBIGUOUS');
  });

  it('does not resolve without authorized session history', () => {
    expect(resolveConversationReference({ message: 'Uska status?', turns: [], semantic: semantic() })).toMatchObject({ status: 'MISSING_CONTEXT' });
  });

  it('distinguishes bounded history expiry from absent history', () => {
    expect(resolveConversationReference({ message: 'Uska status?', turns: [], semantic: semantic(), historyWasTruncated: true })).toMatchObject({ status: 'EXPIRED_CONTEXT', reason: 'BOUNDED_HISTORY_EXPIRED' });
  });

  it('never resolves an identifier mentioned only by a previous assistant message', () => {
    expect(resolveConversationReference({ message: 'Uska status?', turns: [{ role: 'assistant', content: 'Order 12345 is processing.' }], semantic: semantic() })).toMatchObject({ status: 'UNSAFE_REFERENCE', reason: 'ASSISTANT_ONLY_IDENTIFIER' });
  });

  it('uses the corrected current exact entity and does not carry the old identifier forward', () => {
    const result = resolveConversationReference({
      message: 'Sorry, order 12346',
      turns: [{ role: 'user', content: 'Order 12345 status?' }],
      semantic: semantic('CORRECTION', [{ type: 'ORDER_ID', raw: '12346' }]),
    });
    expect(result).toMatchObject({ status: 'RESOLVED', reason: 'EXPLICIT_CURRENT_CORRECTION', entity: { raw: '12346' }, contextualQuery: null });
  });

  it('uses an authorized prior question to continue a pending clarification without treating the answer as proof', () => {
    const pending: PlaygroundTurn[] = [
      { role: 'user', content: 'Payment ka kya hua?' },
      { role: 'assistant', content: 'Are you asking about refund or invoice payment?', responseCategory: 'source_clarification' },
    ];
    const replySemantic: MultilingualSemanticInterpretation = {
      ...unknownSemanticInterpretation(), uncertainty: 'NONE', clarificationRequired: false, informationNeed: 'PERSONAL_LIVE_RECORD',
      intents: [{ category: 'REFUND_INQUIRY', polarity: 'AFFIRMATIVE' }],
    };
    const result = resolveConversationReference({ message: 'Refund wala.', turns: pending, semantic: replySemantic });
    expect(result).toMatchObject({ status: 'RESOLVED', sourceTurnOffset: 0 });
    expect(result.contextualQuery).toContain('Payment ka kya hua? Refund wala.');
  });

  it('keeps a clarification pending after a standalone acknowledgment', () => {
    const afterAcknowledgment: PlaygroundTurn[] = [
      { role: 'user', content: 'Payment ka kya hua?' },
      { role: 'assistant', content: 'Are you asking about refund or invoice payment?', responseCategory: 'source_clarification' },
      { role: 'user', content: 'Okey' },
      { role: 'assistant', content: 'Understood. Let me know if you need anything else.', responseCategory: 'acknowledgment_pending_clarification' },
    ];
    const replySemantic: MultilingualSemanticInterpretation = {
      ...unknownSemanticInterpretation(), uncertainty: 'NONE', clarificationRequired: false, informationNeed: 'PERSONAL_LIVE_RECORD',
      intents: [{ category: 'REFUND_INQUIRY', polarity: 'AFFIRMATIVE' }],
    };
    expect(resolveConversationReference({ message: 'Refund wala.', turns: afterAcknowledgment, semantic: replySemantic })).toMatchObject({ status: 'RESOLVED', sourceTurnOffset: 0 });
  });

  it('marks exact repeated requests as advisory and leaves different requests untouched', () => {
    const turns: PlaygroundTurn[] = [{ role: 'user', content: 'What is your refund policy?' }];
    expect(isRepeatedUserRequest('what is your refund policy?', turns)).toBe(true);
    expect(isRepeatedUserRequest('Can you explain it more simply?', turns)).toBe(false);
  });

  it('accepts only a reference offset into a supplied user turn, never an assistant or invented turn', () => {
    const turns: PlaygroundTurn[] = [{ role: 'user', content: 'refund policy' }, { role: 'assistant', content: 'I can help.' }];
    const base = { retrievalQueries: ['refund duration'], language: 'English', intent: 'follow_up', referenceTurnOffset: 0 };
    expect(validateInterpretation(JSON.stringify(base), 'How long?', turns).value?.referenceTurnOffset).toBe(0);
    expect(validateInterpretation(JSON.stringify({ ...base, referenceTurnOffset: 1 }), 'How long?', turns).value).toBeNull();
    expect(validateInterpretation(JSON.stringify({ ...base, referenceTurnOffset: 2 }), 'How long?', turns).value).toBeNull();
    expect(validateInterpretation(JSON.stringify({ ...base, authorizationGranted: true }), 'How long?', turns).value).toBeNull();
  });

  it('validates bounded answer aspects as exact current-message spans', () => {
    const base = { retrievalQueries: ['return policy', 'refund processing time'], language: 'English', intent: 'business' };
    const valid = validateInterpretation(JSON.stringify({ ...base, answerAspects: [
      { questionSpan: 'What is the return policy', retrievalQuery: 'return policy' },
      { questionSpan: 'how long does a refund take', retrievalQuery: 'refund processing time' },
    ] }), 'What is the return policy and how long does a refund take?');
    expect(valid.value?.answerAspects).toHaveLength(2);
    expect(validateInterpretation(JSON.stringify({ ...base, answerAspects: [{ questionSpan: 'refunds?', retrievalQuery: 'refund policy' }] }), 'How long does a refund take?').value).toBeNull();
    expect(validateInterpretation(JSON.stringify({ ...base, answerAspects: Array.from({ length: 5 }, () => ({ questionSpan: 'refund', retrievalQuery: 'refund' })) }), 'refund').value).toBeNull();
  });

  it('accepts an explicitly empty aspect list only for validated standalone social or feedback turns', () => {
    const socialSemantics = {
      ...unknownSemanticInterpretation(),
      socialClassification: 'WELLBEING_EXCHANGE' as const,
      uncertainty: 'NONE' as const,
      clarificationRequired: false,
      intents: [{ category: 'WELLBEING_EXCHANGE' as const, polarity: 'AFFIRMATIVE' as const }],
    };
    const base = { retrievalQueries: ['Kaise ho bhai?'], language: 'Hindi', intent: 'wellbeing', semantics: socialSemantics };
    for (const retrievalQueries of [[], undefined]) {
      expect(validateInterpretation(JSON.stringify({ ...base, retrievalQueries, answerAspects: [] }), 'Kaise ho bhai?')).toMatchObject({ reason: 'valid', value: { retrievalQueries: [], answerAspects: [] } });
      expect(validateInterpretation(JSON.stringify({ ...base, retrievalQueries, semantics: undefined, answerAspects: [] }), 'Kaise ho bhai?').value).toBeNull();
      expect(validateInterpretation(JSON.stringify({ ...base, retrievalQueries, semantics: { ...socialSemantics, informationNeed: 'STATIC_BUSINESS_INFORMATION' } }), 'Kaise ho bhai?').value).toBeNull();
    }
    expect(validateInterpretation(JSON.stringify({ ...base, answerAspects: [] }), 'Kaise ho bhai?').value?.answerAspects).toEqual([]);
    expect(validateInterpretation(JSON.stringify(base), 'Kaise ho bhai?').value?.answerAspects).toEqual([]);
    const negatedAck = { ...base, retrievalQueries: ['Nhi'], intent: 'unknown', semantics: { ...socialSemantics, socialClassification: 'ACKNOWLEDGMENT', intents: [{ category: 'ACKNOWLEDGMENT', polarity: 'NEGATED' }] } };
    expect(validateInterpretation(JSON.stringify({ ...negatedAck, answerAspects: [] }), 'Nhi').value?.answerAspects).toEqual([]);
    expect(validateInterpretation(JSON.stringify({ ...base, answerAspects: null }), 'Kaise ho bhai?')).toMatchObject({ value: null, reason: 'invalid_answer_aspects' });
    expect(validateInterpretation(JSON.stringify({ ...base, semantics: { ...socialSemantics, informationNeed: 'STATIC_BUSINESS_INFORMATION' }, answerAspects: [] }), 'Kaise ho bhai?')).toMatchObject({ value: null, reason: 'invalid_answer_aspects' });
  });

  it('reports bounded schema shape without returning prompt or model content', () => {
    const raw = JSON.stringify({ answerAspects: [], intent: 'unrecognized-sensitive-value', privateText: 'do not expose this customer text' });
    const diagnostic = describeInterpretationShape(raw);
    expect(diagnostic).toMatchObject({ answerAspectsType: 'array', answerAspectsCount: 0, legacyIntentAccepted: false });
    expect(JSON.stringify(diagnostic)).not.toContain('unrecognized-sensitive-value');
    expect(JSON.stringify(diagnostic)).not.toContain('customer text');
  });

  it('accepts semantic conversation feedback with its distinct legacy label and keeps legacy intent validation bounded', () => {
    const semantics = {
      ...unknownSemanticInterpretation(),
      socialClassification: 'OTHER' as const,
      uncertainty: 'NONE' as const,
      clarificationRequired: false,
      intents: [{ category: 'CONVERSATION_FEEDBACK' as const, polarity: 'AFFIRMATIVE' as const }],
    };
    const base = { retrievalQueries: ['That answer repeated itself'], language: 'English', semantics, answerAspects: [] };
    expect(validateInterpretation(JSON.stringify({ ...base, intent: 'conversation_feedback' }), 'That answer repeated itself').value?.intent).toBe('conversation_feedback');
    expect(validateInterpretation(JSON.stringify({ ...base, intent: 'refund_everything' }), 'That answer repeated itself')).toMatchObject({ value: null, reason: 'invalid_intent' });
  });

  it('validates ticket intent as advisory typed semantics and never accepts model authorization fields', () => {
    const base = { retrievalQueries: ['create support ticket'], language: 'English', intent: 'business' };
    const valid = validateInterpretation(JSON.stringify({ ...base, ticketIntent: { ticketRequest: 'EXPLICIT', draftAction: 'COLLECT', title: 'Refund delay' } }), 'Please create a support ticket about my refund delay.');
    expect(valid.value?.ticketIntent).toMatchObject({ ticketRequest: 'EXPLICIT', draftAction: 'COLLECT', title: 'Refund delay' });
    expect(validateInterpretation(JSON.stringify({ ...base, ticketIntent: { ticketRequest: 'EXPLICIT', draftAction: 'CONFIRM', authorized: true } }), 'Yes')).toMatchObject({ value: null });
  });
});
