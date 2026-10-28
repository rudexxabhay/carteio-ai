import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import * as providerConfiguration from '../src/modules/workspaces/conversation-provider.service';
import { ConversationOrchestrator } from '../src/modules/workspaces/conversation-orchestrator.service';
import { recoverValidatedSemanticInterpretation, validateInterpretation } from '../src/modules/workspaces/conversation-intent';
import { validateGroundedResponse } from '../src/modules/workspaces/grounded-response-validation';
import { PlaygroundTraceRecorder, playgroundDevelopmentCaptureEnabled } from '../src/modules/workspaces/playground-diagnostics';

// Offline fixtures only. These tests must not be executed in this continuation.
const semantic = (category = 'KNOWLEDGE_QUESTION', overrides: Record<string, unknown> = {}) => ({
  language: { primary: 'English', scripts: ['Latin'], mixed: false, certainty: 'CLEAR', signals: [] },
  responseLanguagePreference: null, socialClassification: 'OTHER', informationNeed: 'STATIC_BUSINESS_INFORMATION',
  businessScopeAssessment: 'IN_SCOPE', intents: [{ category, polarity: 'AFFIRMATIVE' }],
  entities: [], uncertainty: 'NONE', clarificationRequired: false, ...overrides,
});
const interpretation = (message: string, semantics = semantic(), extra: Record<string, unknown> = {}) => JSON.stringify({
  retrievalQueries: [message], language: 'English', script: 'Latin', style: 'natural', intent: 'business', semantics, ...extra,
});
const row = {
  chunkId: '10000000-0000-4000-8000-000000000001', sourceId: '20000000-0000-4000-8000-000000000002', sourceVersion: 1, generation: 1, pageId: null,
  contentHash: 'a'.repeat(64), content: 'Shipping takes 3 business days.', sourceTitle: 'Shipping', sourceType: 'FAQ', locator: null,
};
const evidence = { reference: 'S1', ...row, title: row.sourceTitle, type: row.sourceType, excerpt: row.content };

describe('Phase 06 independently validated semantics', () => {
  it('retains product semantics after legacy failure without marking the original interpretation valid', () => {
    const message = 'Show your products';
    const raw = interpretation(message, semantic('PRODUCT_INQUIRY'), { intent: 'unsupported-legacy-label' });
    expect(validateInterpretation(raw, message)).toMatchObject({ value: null, reason: 'invalid_intent' });
    expect(recoverValidatedSemanticInterpretation(raw, message)).toMatchObject({ intent: 'business', ticketIntent: { ticketRequest: 'NONE', draftAction: 'NONE' } });
  });

  it('discards invalid aspect spans and preserves negation in independently valid semantics', () => {
    const message = 'Do not recommend products';
    const semantics = semantic('PRODUCT_INQUIRY', { intents: [{ category: 'PRODUCT_INQUIRY', polarity: 'NEGATED' }] });
    const raw = interpretation(message, semantics, { answerAspects: [{ questionSpan: 'invented', retrievalQuery: 'products' }] });
    expect(recoverValidatedSemanticInterpretation(raw, message)?.semantics.intents).toEqual(semantics.intents);
  });

  it.each(['bad-json', '{}', '{"semantics":{"intents":[{"category":"PRODUCT_INQUIRY"}]}}'])('does not recover malformed semantics: %s', (raw) => {
    expect(recoverValidatedSemanticInterpretation(raw, 'Show products')).toBeNull();
  });

  it('accepts empty aspects for a validated unrelated question and a pure language preference, but rejects mixed facts', () => {
    const message = 'Tell me about the weather';
    const scope = semantic('OUT_OF_SCOPE_CANDIDATE', { informationNeed: 'UNKNOWN', businessScopeAssessment: 'OUT_OF_SCOPE' });
    expect(validateInterpretation(interpretation(message, scope, { intent: 'out_of_scope', answerAspects: [] }), message).value).not.toBeNull();
    const language = semantic('CLARIFICATION', { informationNeed: 'UNKNOWN', responseLanguagePreference: 'hi-latn' });
    const preference = interpretation('Use Hinglish', language, { continuityAct: 'LANGUAGE_SWITCH', answerAspects: [] });
    expect(validateInterpretation(preference, 'Use Hinglish').value?.semantics.responseLanguagePreference).toBe('hi-latn');
    expect(validateInterpretation(interpretation('Show products in Hinglish', semantic('PRODUCT_INQUIRY', { responseLanguagePreference: 'hi-latn' }), { continuityAct: 'LANGUAGE_SWITCH', answerAspects: [] }), 'Show products in Hinglish').value).toBeNull();
  });

  it('normalizes an omitted optional preference without discarding the semantic contract', () => {
    const semantics: any = semantic('PRODUCT_INQUIRY');
    delete semantics.responseLanguagePreference;
    expect(validateInterpretation(interpretation('Show products', semantics), 'Show products').value?.semantics).toMatchObject({ responseLanguagePreference: null, intents: semantics.intents });
  });

  it('recovers safe semantics while discarding a malformed ticket action contract', () => {
    const raw = interpretation('Help me', semantic('SUPPORT_REQUEST'), { ticketIntent: { ticketRequest: 'EXPLICIT', draftAction: 'CONFIRM', authorized: true } });
    expect(validateInterpretation(raw, 'Help me').reason).toBe('invalid_ticket_intent');
    expect(recoverValidatedSemanticInterpretation(raw, 'Help me')).toMatchObject({ intent: 'business', ticketIntent: { ticketRequest: 'NONE', draftAction: 'NONE' }, semantics: { intents: [{ category: 'SUPPORT_REQUEST', polarity: 'AFFIRMATIVE' }] } });
  });
});

describe('Phase 06 actual shared provider payloads', () => {
  const provider = 'openrouter';
  const model = 'google/gemini-2.5-flash-lite';
  let engine: ConversationOrchestrator;
  let adapter: any;
  let knowledge: any;
  let commerce: any;
  let db: any;
  let payloads: any[];
  let persistTurn: jest.Mock;
  beforeEach(() => {
    jest.spyOn(providerConfiguration, 'getEffectiveProviderConfiguration').mockReturnValue({ provider, model, configurationValid: true, keyConfigured: true, ready: true } as any);
    payloads = [];
    adapter = { isProviderConfigured: jest.fn(() => true), supportsToolCalling: jest.fn(() => true), supportsJsonObjectMode: jest.fn(() => false), complete: jest.fn() };
    knowledge = {
      publicSourceLanguageHints: jest.fn().mockResolvedValue([]),
      eligiblePublicSourceCount: jest.fn().mockResolvedValue(1),
      searchPreview: jest.fn().mockResolvedValue({ mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 1, results: [] }),
      revalidatePublicEvidence: jest.fn().mockResolvedValue([row]),
    };
    commerce = { productSearchReadiness: jest.fn().mockResolvedValue({ eligible: false, reason: 'SHOPIFY_SCOPE_SNAPSHOT_STALE', recordCount: 0 }), searchCatalog: jest.fn().mockResolvedValue([]), canSearchProducts: jest.fn().mockResolvedValue(false) };
    db = { assistantBusinessRule: { findMany: jest.fn().mockResolvedValue([]) }, $queryRaw: jest.fn().mockResolvedValue([{ requestCount: 1 }]) };
    engine = new ConversationOrchestrator(db, { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'north' }) } as any, knowledge, adapter, undefined, commerce);
    persistTurn = jest.fn().mockResolvedValue({ id: 'saved-answer', createdAt: new Date('2026-10-27T12:00:00Z') });
  });
  afterEach(() => jest.restoreAllMocks());
  const result = (content: string, extra = {}) => ({ provider, model, content, finishReason: 'stop', ...extra });
  const run = function (message: string, turns: any[] = [], workspace = 'North Shop') {
    const tenant = workspace === 'South Shop' ? 'south' : 'north';
    return engine.executeSharedAI({
      context: { requestId: `request-${tenant}`, organizationId: tenant, assistantId: `assistant-${tenant}`, userId: `owner-${tenant}`, channel: 'PLAYGROUND', clientTurnId: `turn-${tenant}`, message, requestDeadline: performance.now() + 52_000 },
      assistant: { id: `assistant-${tenant}`, organizationId: tenant, name: 'Support', organization: { name: workspace }, businessPurpose: 'Retail support', systemInstructions: 'Use a considerate tone.', defaultLanguage: 'auto', responseTone: 'friendly', responseStyle: 'balanced', status: 'ACTIVE', providerMode: 'MANUAL', updatedAt: new Date() } as any,
      session: { id: `session-${tenant}`, lockId: 'lock', organizationId: tenant, assistantId: `assistant-${tenant}`, userId: `owner-${tenant}`, nextSequence: turns.length, turns },
      userId: `owner-${tenant}`, slug: tenant, assistantId: `assistant-${tenant}`, requestId: `request-${tenant}`, persistTurn, releaseSession: jest.fn().mockResolvedValue(undefined),
    });
  };
  const respond = (...responses: any[]) => adapter.complete.mockImplementation(async (request: any) => {
    payloads.push(JSON.parse(JSON.stringify(request)));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error('Unexpected additional provider call');
    return next;
  });

  it('uses one distinct authorized Knowledge recovery and refreshes the same answer-plan slot', async () => {
    const message = 'Shipping time?';
    knowledge.searchPreview.mockResolvedValueOnce({ mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 1, results: [] }).mockResolvedValueOnce({ mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 1, results: [row] });
    respond(result(interpretation(message)), result('', { finishReason: 'tool_calls', toolCalls: [{ id: 'call-1', name: 'search_business_knowledge', arguments: JSON.stringify({ query: 'delivery duration' }) }] }), result('Shipping takes 3 business days. [S1]'));
    const reply = await run(message);
    expect(reply.reply).toContain('3 business days');
    expect(knowledge.searchPreview).toHaveBeenCalledTimes(2);
    expect(knowledge.searchPreview.mock.calls[1].slice(0, 4)).toEqual(['owner-north', 'north', 'assistant-north', 'delivery duration']);
    const plans = payloads.at(-1).messages.filter((item: any) => item.role === 'system' && item.content.startsWith('Server-owned grounded answer plan'));
    expect(plans).toHaveLength(1);
    expect(plans[0].content).toContain('S1');
    expect(payloads.at(-1).messages.some((item: any) => item.role === 'tool' && item.content.includes('Shipping takes 3 business days.'))).toBe(true);
  });

  it('does not repeat the initial query through a native Knowledge tool', async () => {
    const message = 'Shipping time?';
    respond(result(interpretation(message)), result('', { finishReason: 'tool_calls', toolCalls: [{ id: 'call-1', name: 'search_business_knowledge', arguments: JSON.stringify({ query: '  SHIPPING   time? ' }) }] }), result('I cannot confirm that detail.'));
    await run(message);
    expect(knowledge.searchPreview).toHaveBeenCalledTimes(1);
    expect(payloads.at(-1).messages.some((item: any) => item.role === 'tool' && item.content.includes('query_already_searched'))).toBe(true);
  });

  it.each([true, false])('preserves product routing after legacy failure with native tools=%s', async (nativeTools) => {
    const message = 'Show your products';
    adapter.supportsToolCalling.mockReturnValue(nativeTools);
    commerce.productSearchReadiness.mockResolvedValue({ eligible: true, reason: null, recordCount: 2 });
    commerce.canSearchProducts.mockResolvedValue(true);
    knowledge.searchPreview.mockResolvedValue({ mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 0, results: [] });
    const first = result(interpretation(message, semantic('PRODUCT_INQUIRY'), { intent: 'invalid-legacy' }));
    if (nativeTools) respond(first, result('', { finishReason: 'tool_calls', toolCalls: [{ id: 'products-1', name: 'search_store_products', arguments: JSON.stringify({ query: message, browse: true }) }] }), result('I cannot confirm a matching item.'));
    else respond(first, result('I cannot confirm a matching item.'));
    await run(message);
    expect(commerce.searchCatalog).toHaveBeenCalled();
    expect(commerce.searchCatalog.mock.calls[0].slice(0, 2)).toEqual(['north', 'assistant-north']);
    if (nativeTools) expect(knowledge.searchPreview).not.toHaveBeenCalled();
  });

  it('keeps stale Shopify permissions blocked even after product semantics are recovered', async () => {
    const message = 'Show your products';
    knowledge.searchPreview.mockResolvedValue({ mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 0, results: [] });
    respond(result(interpretation(message, semantic('PRODUCT_INQUIRY'), { intent: 'invalid-legacy' })), result('I cannot confirm the catalog here.'));
    await run(message);
    expect(commerce.searchCatalog).not.toHaveBeenCalled();
  });

  it.each([true, false])('delivers authorized, grounded product evidence with native tools=%s', async (nativeTools) => {
    const message = 'Show your products';
    adapter.supportsToolCalling.mockReturnValue(nativeTools);
    commerce.productSearchReadiness.mockResolvedValue({ eligible: true, reason: null, recordCount: 1 });
    const product = { id: '50000000-0000-4000-8000-000000000005', connectionId: '60000000-0000-4000-8000-000000000006', name: 'North Shirt', description: null, collections: [], variants: [], price: '1200.00', currency: 'INR', inventory: null, availabilityStatus: null, productUrl: null, syncedAt: '2026-10-27T00:00:00.000Z', stale: false, contentHash: 'c'.repeat(64), dataCompleteness: 'UNKNOWN' };
    commerce.searchCatalog.mockResolvedValue([product]);
    commerce.revalidateProducts = jest.fn().mockResolvedValue([product]);
    const first = result(interpretation(message, semantic('PRODUCT_INQUIRY'), { intent: 'invalid-legacy' }));
    if (nativeTools) respond(first, result('', { finishReason: 'tool_calls', toolCalls: [{ id: 'products-1', name: 'search_store_products', arguments: JSON.stringify({ query: message, browse: true }) }] }), result('North Shirt costs ₹1,200. [C1]'));
    else respond(first, result('North Shirt costs ₹1,200. [C1]'));
    const reply = await run(message);
    expect(reply.responseType).toBe('grounded_answer');
    expect(reply.sources).toEqual([expect.objectContaining({ reference: 'C1', type: 'COMMERCE_PRODUCT' })]);
    expect(commerce.revalidateProducts.mock.calls[0].slice(0, 2)).toEqual(['north', 'assistant-north']);
    const plans = payloads.at(-1).messages.filter((item: any) => item.role === 'system' && item.content.startsWith('Server-owned grounded answer plan'));
    expect(plans).toHaveLength(1);
    expect(plans[0].content).toContain('C1');
  });

  it('does not search the catalog for a negated product request after invalid legacy metadata', async () => {
    const message = 'Do not recommend products';
    adapter.supportsToolCalling.mockReturnValue(false);
    commerce.productSearchReadiness.mockResolvedValue({ eligible: true, reason: null, recordCount: 2 });
    const semantics = semantic('PRODUCT_INQUIRY', { intents: [{ category: 'PRODUCT_INQUIRY', polarity: 'NEGATED' }] });
    respond(result(interpretation(message, semantics, { intent: 'invalid-legacy' })), result('Understood.'));
    await run(message);
    expect(commerce.searchCatalog).not.toHaveBeenCalled();
  });

  it('retains authorized user context for a recovered catalog follow-up', async () => {
    const message = 'Size 9';
    adapter.supportsToolCalling.mockReturnValue(false);
    commerce.productSearchReadiness.mockResolvedValue({ eligible: true, reason: null, recordCount: 2 });
    const semantics = semantic('PRODUCT_INQUIRY', { intents: [{ category: 'PRODUCT_INQUIRY', polarity: 'AFFIRMATIVE' }, { category: 'FOLLOW_UP', polarity: 'AFFIRMATIVE' }] });
    respond(result(interpretation(message, semantics, { intent: 'invalid-legacy', continuityAct: 'FOLLOW_UP', referenceTurnOffset: 0 })), result('I cannot confirm a matching item.'));
    await run(message, [{ role: 'user', content: 'Show black running shoes' }, { role: 'assistant', content: 'Which size?' }]);
    expect(commerce.searchCatalog.mock.calls[0][2].join(' ')).toContain('Show black running shoes');
  });

  it('does not expose a Knowledge recovery tool when no sources are eligible', async () => {
    const message = 'Shipping time?';
    knowledge.searchPreview.mockResolvedValue({ mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 0, results: [] });
    respond(result(interpretation(message)), result('I cannot confirm that detail.'));
    await run(message);
    expect(adapter.complete).toHaveBeenCalledTimes(2);
    expect(payloads[1].tools).toBeUndefined();
    expect(knowledge.searchPreview).toHaveBeenCalledTimes(1);
  });

  it('bounds zero-match recovery to one distinct additional retrieval', async () => {
    const message = 'Shipping time?';
    respond(result(interpretation(message)), result('', { finishReason: 'tool_calls', toolCalls: [{ id: 'k1', name: 'search_business_knowledge', arguments: JSON.stringify({ query: 'delivery duration' }) }, { id: 'k2', name: 'search_business_knowledge', arguments: JSON.stringify({ query: 'dispatch turnaround' }) }] }), result('I cannot confirm that detail.'));
    await run(message);
    expect(knowledge.searchPreview).toHaveBeenCalledTimes(2);
    expect(payloads.at(-1).messages.some((item: any) => item.role === 'tool' && item.content.includes('knowledge_recovery_budget_exhausted'))).toBe(true);
  });

  it('does not deliver tool evidence after authorization is revoked', async () => {
    const message = 'Shipping time?';
    knowledge.searchPreview.mockResolvedValueOnce({ mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 1, results: [] }).mockResolvedValueOnce({ mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 1, results: [row] });
    knowledge.revalidatePublicEvidence.mockResolvedValue([]);
    respond(result(interpretation(message)), result('', { finishReason: 'tool_calls', toolCalls: [{ id: 'k1', name: 'search_business_knowledge', arguments: JSON.stringify({ query: 'delivery duration' }) }] }), result('Shipping takes 3 business days. [S1]'));
    const reply = await run(message);
    expect(reply.deliveryStatus).toBe('FACTUAL_VERIFICATION_REJECTED');
    expect(persistTurn.mock.calls[0][0].sources).toEqual([]);
  });

  it.each(['Main bhi thik hu', 'Aur batao'])('uses validated conversational semantics after a legacy failure for %s', async (message) => {
    const isContinuation = message === 'Aur batao';
    const semantics = semantic(isContinuation ? 'CONVERSATION_CONTINUATION' : 'WELLBEING_EXCHANGE', { informationNeed: 'UNKNOWN', businessScopeAssessment: 'UNKNOWN', socialClassification: isContinuation ? 'OTHER' : 'WELLBEING_EXCHANGE' });
    respond(result(interpretation(message, semantics, { intent: 'invalid-legacy', answerAspects: [] })), result('A natural contextual reply.'));
    await run(message, [{ role: 'user', content: 'Earlier message' }, { role: 'assistant', content: 'Earlier answer' }]);
    expect(knowledge.searchPreview).not.toHaveBeenCalled();
    expect(adapter.complete).toHaveBeenCalledTimes(2);
  });

  it('redirects validated unrelated meaning without Knowledge retrieval or citation recovery', async () => {
    const message = 'Delhi ka mausam batao';
    const semantics = semantic('OUT_OF_SCOPE_CANDIDATE', { informationNeed: 'UNKNOWN', businessScopeAssessment: 'OUT_OF_SCOPE' });
    respond(result(interpretation(message, semantics, { intent: 'out_of_scope', answerAspects: [] })), result('A natural business-focused redirection.'));
    const reply = await run(message);
    expect(reply.responseType).toBe('business_scope_redirect');
    expect(knowledge.searchPreview).not.toHaveBeenCalled();
    expect(adapter.complete).toHaveBeenCalledTimes(2);
  });

  it('sends the actual rejected draft and reason to one bounded citation recovery', async () => {
    const message = 'Shipping time?';
    knowledge.searchPreview.mockResolvedValue({ mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 1, results: [row] });
    respond(result(interpretation(message)), result('Shipping takes 99 business days. [S1]'), result('Shipping takes 3 business days. [S1]'));
    const reply = await run(message);
    expect(reply.reply).toContain('3 business days');
    expect(payloads).toHaveLength(3);
    expect(payloads[2].messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'assistant', content: 'Shipping takes 99 business days. [S1]' }), expect.objectContaining({ role: 'system', content: expect.stringContaining('unsupported_numeric_claim') })]));
  });

  it('keeps a provider rate limit distinct from citation rejection and does not retry it here', async () => {
    const message = 'Shipping time?';
    knowledge.searchPreview.mockResolvedValue({ mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 1, results: [row] });
    respond(result(interpretation(message)), result('Shipping takes 99 business days. [S1]'), new ServiceUnavailableException({ code: 'PLAYGROUND_PROVIDER_RATE_LIMITED', message: 'Unavailable', retryAfterSeconds: 30 }));
    await expect(run(message)).rejects.toThrow();
    expect(adapter.complete).toHaveBeenCalledTimes(3);
    expect(persistTurn).not.toHaveBeenCalled();
  });

  it.each(['North Shop', 'South Shop'])('routes a validated language-only turn without RAG using %s identity and real history', async (workspace) => {
    const message = 'Use Hinglish';
    const semantics = semantic('CLARIFICATION', { informationNeed: 'UNKNOWN', responseLanguagePreference: 'hi-latn' });
    const turns = [{ role: 'user', content: 'A prior question' }, { role: 'assistant', content: 'A prior answer' }];
    respond(result(interpretation(message, semantics, { answerAspects: [], continuityAct: 'LANGUAGE_SWITCH' })), result('A contextual acknowledgement.'));
    await run(message, turns, workspace);
    expect(knowledge.searchPreview).not.toHaveBeenCalled();
    const messages = payloads[1].messages;
    expect(messages.some((item: any) => item.content.includes('Use a considerate tone.'))).toBe(true);
    expect(messages.some((item: any) => item.content.includes(workspace))).toBe(true);
    expect(messages.some((item: any) => item.content.includes('Hinglish'))).toBe(true);
    expect(messages.some((item: any) => item.content.includes(JSON.stringify(turns)))).toBe(true);
    expect(payloads[1].organizationId).toBe(workspace === 'South Shop' ? 'south' : 'north');
    expect(payloads[0].responseFormat).toBeUndefined();
  });

  it('uses separate visitor buckets and the same atomic workspace quota', async () => {
    await (engine as any).enforcePlaygroundRate('north', createHash('sha256').update('visitor-a').digest('hex'), 'visitor');
    await (engine as any).enforcePlaygroundRate('north', createHash('sha256').update('visitor-b').digest('hex'), 'visitor');
    const keys = db.$queryRaw.mock.calls.map((call: any[]) => call[1]);
    expect(keys[0]).not.toBe(keys[2]);
    expect(keys[0]).toMatch(/^visitor:north:[a-f0-9]{64}$/);
    expect(keys[1]).toBe('workspace:north');
    expect(keys[3]).toBe('workspace:north');
  });

  it('preserves the authenticated user bucket and denies an exhausted workspace quota', async () => {
    db.$queryRaw.mockResolvedValueOnce([{ requestCount: 1 }]).mockResolvedValueOnce([{ requestCount: 1001 }]);
    await expect((engine as any).enforcePlaygroundRate('north', 'owner-north')).rejects.toThrow();
    expect(db.$queryRaw.mock.calls[0][1]).toBe('user:north:owner-north');
    expect(db.$queryRaw.mock.calls[1][1]).toBe('workspace:north');
  });

  it('denies detailed capture before inference when the caller is not a workspace manager', async () => {
    const access = { requireAccess: jest.fn().mockRejectedValue(new ForbiddenException()) };
    const guarded = new ConversationOrchestrator(db, access as any, knowledge, adapter);
    await expect(guarded.playgroundChat('member', 'north', 'assistant-north', { message: 'Hi', diagnosticCapture: true })).rejects.toThrow();
    expect(access.requireAccess).toHaveBeenCalledWith('member', 'north', ['OWNER', 'ADMIN']);
    expect(adapter.complete).not.toHaveBeenCalled();
  });

  it('ignores changed uncited candidates while still suppressing a revoked cited source', async () => {
    const revalidate = jest.spyOn(engine as any, 'revalidateConversationEvidence').mockResolvedValue([row]);
    const sources = [{ reference: 'S1', chunkId: row.chunkId, sourceId: row.sourceId, contentHash: row.contentHash, sourceVersion: 1, cited: 'true' }, { reference: 'S2', chunkId: '30000000-0000-4000-8000-000000000003', sourceId: '40000000-0000-4000-8000-000000000004', contentHash: 'b'.repeat(64), sourceVersion: 1, cited: 'false' }];
    const message = { id: 'historical', role: 'assistant', content: 'A previously grounded answer.', responseCategory: 'grounded_answer', sourceReferences: sources };
    const retained = await (engine as any).revalidateStoredConversationMessages('owner-north', 'north', 'assistant-north', 'north', [message]);
    expect(retained).toHaveLength(1);
    expect(revalidate.mock.calls[0][4]).toHaveLength(1);
    revalidate.mockResolvedValue([]);
    expect(await (engine as any).revalidateStoredConversationMessages('owner-north', 'north', 'assistant-north', 'north', [message])).toEqual([]);
  });
});

describe('Phase 06 metadata diagnostics and strict grounding', () => {
  it.each([
    ['Shipping takes 3 business days. [S1]', true],
    ['Shipping takes 99 business days. [S1]', false],
    ['Shipping takes approximately 99 business days. [S1]', false],
    ['Shipping takes 3 business days. [S2]', false],
  ])('keeps numeric/citation rules for %s', (reply, accepted) => {
    expect(validateGroundedResponse(reply, [evidence]).accepted).toBe(accepted);
  });

  it('reports numeric mismatch metadata without retaining the numerical value or customer text', () => {
    const checks: unknown[] = [];
    expect(validateGroundedResponse('Shipping takes 99 business days. [S1]', [evidence], (check) => checks.push(check)).accepted).toBe(false);
    expect(checks).toContainEqual({ claimKind: 'number', matched: false, sourceCandidateCount: 1, citedReferenceCount: 1 });
    expect(JSON.stringify(checks)).not.toContain('99');
  });

  it('retains distinctions between business days and calendar days, exact ranges, currencies and dates', () => {
    expect(validateGroundedResponse('Shipping takes 3 days. [S1]', [evidence]).accepted).toBe(false);
    const range = { ...evidence, excerpt: 'Shipping takes 3–5 business days.' };
    expect(validateGroundedResponse('Shipping takes 3–5 business days. [S1]', [range]).accepted).toBe(true);
    expect(validateGroundedResponse('Shipping takes 3–9 business days. [S1]', [range]).accepted).toBe(false);
    const amount = { ...evidence, excerpt: 'The fee is ₹1,200.' };
    expect(validateGroundedResponse('The fee is INR 1200. [S1]', [amount]).accepted).toBe(true);
    expect(validateGroundedResponse('The fee is USD 1200. [S1]', [amount]).accepted).toBe(false);
    const dated = { ...evidence, excerpt: 'The snapshot was saved at 2026-10-27T00:00:00.000Z.' };
    expect(validateGroundedResponse('The snapshot date is 2026-10-27. [S1]', [dated]).accepted).toBe(true);
    expect(validateGroundedResponse('The snapshot date is 2026-10-28. [S1]', [dated]).accepted).toBe(false);
  });

  it('requires explicit opt-in in development and rejects text fields in metadata capture', () => {
    const env = { NODE_ENV: 'development', PLAYGROUND_DIAGNOSTICS_ENABLED: 'true' };
    expect(playgroundDevelopmentCaptureEnabled(true, env)).toBe(true);
    expect(playgroundDevelopmentCaptureEnabled(false, env)).toBe(false);
    expect(playgroundDevelopmentCaptureEnabled(true, { ...env, NODE_ENV: 'production', APP_ENV: 'uat' })).toBe(false);
    const recorder = new PlaygroundTraceRecorder('trace', undefined, true);
    recorder.captureDevelopmentMetadata('INTERPRETATION', { reason: 'invalid_intent', accepted: false, raw: 'private text', token: 'private-token', customerId: 'private-customer', characterCount: 20 });
    const snapshot = recorder.snapshot({ answerOrigin: 'FAILED' });
    expect(snapshot.developmentCapture?.checks).toEqual([{ stage: 'INTERPRETATION', metadata: { reason: 'invalid_intent', accepted: false, characterCount: 20 } }]);
    expect(JSON.stringify(snapshot)).not.toContain('private');
    expect(new PlaygroundTraceRecorder('trace').snapshot({ answerOrigin: 'FAILED' }).developmentCapture).toBeUndefined();
  });

  it('omits expired capture and bounds the number of retained checks', () => {
    const now = Date.now();
    const recorder = new PlaygroundTraceRecorder('trace', undefined, true);
    for (let index = 0; index < 100; index++) recorder.captureDevelopmentMetadata('NUMERIC_CHECK', { matched: false, claimKind: 'number' });
    expect(recorder.snapshot({ answerOrigin: 'FAILED' }).developmentCapture?.checks).toHaveLength(12);
    for (let index = 0; index < 100; index++) recorder.captureDevelopmentMetadata('RECOVERY_DRAFT', { characterCount: 10 });
    expect(recorder.snapshot({ answerOrigin: 'FAILED' }).developmentCapture?.checks).toHaveLength(16);
    const time = jest.spyOn(Date, 'now').mockReturnValue(now + 6 * 60_000);
    expect(recorder.snapshot({ answerOrigin: 'FAILED' }).developmentCapture).toBeUndefined();
    time.mockRestore();
  });
});
