import { PlaygroundTraceRecorder, playgroundDiagnosticsEnabled } from './playground-diagnostics';

describe('Playground diagnostics', () => {
  it('captures only allowlisted recovery metadata in opted-in development traces', () => {
    const trace = new PlaygroundTraceRecorder('trace-repair', undefined, true);
    trace.captureDevelopmentMetadata('INTERPRETATION', { interpretationVersion: 'semantic-recovery-v2', historyMessageCount: 4, repairAttempted: true, repairDecision: 'EXHAUSTED', informationNeed: 'UNKNOWN', reason: 'invalid_retrieval_queries', rawOutput: 'customer private text', prompt: 'protected instructions' });
    const result = trace.snapshot({});
    expect(result.developmentCapture?.checks[0]?.metadata).toMatchObject({ repairAttempted: true, repairDecision: 'EXHAUSTED', informationNeed: 'UNKNOWN', historyMessageCount: 4 });
    expect(JSON.stringify(result)).not.toContain('customer private text');
    expect(JSON.stringify(result)).not.toContain('protected instructions');
    const disabled = new PlaygroundTraceRecorder('trace-disabled');
    disabled.captureDevelopmentMetadata('INTERPRETATION', { repairAttempted: true });
    expect(disabled.snapshot({}).developmentCapture).toBeUndefined();
  });
  it('reports loaded behavior metadata and whether the behavior layer reached an outbound request without exposing content', () => {
    const trace = new PlaygroundTraceRecorder('trace-behavior');
    trace.setAssistantConfiguration({ id: 'assistant-123', version: '2026-10-23T00:00:00.000Z', sections: { systemInstructions: 'private text', responseTone: 'warm' } });
    trace.setPromptAssembly({ completed: true, platformInstructionsIncluded: true, assistantBehaviorIncluded: true, assistantBehaviorSectionCount: 2, agentBuilderNodeInstructionsIncluded: false });
    trace.markPromptDispatched(true, 2);
    trace.setConfiguredFactEvidence({ configured: true, selected: true, revalidated: true, supplied: true, sourceId: 'assistant-123' });
    const result = trace.snapshot({});
    expect(result).toMatchObject({ assistantConfiguration: { loaded: true, sectionLengths: { systemInstructions: 12, responseTone: 4 } }, promptAssembly: { completed: true, assistantBehaviorIncluded: true, outboundProviderRequestDispatched: true, assistantBehaviorSentToProvider: true, providerCallIndexes: [2], assistantBehaviorCallIndexes: [2] }, configuredFacts: { kind: 'support_contacts', supplied: true } });
    expect(JSON.stringify(result)).not.toContain('private text');
  });

  it('records bounded provider calls with purpose, timing, usage and retry reason', () => {
    const trace = new PlaygroundTraceRecorder('trace-provider-calls');
    trace.recordProviderCall({ callIndex: 1, purpose: 'answer_generation', provider: 'openrouter', model: 'google/gemini-2.5-flash-lite', outcome: 'COMPLETED', requestDispatched: true, durationMs: 842.4, usage: { inputTokens: 321, outputTokens: 45, totalTokens: 366 } });
    trace.recordProviderCall({ callIndex: 2, purpose: 'citation_recovery', provider: 'openrouter', model: 'google/gemini-2.5-flash-lite', outcome: 'FAILED', requestDispatched: true, durationMs: 1001, retryReason: 'citation_validation_rejected', errorCategory: 'PROVIDER_RATE_LIMIT' });

    const snapshot = trace.snapshot({});
    expect(snapshot).toMatchObject({ providerCallCount: 2, providerRequestCount: 2, providerCalls: [
      { callIndex: 1, purpose: 'answer_generation', outcome: 'COMPLETED', requestDispatched: true, durationMs: 842, usage: { inputTokens: 321, outputTokens: 45, totalTokens: 366 } },
      { callIndex: 2, purpose: 'citation_recovery', outcome: 'FAILED', retryReason: 'citation_validation_rejected', errorCategory: 'PROVIDER_RATE_LIMIT' },
    ] });
    expect(snapshot.events.filter((event) => event.stage === 'PROVIDER_RESPONSE_RECEIVED')).toHaveLength(2);
  });

  it('requires an explicit flag and permits only development or UAT', () => {
    expect(playgroundDiagnosticsEnabled({ PLAYGROUND_DIAGNOSTICS_ENABLED: 'true', NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true);
    expect(playgroundDiagnosticsEnabled({ PLAYGROUND_DIAGNOSTICS_ENABLED: 'true', NODE_ENV: 'production', APP_ENV: 'uat' } as NodeJS.ProcessEnv)).toBe(true);
    expect(playgroundDiagnosticsEnabled({ PLAYGROUND_DIAGNOSTICS_ENABLED: 'true', NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
    expect(playgroundDiagnosticsEnabled({ PLAYGROUND_DIAGNOSTICS_ENABLED: 'false', NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(false);
  });

  it('tracks the retrieved → selected → revalidated → supplied → cited evidence chain without retaining the query', () => {
    const trace = new PlaygroundTraceRecorder('trace-1');
    trace.setRetrieval({ query: 'delivery policy', mode: 'hybrid', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 1, resultCount: 1 });
    trace.addEvidence({ reference: 'S1', sourceId: 'source-1', pageId: 'page-1', chunkId: 'chunk-1', contentHash: 'a'.repeat(64), indexGeneration: 4, rankingPosition: 1, sourceType: 'WEBSITE', title: 'Shipping', locator: 'https://shop.example/shipping', excerpt: 'x'.repeat(800), retrieved: true });
    trace.markSelected(['S1']);
    trace.markRevalidated(['S1']);
    trace.markSupplied(['S1']);
    const result = trace.snapshot({ answerOrigin: 'MODEL_GENERATED', sources: [{ reference: 'S1', type: 'WEBSITE' }], retrievalMode: 'hybrid' });
    expect(result.retrieval).toMatchObject({ audience: 'PUBLIC_VISITOR', attempted: true, resultCount: 1 });
    expect(JSON.stringify(result)).not.toContain('delivery policy');
    expect(result.evidence[0]).toMatchObject({ pageId: 'page-1', indexGeneration: 4, rankingPosition: 1, retrieved: true, selectedForContext: true, revalidated: true, suppliedToProvider: true, cited: true });
    expect(result.evidence[0]?.excerpt).toHaveLength(320);
    expect(result.finalSource).toBe('KNOWLEDGE_BASE');
  });

  it('shows executed query origin and language target while redacting customer identifiers', () => {
    const trace = new PlaygroundTraceRecorder('trace-query-plan');
    trace.setRetrieval({ query: 'delivery kitne din 1234567890', queryVariants: ['delivery kitne din 1234567890', 'delivery timeframe'], executedQueries: [
      { query: 'delivery kitne din 1234567890', origin: 'CUSTOMER_MESSAGE', languageTarget: 'Hinglish' },
      { query: 'delivery timeframe', origin: 'LLM_INTERPRETATION', languageTarget: 'English' },
    ], mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 1, resultCount: 0, queryPlanningMode: 'MODEL_INTERPRETED', customerLanguage: 'Hinglish' });
    trace.setExecutedQueries([{ query: 'shipping duration', origin: 'LLM_TOOL_RETRY', languageTarget: 'English' }]);
    const result = trace.snapshot({});
    expect(result.retrieval.executedQueries).toEqual([
      { query: 'delivery kitne din [number]', origin: 'CUSTOMER_MESSAGE', languageTarget: 'Hinglish' },
      { query: 'delivery timeframe', origin: 'LLM_INTERPRETATION', languageTarget: 'English' },
      { query: 'shipping duration', origin: 'LLM_TOOL_RETRY', languageTarget: 'English' },
    ]);
    expect(JSON.stringify(result.retrieval)).not.toContain('1234567890');
  });

  it('does not claim retrieved but uncited evidence supported the answer', () => {
    const trace = new PlaygroundTraceRecorder('trace-2');
    trace.addEvidence({ reference: 'S1', sourceId: 'source-1', chunkId: 'chunk-1', sourceType: 'WEBSITE', title: 'Shipping', locator: null, excerpt: 'A bounded excerpt.', retrieved: true });
    const result = trace.snapshot({ answerOrigin: 'MODEL_GENERATED', sources: [], retrievalMode: 'lexical_only' });
    expect(result.evidence[0]).toMatchObject({ retrieved: true, selectedForContext: false, cited: false });
    expect(result.finalSource).toBe('AI_GENERATED');
  });

  it('records safe citation rejection separately from missing retrieval evidence', () => {
    const trace = new PlaygroundTraceRecorder('trace-citation-rejected');
    trace.setRetrieval({ query: 'shipping policy', mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 1, resultCount: 2 });
    trace.addEvidence({ reference: 'S1', sourceId: 'source-1', pageId: 'page-1', chunkId: 'chunk-1', indexGeneration: 3, sourceType: 'WEBSITE', title: 'Shipping', locator: null, excerpt: 'Policy excerpt.', retrieved: true });
    trace.markSelected(['S1']); trace.markRevalidated(['S1']); trace.markSupplied(['S1']);
    trace.setCitationValidation({ accepted: false, reason: 'unknown_reference', evidenceCount: 1, citedReferences: ['S1'], unknownReferences: ['S99'], attempts: 2, recognizedReferenceCount: 2, suppliedReferences: ['S1'], initialDraftNonempty: true, recoveryUsedVerifiedEvidence: true });
    const result = trace.snapshot({ answerOrigin: 'KNOWLEDGE_FALLBACK', provenance: 'SYSTEM_RESPONSE', deliveryStatus: 'FACTUAL_VERIFICATION_REJECTED', sources: [] });
    expect(result.finalAnswer).toMatchObject({ answerOrigin: 'KNOWLEDGE_FALLBACK', deliveryStatus: 'FACTUAL_VERIFICATION_REJECTED', groundingStatus: 'CITATIONS_REJECTED', suppliedEvidenceCount: 1 });
    expect(result.citationValidation).toMatchObject({ accepted: false, reason: 'unknown_reference', expectedFormat: '[S<number>] or [C<number>]', recognizedReferenceCount: 2, suppliedReferences: ['S1'], initialDraftNonempty: true, recoveryUsedVerifiedEvidence: true, citedReferences: ['S1'], unknownReferences: ['S99'], attempts: 2 });
    expect(result.retrieval).toMatchObject({ resultCount: 2 });
    expect(result.evidence[0]).toMatchObject({ suppliedToProvider: true, cited: false });
  });

  it('distinguishes provider unavailability and internal execution failure from verification rejection', () => {
    const trace = new PlaygroundTraceRecorder('trace-provider-unavailable');
    const providerFailure = trace.snapshot({ answerOrigin: 'FAILED' }, { outcome: 'FAILED', errorCategory: 'PROVIDER_RATE_LIMIT' });
    expect(providerFailure.finalAnswer.deliveryStatus).toBe('PROVIDER_UNAVAILABLE');
    const internalFailure = trace.snapshot({ answerOrigin: 'FAILED' }, { outcome: 'FAILED', errorCategory: 'INTERNAL_ERROR' });
    expect(internalFailure.finalAnswer.deliveryStatus).toBe('INTERNAL_EXECUTION_FAILURE');
  });

  it('records no eligible sources and an empty retrieval separately from search not attempted', () => {
    const trace = new PlaygroundTraceRecorder('trace-empty');
    trace.setRetrieval({ query: 'no matches', mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 0, resultCount: 0, semanticUnavailableCode: 'NO_AUTHORIZED_SOURCES' });
    expect(trace.snapshot({ answerOrigin: 'KNOWLEDGE_FALLBACK' }).retrieval).toMatchObject({ attempted: true, audience: 'PUBLIC_VISITOR', eligibilityStatus: 'NO_ELIGIBLE_SOURCES', eligibleSourceCount: 0, resultCount: 0 });
    expect(new PlaygroundTraceRecorder('trace-not-attempted').snapshot({}).retrieval).toMatchObject({ attempted: false, audience: null });
  });

  it('preserves safe semantic retrieval failure reasons on the per-message trace', () => {
    const trace = new PlaygroundTraceRecorder('trace-semantic-failure');
    trace.setRetrieval({ query: 'private query', mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 2, resultCount: 0, semanticUnavailableCode: 'SEMANTIC_QUERY_FAILED', retrievalReason: 'SEMANTIC_RETRIEVAL_UNAVAILABLE', methodsAttempted: ['lexical', 'semantic'] });
    trace.milestone('SEMANTIC_RETRIEVAL', { organizationId: 'org-a', assistantId: 'assistant-a', outcome: 'FAILED', reason: 'SEMANTIC_QUERY_FAILED' });
    const result = trace.snapshot({});
    expect(result.retrieval).toMatchObject({ semanticUnavailableCode: 'SEMANTIC_QUERY_FAILED', retrievalReason: 'SEMANTIC_RETRIEVAL_UNAVAILABLE' });
    expect(result.events).toContainEqual(expect.objectContaining({ stage: 'SEMANTIC_RETRIEVAL', outcome: 'FAILED', reason: 'SEMANTIC_QUERY_FAILED' }));
    expect(JSON.stringify(result)).not.toContain('private query');
  });

  it('keeps public-widget and internal-preview audience labels explicit', () => {
    const trace = new PlaygroundTraceRecorder('trace-audience');
    trace.setRetrieval({ query: 'faq', mode: 'lexical_only', audience: 'INTERNAL_MANAGER_PREVIEW', eligibleSourceCount: 1, resultCount: 0 });
    expect(trace.snapshot({}).retrieval.audience).toBe('INTERNAL_MANAGER_PREVIEW');
  });

  it('exposes bounded server retrieval counts and safe rejection reasons without retaining query text', () => {
    const trace = new PlaygroundTraceRecorder('trace-rag-detail');
    trace.setRetrieval({ query: 'private shipping question', mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 2, resultCount: 0, assignedSourceCount: 3, rejectedSourceCount: 1, rejectionReasons: [{ reason: 'PUBLIC_WEBSITE_NOT_ELIGIBLE', count: 1 }, { reason: 'secret@example.com', count: 9 }], indexReadySourceCount: 2, activeIndexChunkCount: 42, queryVariantCount: 2, lexicalCandidateCount: 0, semanticCandidateCount: 0, rankedCandidateCount: 0, filteredCandidateCount: 0, selectedEvidenceCount: 0, retrievalReason: 'NO_LEXICAL_MATCH', methodsAttempted: ['lexical', 'unknown'] });
    const result = trace.snapshot({});
    expect(result.retrieval).toMatchObject({ assignedSourceCount: 3, rejectedSourceCount: 1, rejectionReasons: [{ reason: 'PUBLIC_WEBSITE_NOT_ELIGIBLE', count: 1 }], activeIndexChunkCount: 42, queryVariantCount: 2, retrievalReason: 'NO_LEXICAL_MATCH', methodsAttempted: ['lexical'] });
    expect(JSON.stringify(result)).not.toContain('private shipping question');
    expect(JSON.stringify(result)).not.toContain('secret@example.com');
  });

  it('records language handling labels without storing message or query text', () => {
    const trace = new PlaygroundTraceRecorder('trace-language');
    trace.setLanguageHandling({ customerLanguage: 'Hindi', responseLanguage: 'Hindi', script: 'LATIN' });
    const result = trace.snapshot({});
    expect(result.languageHandling).toEqual({ customerLanguage: 'Hindi', responseLanguage: 'Hindi', script: 'LATIN' });
    expect(JSON.stringify(result)).not.toContain('query text');
  });

  it('shows rejected revalidation, provider failure and citation rejection without claiming evidence was supplied or cited', () => {
    const trace = new PlaygroundTraceRecorder('trace-rejected');
    trace.addEvidence({ reference: 'S1', sourceId: 'source-1', chunkId: 'chunk-1', sourceType: 'FAQ', title: 'Returns', locator: null, excerpt: 'Return policy.', retrieved: true });
    trace.markSelected(['S1']);
    trace.markRevalidated([]);
    trace.record({ requestId: 'trace-rejected', organizationId: 'workspace-1', assistantId: 'assistant-1', channel: 'PLAYGROUND', stage: 'EVIDENCE_REVALIDATED', outcome: 'FAILED', durationMs: 1, reason: 'evidence_revalidation_rejected' });
    trace.record({ requestId: 'trace-rejected', organizationId: 'workspace-1', assistantId: 'assistant-1', channel: 'PLAYGROUND', stage: 'PROVIDER_RESPONSE_RECEIVED', outcome: 'FAILED', durationMs: 1, errorCategory: 'PROVIDER_UNAVAILABLE' });
    trace.record({ requestId: 'trace-rejected', organizationId: 'workspace-1', assistantId: 'assistant-1', channel: 'PLAYGROUND', stage: 'GROUNDING_VALIDATED', outcome: 'FAILED', durationMs: 1, reason: 'citation_validation_rejected' });
    const result = trace.snapshot({ answerOrigin: 'FAILED' });
    expect(result.evidence[0]).toMatchObject({ retrieved: true, selectedForContext: true, revalidated: false, suppliedToProvider: false, cited: false });
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'EVIDENCE_REVALIDATED', status: 'failed' }),
      expect.objectContaining({ operation: 'PROVIDER_RESPONSE_RECEIVED', status: 'failed', errorCategory: 'PROVIDER_UNAVAILABLE' }),
      expect.objectContaining({ operation: 'GROUNDING_VALIDATED', status: 'failed' }),
    ]));
  });

  it('keeps concurrent authorized traces isolated by correlation ID', () => {
    const first = new PlaygroundTraceRecorder('trace-one');
    const second = new PlaygroundTraceRecorder('trace-two');
    first.addEvidence({ reference: 'S1', sourceId: 'source-one', chunkId: 'chunk-one', sourceType: 'FAQ', title: 'One', locator: null, excerpt: 'one', retrieved: true });
    expect(first.snapshot({}).traceId).toBe('trace-one');
    expect(first.snapshot({}).evidence.map((item) => item.chunkId)).toEqual(['chunk-one']);
    expect(second.snapshot({}).traceId).toBe('trace-two');
    expect(second.snapshot({}).evidence).toEqual([]);
  });

  it('does not expose query text or locator credentials and bounds excerpts', () => {
    const trace = new PlaygroundTraceRecorder('trace-redaction');
    trace.setRetrieval({ query: 'customer email secret@example.com', mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibleSourceCount: 1, resultCount: 1, semanticUnavailableCode: 'provider error key-secret' });
    trace.addEvidence({ reference: 'S1', sourceId: 's', chunkId: 'c', sourceType: 'FAQ', title: 'Title', locator: 'https://user:pass@example.com/a', excerpt: 'x'.repeat(800), retrieved: true });
    const snapshot = trace.snapshot({});
    const rendered = JSON.stringify(snapshot);
    expect(rendered).not.toContain('secret@example.com');
    expect(rendered).not.toContain('key-secret');
    expect(rendered).not.toContain('user:pass');
    expect(snapshot.evidence[0]?.excerpt).toHaveLength(320);
  });

  it('reports deterministic answers as system responses even when a retrieval occurred', () => {
    const trace = new PlaygroundTraceRecorder('trace-3');
    const result = trace.snapshot({ answerOrigin: 'DETERMINISTIC_POLICY', sources: [] });
    expect(result.finalSource).toBe('SYSTEM_RESPONSE');
  });

  it('keeps failed turns unknown and records an actual failed terminal event', () => {
    const trace = new PlaygroundTraceRecorder('trace-failed');
    trace.record({ requestId: 'trace-failed', organizationId: 'workspace-1', assistantId: 'assistant-1', channel: 'PLAYGROUND', stage: 'ANSWER_GENERATION', outcome: 'FAILED', durationMs: 42, errorCategory: 'PROVIDER_UNAVAILABLE' });
    const result = trace.snapshot({ answerOrigin: 'FAILED' }, { outcome: 'FAILED', errorCategory: 'PROVIDER_UNAVAILABLE' });
    expect(result.finalSource).toBe('UNKNOWN');
    expect(result.events.at(-1)).toMatchObject({ operation: 'FINAL_RESPONSE', status: 'failed', errorCategory: 'PROVIDER_UNAVAILABLE' });
  });

  it('emits bounded correlated tool execution events in sequence order', () => {
    const streamed: Array<{ sequence: number; operation: string; status: string; tool?: string }> = [];
    const trace = new PlaygroundTraceRecorder('trace-tools', event => streamed.push(event));
    trace.recordTool('search_business_knowledge', 'requested');
    trace.recordTool('search_business_knowledge', 'completed', 2);
    const result = trace.snapshot({});
    expect(streamed.map(event => [event.sequence, event.operation, event.status, event.tool])).toEqual([
      [1, 'TOOL_EXECUTION', 'started', 'search_business_knowledge'],
      [2, 'TOOL_EXECUTION', 'completed', 'search_business_knowledge'],
      [3, 'FINAL_RESPONSE', 'completed', undefined],
    ]);
    expect(result.events.map(event => event.sequence)).toEqual([1, 2, 3]);
    expect(result.tools).toEqual([
      { tool: 'search_business_knowledge', outcome: 'requested' },
      { tool: 'search_business_knowledge', outcome: 'completed', resultCount: 2 },
    ]);
  });

  it('records safely redacted tool inputs, normalized data source, elapsed time, and tool evidence delivery', () => {
    const trace = new PlaygroundTraceRecorder('trace-product-tool');
    trace.recordTool('search_store_products', 'completed', 1, undefined, {
      input: JSON.stringify({ query: 'Ocean Bracelet caller@example.com +1 555 123 4567', browse: false }),
      dataSource: 'NORMALIZED_SNAPSHOT', durationMs: 127,
    });
    trace.addEvidence({ reference: 'C1', sourceId: 'connection-1', chunkId: 'product-1', sourceType: 'COMMERCE_PRODUCT', title: 'Ocean Bracelet', locator: null, excerpt: 'Price: 600 INR', retrieved: true });
    trace.markSelected(['C1']);
    trace.markRevalidated(['C1']);
    trace.markSupplied(['C1']);
    trace.setCommerceReadiness({ connectionStatus: 'CONNECTED', scopeSnapshotStatus: 'FRESH', relevantGrantedScopes: ['read_products', 'read_inventory'], assistantEnabledOperations: ['PRODUCTS', 'INVENTORY'], eligible: true, reason: null, recordCount: 12, dataSource: 'NORMALIZED_SNAPSHOT' });

    const result = trace.snapshot({});
    expect(result.tools[0]).toMatchObject({ tool: 'search_store_products', outcome: 'completed', resultCount: 1, dataSource: 'NORMALIZED_SNAPSHOT', durationMs: 127 });
    expect(result.tools[0]?.input).toContain('[email]');
    expect(result.tools[0]?.input).not.toContain('caller@example.com');
    expect(result.tools[0]?.input).not.toContain('+1 555 123 4567');
    expect(result.evidence[0]).toMatchObject({ reference: 'C1', selectedForContext: true, revalidated: true, suppliedToProvider: true });
    expect(result.commerceReadiness).toMatchObject({ connectionStatus: 'CONNECTED', scopeSnapshotStatus: 'FRESH', relevantGrantedScopes: ['read_products', 'read_inventory'], assistantEnabledOperations: ['PRODUCTS', 'INVENTORY'], eligible: true, dataSource: 'NORMALIZED_SNAPSHOT' });
  });

  it('keeps a failed interpretation visible when original-query recovery succeeds and records product routing safely', () => {
    const trace = new PlaygroundTraceRecorder('trace-recovery');
    trace.record({ requestId: 'trace-recovery', organizationId: 'workspace-1', assistantId: 'assistant-1', channel: 'PLAYGROUND', stage: 'PROVIDER_REQUEST_STARTED', outcome: 'STARTED', durationMs: 0, provider: 'openrouter', model: 'google/gemini-2.5-flash-lite' });
    trace.record({ requestId: 'trace-recovery', organizationId: 'workspace-1', assistantId: 'assistant-1', channel: 'PLAYGROUND', stage: 'INTENT_INTERPRETATION', outcome: 'FAILED', durationMs: 5000, errorCategory: 'PROVIDER_INVALID_RESPONSE', reason: 'malformed_json', provider: 'openrouter', model: 'google/gemini-2.5-flash-lite' });
    trace.record({ requestId: 'trace-recovery', organizationId: 'workspace-1', assistantId: 'assistant-1', channel: 'PLAYGROUND', stage: 'INTERPRETATION_RECOVERY', outcome: 'COMPLETED', durationMs: 0, reason: 'original_query_fallback' });
    trace.record({ requestId: 'trace-recovery', organizationId: 'workspace-1', assistantId: 'assistant-1', channel: 'PLAYGROUND', stage: 'PRODUCT_ROUTING_DECISION', outcome: 'COMPLETED', durationMs: 0, reason: 'product_intent_recovered' });
    const result = trace.snapshot({ answerOrigin: 'KNOWLEDGE_FALLBACK' });
    expect(result.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'INTENT_INTERPRETATION', status: 'failed', errorCategory: 'PROVIDER_INVALID_RESPONSE', reason: 'malformed_json' }),
      expect.objectContaining({ operation: 'INTERPRETATION_RECOVERY', status: 'completed', reason: 'original_query_fallback' }),
      expect.objectContaining({ operation: 'PRODUCT_ROUTING_DECISION', status: 'completed', reason: 'product_intent_recovered' }),
    ]));
    expect(JSON.stringify(result)).not.toContain('customer message');
  });

  it('preserves truncation and empty-response categories separately from schema-invalid output', () => {
    const trace = new PlaygroundTraceRecorder('trace-provider-shapes');
    trace.record({ requestId: 'trace-provider-shapes', organizationId: 'workspace-1', assistantId: 'assistant-1', channel: 'PLAYGROUND', stage: 'INTENT_INTERPRETATION', outcome: 'FAILED', durationMs: 20, errorCategory: 'PROVIDER_OUTPUT_TRUNCATED' });
    trace.record({ requestId: 'trace-provider-shapes', organizationId: 'workspace-1', assistantId: 'assistant-1', channel: 'PLAYGROUND', stage: 'PROVIDER_RESPONSE_RECEIVED', outcome: 'FAILED', durationMs: 20, errorCategory: 'PROVIDER_EMPTY_RESPONSE' });
    expect(trace.snapshot({}).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ errorCategory: 'PROVIDER_OUTPUT_TRUNCATED' }),
      expect.objectContaining({ errorCategory: 'PROVIDER_EMPTY_RESPONSE' }),
    ]));
  });
});


describe('Phase 05 instruction and memory diagnostics', () => {
  it('exposes only safe memory metadata and distinguishes assembly from actual dispatch', () => {
    const trace = new PlaygroundTraceRecorder('memory-trace');
    trace.setConversationMemory({ loadedMessageCount: 8, includedMessageCount: 6, contextBytes: 640, droppedMessageCount: 2, contentTruncationCount: 0, truncationReasons: ['MESSAGE_LIMIT'], order: 'chronological', windowAtCapacity: true });
    trace.setAssistantConfiguration({ id: 'assistant-1', version: '2026-10-26T00:00:00.000Z', sections: { instructions: 'Private behavior text' } });
    trace.setPromptAssembly({ completed: true, platformInstructionsIncluded: true, assistantBehaviorIncluded: true, assistantBehaviorSectionCount: 1, agentBuilderNodeInstructionsIncluded: false, historyMessageCount: 2, historyRoles: ['user', 'assistant'] });
    expect(trace.snapshot({}).promptAssembly).toMatchObject({ assistantBehaviorSentToProvider: false, historySentToProvider: false });
    trace.markPromptDispatched(true, 2);
    const diagnostic = trace.snapshot({});
    expect(diagnostic.memory).toMatchObject({ includedMessageCount: 6, order: 'chronological', truncationReasons: ['MESSAGE_LIMIT'] });
    expect(diagnostic.promptAssembly).toMatchObject({ historyMessageCount: 2, historyRoles: ['user', 'assistant'], historySentToProvider: true, assistantBehaviorSentToProvider: true, agentBuilderNodeInstructionsIncluded: false });
    expect(JSON.stringify(diagnostic)).not.toContain('Private behavior text');
  });
});
