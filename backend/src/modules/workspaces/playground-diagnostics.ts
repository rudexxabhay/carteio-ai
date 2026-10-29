import type { ConversationStageEvent } from './conversation.contracts';
import { createHash } from 'node:crypto';
import type { ConversationMemoryDiagnostic } from './conversation-diagnostics';

const MAX_EVENTS = 100;
const MAX_EVIDENCE = 12;
const MAX_EXCERPT = 320;
type RetrievalQueryDiagnostic = Readonly<{ query: string; origin: 'CUSTOMER_MESSAGE' | 'CONTEXT_RESOLUTION' | 'LLM_INTERPRETATION' | 'LLM_ANSWER_ASPECT' | 'LLM_RECOVERY' | 'LLM_TOOL_RETRY' | 'BACKEND_FALLBACK'; languageTarget: string | null }>;
const SAFE_RETRIEVAL_CODES = new Set(['EMPTY_QUERY', 'NO_AUTHORIZED_SOURCES', 'NO_ELIGIBLE_SOURCES', 'INDEX_NOT_READY', 'EMPTY_INDEX', 'NO_LEXICAL_MATCH', 'NO_SEMANTIC_MATCH', 'SEMANTIC_RETRIEVAL_UNAVAILABLE', 'SEMANTIC_NOT_CONFIGURED', 'SEMANTIC_QUERY_FAILED', 'SEMANTIC_INDEX_STATUS_UNAVAILABLE', 'SEMANTIC_INDEX_NOT_READY', 'EMBEDDING_INDEX_PROFILE_MISMATCH', 'EMBEDDING_INDEX_DIMENSION_MISMATCH', 'ALL_CANDIDATES_FILTERED', 'NO_SELECTED_EVIDENCE', 'REVALIDATION_FAILED', 'EMBEDDING_PROFILE_UNSUPPORTED', 'EMBEDDING_PROVIDER_NOT_CONFIGURED', 'EMBEDDING_PROVIDER_UNAVAILABLE', 'EMBEDDING_PROVIDER_RETRYABLE', 'EMBEDDING_PROVIDER_AUTH_FAILED', 'EMBEDDING_DIMENSION_MISMATCH', 'NO_COMPATIBLE_SEMANTIC_INDEX', 'NO_AUTHORIZED_EVIDENCE_SELECTED']);
const SAFE_REASONS = new Set(['committed_turn_replay', 'deterministic_social_intent', 'invalid_interpretation_output', 'json_object_missing', 'malformed_json', 'invalid_root_shape', 'unsupported_interpretation_field', 'invalid_language_descriptor', 'invalid_retrieval_queries', 'invalid_answer_aspects', 'invalid_answer_aspect', 'duplicate_answer_aspect', 'invalid_language_style', 'invalid_intent', 'invalid_clarification_flag', 'invalid_semantic_interpretation', 'semantic_root_shape', 'semantic_unsupported_field', 'semantic_language_shape', 'language_object_shape', 'language_fields_shape', 'language_primary_shape', 'language_scripts_shape', 'language_mixed_shape', 'language_certainty_shape', 'language_signals_shape', 'semantic_response_language_shape', 'semantic_social_classification', 'semantic_information_need', 'semantic_scope_assessment', 'semantic_intents_shape', 'semantic_intent_shape', 'semantic_duplicate_intent', 'semantic_entities_shape', 'semantic_entity_shape', 'semantic_entity_not_exact_message_span', 'semantic_uncertainty_shape', 'semantic_uncertainty_conflict', 'invalid_scope_split', 'invalid_continuity_act', 'invalid_ticket_intent', 'invalid_reference_turn_offset', 'stage_output_rejected', 'original_query_fallback', 'recovered_retrieval_queries', 'recovery_completed', 'recovery_failed', 'product_intent_detected', 'product_intent_not_detected', 'product_intent_recovered', 'product_tool_not_supported', 'no_product_evidence_returned', 'no_public_evidence', 'no_generated_answer', 'eligible_sources_found', 'no_eligible_sources', 'knowledge_service_unavailable', 'no_selected_evidence', 'evidence_revalidation_rejected', 'provider_call_failed', 'citation_validation_rejected', 'session_release_failed', 'citation_valid_references', 'citation_missing_reference', 'citation_unknown_reference', 'citation_missing_conflict_sources', 'citation_unsupported_numeric_claim', 'citation_unsupported_url', 'citation_unsupported_merchant_fact', 'citation_unsupported_structured_product_fact', 'citation_evidence_authorization_changed', 'citation_retry_generation_failed', 'citation_validated', 'json_mode_unverified_or_unsupported', 'provider_rejected_json_mode', 'json_mode_provider_rejection_prompt_only_retry', 'validated_deterministic_social_recovery', 'standalone_social_recovery', 'INDEX_NOT_READY', 'EMPTY_INDEX', 'NO_LEXICAL_MATCH', 'NO_SEMANTIC_MATCH', 'SEMANTIC_RETRIEVAL_UNAVAILABLE', 'SEMANTIC_NOT_CONFIGURED', 'SEMANTIC_QUERY_FAILED', 'SEMANTIC_INDEX_STATUS_UNAVAILABLE', 'SEMANTIC_INDEX_NOT_READY', 'EMBEDDING_INDEX_PROFILE_MISMATCH', 'EMBEDDING_INDEX_DIMENSION_MISMATCH', 'ALL_CANDIDATES_FILTERED', 'NO_SELECTED_EVIDENCE', 'REVALIDATION_FAILED', 'NO_ELIGIBLE_SOURCES', 'EMPTY_QUERY', 'ai_planned_search', 'invalid_arguments', 'query_results_reused', 'tool_budget_exhausted', 'tool_not_authorized', 'tool_timeout', 'KNOWLEDGE_DATABASE_MISSING_COLUMN', 'KNOWLEDGE_DATABASE_MISSING_TABLE', 'KNOWLEDGE_SEARCH_FAILED', 'SHOPIFY_PRODUCT_SEARCH_FAILED', 'empty_limitation_response', 'limitation_response_too_long', 'citation_marker_in_limitation_response', 'url_in_limitation_response', 'unsupported_personal_status_claim', 'PERSONAL_RECORD_REQUIRES_LIVE_CONNECTOR']);
type StoredEvent = Omit<ConversationStageEvent, 'stage'> & { stage: ConversationStageEvent['stage'] | 'FINAL_RESPONSE' | 'TOOL_EXECUTION'; sequence: number; at: string; tool?: string };
export type PlaygroundTraceEvent = StoredEvent & { traceId: string; operation: string; status: string };
type CitationDiagnostic = Readonly<{ accepted: boolean; reason: string; evidenceCount: number; citedReferences: readonly string[]; unknownReferences: readonly string[]; attempts: number; expectedFormat: string; recognizedReferenceCount: number; suppliedReferences: readonly string[]; initialDraftNonempty: boolean; recoveryUsedVerifiedEvidence: boolean }>;
type ProviderCallDiagnostic = Readonly<{ callIndex: number; purpose: NonNullable<ConversationStageEvent['purpose']>; provider: string; model: string; outcome: 'COMPLETED' | 'FAILED'; requestDispatched: boolean; durationMs: number; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; retryReason?: NonNullable<ConversationStageEvent['retryReason']>; errorCategory?: ConversationStageEvent['errorCategory'] }>;

export type PlaygroundDiagnosticEvidence = {
  reference: string;
  sourceId: string;
  chunkId: string;
  pageId?: string | null;
  contentHash?: string;
  indexGeneration?: number;
  rankingPosition?: number;
  sourceType: string;
  title: string;
  locator: string | null;
  excerpt: string;
  score?: number;
  scoreMethod?: string;
  sourceVersion?: number;
  fetchedAt?: string | null;
  retrieved: boolean;
  selectedForContext: boolean;
  revalidated: boolean;
  suppliedToProvider: boolean;
  cited: boolean;
};

export class PlaygroundTraceRecorder {
  readonly traceId: string;
  readonly startedAt = new Date().toISOString();
  private readonly events: StoredEvent[] = [];
  private readonly evidence = new Map<string, PlaygroundDiagnosticEvidence>();
  private readonly captureExpiresAt = Date.now() + 5 * 60_000;
  private readonly developmentChecks: Array<{ stage: 'INTERPRETATION' | 'INITIAL_DRAFT' | 'RECOVERY_DRAFT' | 'NUMERIC_CHECK'; metadata: Record<string, string | number | boolean> }> = [];
  private sequence = 0;
  private organizationId: string | null = null;
  private assistantId = '';
  private retrieval: { attempted: boolean; queryHash: string | null; queryVariantHashes?: string[]; executedQueries?: RetrievalQueryDiagnostic[]; mode: string; audience: 'PUBLIC_VISITOR' | 'INTERNAL_MANAGER_PREVIEW' | null; eligibilityStatus: string; eligibleSourceCount: number; resultCount: number; semanticUnavailableCode?: string; queryPlanningMode?: string; customerLanguage?: string | null; sourceLanguageHintCount?: number; queryVariantCount?: number; assignedSourceCount?: number; rejectedSourceCount?: number; rejectionReasons?: Array<{ reason: string; count: number }>; indexReadySourceCount?: number; activeIndexChunkCount?: number; sourceIndexStates?: Array<{ sourceId: string; sourceVersion: number; activeGeneration: number | null; processingStatus: string; ready: boolean }>; lexicalCandidateCount?: number; semanticCandidateCount?: number; rankedCandidateCount?: number; filteredCandidateCount?: number; selectedEvidenceCount?: number; retrievalReason?: string; methodsAttempted?: string[] } = {
    attempted: false, queryHash: null, mode: 'not_attempted', audience: null, eligibilityStatus: 'NOT_EVALUATED', eligibleSourceCount: 0, resultCount: 0,
  };
  private languageHandling: { customerLanguage: string | null; responseLanguage: string | null; script: string | null } | null = null;
  private citationValidation: CitationDiagnostic | null = null;
  private toolEvents: Array<{ tool: string; outcome: string; resultCount?: number; reason?: string; input?: string; dataSource?: 'NORMALIZED_SNAPSHOT' | 'AUTHORIZED_KNOWLEDGE_INDEX'; durationMs?: number; queryOrigin?: RetrievalQueryDiagnostic['origin']; queryLanguageTarget?: string }> = [];
  private providerCalls: ProviderCallDiagnostic[] = [];
  private providerCallTotal = 0;
  private providerRequestTotal = 0;
  private memory: ConversationMemoryDiagnostic | null = null;
  private assistantConfiguration: { id: string; version: string | null; loaded: boolean; sectionLengths: Record<string, number> } | null = null;
  private promptAssembly: { completed: boolean; platformInstructionsIncluded: boolean; assistantBehaviorIncluded: boolean; assistantBehaviorSectionCount: number; agentBuilderNodeInstructionsIncluded: boolean; outboundProviderRequestDispatched: boolean; assistantBehaviorSentToProvider: boolean; providerCallIndexes: number[]; assistantBehaviorCallIndexes: number[]; historyMessageCount: number; historyRoles: Array<'user' | 'assistant'>; historySentToProvider: boolean } | null = null;
  private configuredFacts: { kind: 'support_contacts'; configured: boolean; selected: boolean; revalidated: boolean; supplied: boolean; excludedReason?: string; sourceId?: string } | null = null;
  private commerceReadiness: { connectionStatus: string; scopeSnapshotStatus: string; relevantGrantedScopes: string[]; assistantEnabledOperations: string[]; eligible: boolean; reason: string | null; recordCount: number; dataSource: 'NORMALIZED_SNAPSHOT' } | null = null;

  constructor(traceId: string, private readonly onEvent?: (event: PlaygroundTraceEvent) => void, private readonly developmentCapture = false) { this.traceId = traceId; }

  /** Metadata only: arbitrary model/customer text cannot be safely redacted. */
  captureDevelopmentMetadata(stage: 'INTERPRETATION' | 'INITIAL_DRAFT' | 'RECOVERY_DRAFT' | 'NUMERIC_CHECK', input: Readonly<Record<string, unknown>>): void {
    if (!this.developmentCapture || Date.now() >= this.captureExpiresAt || this.developmentChecks.length >= 16) return;
    if (stage === 'NUMERIC_CHECK' && this.developmentChecks.filter((check) => check.stage === stage).length >= 12) return;
    const counts = ['answerAspectsCount', 'semanticIntentCount', 'characterCount', 'citedReferenceCount', 'sourceCandidateCount', 'unsupportedClaimCount', 'verifiedFactCount', 'retrievalQueriesCount', 'historyMessageCount', 'usableRetrievalQueriesCount'];
    const flags = ['jsonObjectPresent', 'rootObject', 'jsonParsed', 'legacyIntentAccepted', 'accepted', 'recovered', 'matched', 'semanticValid', 'repairAttempted', 'structuredOutputRequested', 'historyHasAssistant', 'historyEndsWithAssistant', 'semanticsPresent', 'retrievalQueriesPresent', 'answerAspectsPresent'];
    const enums: Record<string, readonly string[]> = {
      interpretationVersion: ['semantic-recovery-v2'],
      validatorFunction: ['validateInterpretation'],
      repairDecision: ['NOT_NEEDED', 'VALIDATED_SEMANTICS', 'MODEL_REPAIR', 'EXHAUSTED'],
      routing: ['SAFETY_HANDLING', 'CONVERSATIONAL_FEEDBACK', 'CONVERSATIONAL_CONTINUATION', 'SOCIAL_RESPONSE', 'NORMAL_BUSINESS_ROUTING'],
      informationNeed: ['UNKNOWN', 'AMBIGUOUS', 'STATIC_BUSINESS_INFORMATION', 'PERSONAL_LIVE_RECORD', 'MIXED_STATIC_AND_PERSONAL'],
      socialClassification: ['GREETING', 'WELLBEING_EXCHANGE', 'ACKNOWLEDGMENT', 'GRATITUDE', 'FAREWELL', 'BUSINESS_REQUEST_WITH_GREETING', 'OTHER', 'AMBIGUOUS', 'UNKNOWN'],
      semanticUncertainty: ['NONE', 'AMBIGUOUS', 'UNKNOWN'],
      socialGuardStatus: ['EVALUATED', 'SEMANTIC_VALIDATION_REJECTED', 'UNKNOWN'],
      socialDecision: ['SAFE_SOCIAL_RESPONSE', 'CONTINUE_BUSINESS_PIPELINE', 'CLARIFICATION_REQUIRED', 'EXISTING_SAFETY_HANDLING'],
      socialDecisionReason: ['BUSINESS_REQUEST_PRESENT', 'SOCIAL_CLASSIFICATION_UNCERTAIN', 'NOT_A_PURE_SOCIAL_MESSAGE', 'SEMANTIC_INTERPRETATION_UNCERTAIN', 'UNSAFE_SOCIAL_SHORTCUT_INPUT', 'SUBSTANTIVE_OR_NEGATED_INTENT_PRESENT', 'ENTITY_REQUIRES_NORMAL_ROUTING', 'SOCIAL_CLASSIFICATION_CONTRADICTS_INTENT', 'VALIDATED_PURE_SOCIAL_MESSAGE'],
      rejectedField: ['retrievalQueries', 'answerAspects', 'none'],
      finalValidatorRule: ['invalid_retrieval_queries', 'invalid_answer_aspects', 'none'],
      semanticIntents: ['none'],
      citationRequirement: ['FACTUAL_ROUTE_RELEVANT_EVIDENCE'],
      businessClaimAssessment: ['NOT_ESTABLISHED', 'UNSUPPORTED_STRUCTURED_CLAIM'],
    };
    const metadata: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(input)) {
      if (counts.includes(key) && typeof value === 'number' && Number.isFinite(value)) metadata[key] = Math.max(0, Math.min(100_000, Math.floor(value)));
      else if (flags.includes(key) && typeof value === 'boolean') metadata[key] = value;
      else if (['reason', 'semanticValidationReason'].includes(key) && typeof value === 'string' && (SAFE_REASONS.has(value) || SAFE_REASONS.has(`citation_${value}`) || value === 'valid')) metadata[key] = value;
      else if (['legacyIntentType', 'answerAspectsType', 'retrievalQueriesType'].includes(key) && typeof value === 'string' && ['array', 'object', 'string', 'number', 'boolean', 'undefined', 'omitted'].includes(value)) metadata[key] = value;
      else if (key === 'semanticIntents' && typeof value === 'string' && value.length <= 400 && /^(?:[A-Z_]+:(?:AFFIRMATIVE|NEGATED|UNCERTAIN|NOT_APPLICABLE))(?:\|[A-Z_]+:(?:AFFIRMATIVE|NEGATED|UNCERTAIN|NOT_APPLICABLE))*$/u.test(value)) metadata[key] = value;
      else if (typeof value === 'string' && enums[key]?.includes(value)) metadata[key] = value;
      else if (key === 'claimKind' && (value === 'number' || value === 'date')) metadata[key] = value;
    }
    this.developmentChecks.push({ stage, metadata });
  }

  markRetrievalStarted(query: string | null, audience: 'PUBLIC_VISITOR' | 'INTERNAL_MANAGER_PREVIEW'): void {
    const normalizedQuery = query?.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim() ?? '';
    this.retrieval = { attempted: true, queryHash: normalizedQuery ? createHash('sha256').update(normalizedQuery).digest('hex').slice(0, 16) : null, mode: 'pending', audience, eligibilityStatus: 'PENDING', eligibleSourceCount: 0, resultCount: 0 };
  }

  markKnowledgeDeferred(): void {
    this.retrieval = { ...this.retrieval, attempted: false, queryHash: null, queryVariantHashes: [], executedQueries: [], queryVariantCount: 0, mode: 'not_required' };
  }

  setExecutedQueries(queries: readonly RetrievalQueryDiagnostic[]): void {
    const origins = ['CUSTOMER_MESSAGE', 'CONTEXT_RESOLUTION', 'LLM_INTERPRETATION', 'LLM_ANSWER_ASPECT', 'LLM_RECOVERY', 'LLM_TOOL_RETRY', 'BACKEND_FALLBACK'];
    const existing = this.retrieval.executedQueries ?? [];
    const parsed = queries.flatMap((item) => {
      const query = item.query.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b/giu, '[email]').replace(/(?:\+?\d[\d ().-]{6,}\d)/gu, '[number]').replace(/\b(?:gid:\/\/shopify\/[^\s"']+|#?\d{5,})\b/giu, '[id]').replace(/\s+/gu, ' ').trim().slice(0, 180);
      const languageTarget = item.languageTarget && item.languageTarget.length <= 80 && /^[\p{L}\p{M}\p{N} .,+()/'&_-]+$/u.test(item.languageTarget) ? item.languageTarget : null;
      return query && origins.includes(item.origin) ? [{ query, origin: item.origin, languageTarget }] : [];
    });
    const seen = new Set(existing.map((item) => `${item.origin}:${item.query.normalize('NFKC').toLocaleLowerCase()}`));
    const added = parsed.filter((item) => { const identity = `${item.origin}:${item.query.normalize('NFKC').toLocaleLowerCase()}`; if (seen.has(identity)) return false; seen.add(identity); return true; });
    this.retrieval = { ...this.retrieval, executedQueries: [...existing, ...added].slice(0, 10) };
  }

  record(event: ConversationStageEvent): void {
    if (this.events.length >= MAX_EVENTS) return;
    if (event.organizationId) this.organizationId = event.organizationId.slice(0, 64);
    if (event.assistantId) this.assistantId = event.assistantId.slice(0, 64);
    const safeModel = event.model && event.model.length <= 120 && !/(?:gsk_|sk-|sk_|AIza|sess-|Bearer\s)/i.test(event.model) ? event.model : undefined;
    this.events.push({
      sequence: ++this.sequence,
      requestId: event.requestId.slice(0, 64), organizationId: event.organizationId?.slice(0, 64) ?? null,
      assistantId: event.assistantId.slice(0, 64), channel: 'PLAYGROUND', stage: event.stage,
      outcome: event.outcome, durationMs: Math.max(0, Math.min(60_000, Math.round(event.durationMs))),
      ...(event.errorCategory ? { errorCategory: event.errorCategory } : {}),
      ...(event.purpose ? { purpose: event.purpose } : {}),
      ...(Number.isSafeInteger(event.callIndex) && (event.callIndex ?? 0) > 0 ? { callIndex: event.callIndex } : {}),
      ...(typeof event.requestDispatched === 'boolean' ? { requestDispatched: event.requestDispatched } : {}),
      ...(event.retryReason ? { retryReason: event.retryReason } : {}),
      ...(event.usage ? { usage: boundedUsage(event.usage) } : {}),
      ...(event.reason && SAFE_REASONS.has(event.reason) ? { reason: event.reason } : {}),
      ...(event.provider ? { provider: event.provider } : {}), ...(safeModel ? { model: safeModel } : {}),
      ...(Number.isFinite(event.resultCount) ? { resultCount: Math.max(0, Math.min(10_000, Math.round(event.resultCount!))) } : {}),
      ...(Number.isFinite(event.evidenceCount) ? { evidenceCount: Math.max(0, Math.min(MAX_EVIDENCE, Math.round(event.evidenceCount!))) } : {}),
      at: new Date().toISOString(),
    });
    this.emit(this.events[this.events.length - 1]!);
  }

  recordProviderCall(input: ProviderCallDiagnostic): void {
    this.providerCallTotal += 1;
    if (input.requestDispatched) this.providerRequestTotal += 1;
    if (this.providerCalls.length >= 20) return;
    const model = input.model.length <= 120 && !/(?:gsk_|sk-|sk_|AIza|sess-|Bearer\s)/i.test(input.model) ? input.model : 'unavailable';
    const call = { ...input, model, durationMs: Math.max(0, Math.min(60_000, Math.round(input.durationMs))), ...(input.usage ? { usage: boundedUsage(input.usage) } : {}) };
    this.providerCalls.push(call);
    this.record({ requestId: this.traceId, organizationId: this.organizationId, assistantId: this.assistantId, channel: 'PLAYGROUND', stage: 'PROVIDER_RESPONSE_RECEIVED', outcome: input.outcome === 'COMPLETED' ? 'COMPLETED' : 'FAILED', durationMs: call.durationMs, provider: input.provider as ConversationStageEvent['provider'], model, purpose: input.purpose, callIndex: input.callIndex, requestDispatched: input.requestDispatched, ...(input.retryReason ? { retryReason: input.retryReason } : {}), ...(input.usage ? { usage: boundedUsage(input.usage) } : {}), ...(input.errorCategory ? { errorCategory: input.errorCategory } : {}), ...(input.outcome === 'FAILED' ? { reason: 'provider_call_failed' } : {}) });
  }

  setAssistantConfiguration(input: { id: string; version: string | null; sections: Record<string, string | null> }): void {
    const sectionLengths = Object.fromEntries(Object.entries(input.sections).slice(0, 12).map(([key, value]) => [key, typeof value === 'string' ? Math.min(value.length, 10_000) : 0]));
    this.assistantConfiguration = { id: /^[a-zA-Z0-9_-]{1,64}$/u.test(input.id) ? input.id : 'unavailable', version: input.version && /^\d{4}-\d\d-\d\dT/u.test(input.version) ? input.version.slice(0, 32) : null, loaded: true, sectionLengths };
  }

  setConversationMemory(input: ConversationMemoryDiagnostic): void {
    const count = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1_000_000, Math.floor(value))) : 0;
    this.memory = {
      loadedMessageCount: count(input.loadedMessageCount), includedMessageCount: count(input.includedMessageCount),
      contextBytes: count(input.contextBytes), droppedMessageCount: count(input.droppedMessageCount),
      contentTruncationCount: count(input.contentTruncationCount), order: 'chronological', windowAtCapacity: input.windowAtCapacity === true,
      truncationReasons: [...new Set(input.truncationReasons.filter((reason) => ['MESSAGE_LIMIT', 'BYTE_LIMIT', 'CONTENT_TRUNCATED'].includes(reason)))].slice(0, 3),
    };
  }

  setPromptAssembly(input: { completed: boolean; platformInstructionsIncluded: boolean; assistantBehaviorIncluded: boolean; assistantBehaviorSectionCount: number; agentBuilderNodeInstructionsIncluded: boolean; historyMessageCount?: number; historyRoles?: readonly ('user' | 'assistant')[] }): void {
    this.promptAssembly = { ...input, historyMessageCount: Math.max(0, Math.min(12, Math.floor(input.historyMessageCount ?? 0))), historyRoles: (input.historyRoles ?? []).filter((role) => role === 'user' || role === 'assistant').slice(0, 12), historySentToProvider: this.promptAssembly?.historySentToProvider ?? false, assistantBehaviorSectionCount: Math.max(0, Math.min(12, Math.floor(input.assistantBehaviorSectionCount))), outboundProviderRequestDispatched: this.promptAssembly?.outboundProviderRequestDispatched ?? false, assistantBehaviorSentToProvider: this.promptAssembly?.assistantBehaviorSentToProvider ?? false, providerCallIndexes: this.promptAssembly?.providerCallIndexes ?? [], assistantBehaviorCallIndexes: this.promptAssembly?.assistantBehaviorCallIndexes ?? [] };
  }

  markPromptDispatched(assistantBehaviorIncluded: boolean, callIndex: number): void {
    if (!this.promptAssembly) return;
    const safeIndex = Number.isSafeInteger(callIndex) && callIndex > 0 && callIndex <= 20 ? callIndex : null;
    this.promptAssembly = { ...this.promptAssembly, outboundProviderRequestDispatched: true, historySentToProvider: this.promptAssembly.historySentToProvider || this.promptAssembly.historyMessageCount > 0, assistantBehaviorSentToProvider: this.promptAssembly.assistantBehaviorSentToProvider || assistantBehaviorIncluded, providerCallIndexes: safeIndex && !this.promptAssembly.providerCallIndexes.includes(safeIndex) ? [...this.promptAssembly.providerCallIndexes, safeIndex] : this.promptAssembly.providerCallIndexes, assistantBehaviorCallIndexes: assistantBehaviorIncluded && safeIndex && !this.promptAssembly.assistantBehaviorCallIndexes.includes(safeIndex) ? [...this.promptAssembly.assistantBehaviorCallIndexes, safeIndex] : this.promptAssembly.assistantBehaviorCallIndexes };
  }

  setConfiguredFactEvidence(input: { configured: boolean; selected: boolean; revalidated: boolean; supplied: boolean; excludedReason?: string; sourceId?: string }): void {
    const allowedReasons = ['CONTACT_CONFIGURATION_NOT_PRESENT', 'CONTACT_CONFIGURATION_INVALID', 'NOT_RELEVANT_TO_QUERY', 'EVIDENCE_SELECTION_LIMIT', 'REVALIDATION_FAILED'];
    this.configuredFacts = { kind: 'support_contacts', configured: input.configured, selected: input.selected, revalidated: input.revalidated, supplied: input.supplied, ...(input.excludedReason && allowedReasons.includes(input.excludedReason) ? { excludedReason: input.excludedReason } : {}), ...(input.sourceId && /^[a-zA-Z0-9_-]{1,64}$/u.test(input.sourceId) ? { sourceId: input.sourceId } : {}) };
  }

  markConfiguredFactSupplied(): void {
    if (this.configuredFacts?.selected && this.configuredFacts.revalidated) this.configuredFacts = { ...this.configuredFacts, supplied: true };
  }

  setCommerceReadiness(input: { connectionStatus: string; scopeSnapshotStatus: string; relevantGrantedScopes: readonly string[]; assistantEnabledOperations: readonly string[]; eligible: boolean; reason: string | null; recordCount: number; dataSource: 'NORMALIZED_SNAPSHOT' }): void {
    this.commerceReadiness = {
      connectionStatus: ['CONNECTED', 'NOT_CONNECTED'].includes(input.connectionStatus) ? input.connectionStatus : 'UNAVAILABLE',
      scopeSnapshotStatus: ['FRESH', 'STALE', 'UNAVAILABLE'].includes(input.scopeSnapshotStatus) ? input.scopeSnapshotStatus : 'UNAVAILABLE',
      relevantGrantedScopes: [...new Set(input.relevantGrantedScopes.filter((scope) => ['read_products', 'read_inventory'].includes(scope)))].slice(0, 4),
      assistantEnabledOperations: [...new Set(input.assistantEnabledOperations.filter((operation) => ['PRODUCTS', 'PRICES', 'INVENTORY', 'CATEGORIES'].includes(operation)))].slice(0, 8),
      eligible: input.eligible === true,
      reason: input.reason && /^[A-Z0-9_]{1,64}$/u.test(input.reason) ? input.reason : null,
      recordCount: Math.max(0, Math.min(100_000, Math.floor(input.recordCount))),
      dataSource: 'NORMALIZED_SNAPSHOT',
    };
  }

  milestone(stage: ConversationStageEvent['stage'], input: { organizationId: string; assistantId: string; outcome?: ConversationStageEvent['outcome']; errorCategory?: ConversationStageEvent['errorCategory']; reason?: string; provider?: string; model?: string; resultCount?: number; evidenceCount?: number; durationMs?: number } ): void {
    this.record({ requestId: this.traceId, organizationId: input.organizationId, assistantId: input.assistantId, channel: 'PLAYGROUND', stage, outcome: input.outcome ?? 'COMPLETED', durationMs: input.durationMs ?? 0, ...(input.errorCategory ? { errorCategory: input.errorCategory } : {}), ...(input.reason ? { reason: input.reason } : {}), ...(input.provider ? { provider: input.provider as ConversationStageEvent['provider'] } : {}), ...(input.model ? { model: input.model } : {}), ...(input.resultCount !== undefined ? { resultCount: input.resultCount } : {}), ...(input.evidenceCount !== undefined ? { evidenceCount: input.evidenceCount } : {}) });
  }

  setRetrieval(input: { query: string | null; queryVariants?: readonly string[]; executedQueries?: readonly RetrievalQueryDiagnostic[]; mode: string; audience: 'PUBLIC_VISITOR' | 'INTERNAL_MANAGER_PREVIEW'; eligibleSourceCount: number; resultCount: number; semanticUnavailableCode?: string; queryPlanningMode?: string; customerLanguage?: string | null; sourceLanguageHintCount?: number; queryVariantCount?: number; assignedSourceCount?: number; rejectedSourceCount?: number; rejectionReasons?: Array<{ reason: string; count: number }>; indexReadySourceCount?: number; activeIndexChunkCount?: number; sourceIndexStates?: Array<{ sourceId: string; sourceVersion: number; activeGeneration: number | null; processingStatus: string; ready: boolean }>; lexicalCandidateCount?: number; semanticCandidateCount?: number; rankedCandidateCount?: number; filteredCandidateCount?: number; selectedEvidenceCount?: number; retrievalReason?: string; methodsAttempted?: string[] }): void {
    const priorExecutedQueries = this.retrieval.executedQueries ?? [];
    const normalizedQuery = input.query?.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim() ?? '';
    const eligibilityStatus = input.eligibleSourceCount > 0 ? 'ELIGIBLE_SOURCES_FOUND' : 'NO_ELIGIBLE_SOURCES';
    const safeCode = input.semanticUnavailableCode && SAFE_RETRIEVAL_CODES.has(input.semanticUnavailableCode) ? input.semanticUnavailableCode : undefined;
    const bounded = (value?: number) => Number.isFinite(value) ? Math.max(0, Math.min(10_000, Math.floor(value!))) : undefined;
    const safeReason = input.retrievalReason && SAFE_RETRIEVAL_CODES.has(input.retrievalReason) ? input.retrievalReason : undefined;
    const methods = (input.methodsAttempted ?? []).filter((method) => ['lexical', 'semantic'].includes(method)).slice(0, 2);
    const counts = { queryVariantCount: bounded(input.queryVariantCount), assignedSourceCount: bounded(input.assignedSourceCount), rejectedSourceCount: bounded(input.rejectedSourceCount), indexReadySourceCount: bounded(input.indexReadySourceCount), activeIndexChunkCount: bounded(input.activeIndexChunkCount), lexicalCandidateCount: bounded(input.lexicalCandidateCount), semanticCandidateCount: bounded(input.semanticCandidateCount), rankedCandidateCount: bounded(input.rankedCandidateCount), filteredCandidateCount: bounded(input.filteredCandidateCount), selectedEvidenceCount: bounded(input.selectedEvidenceCount) };
    const rejectionReasons = (input.rejectionReasons ?? []).filter((item) => ['PUBLIC_WEBSITE_NOT_ELIGIBLE', 'CONNECTOR_PERMISSION_OR_CAPABILITY_BLOCKED'].includes(item.reason) && Number.isFinite(item.count) && item.count >= 0).slice(0, 4).map((item) => ({ reason: item.reason, count: Math.min(10_000, Math.floor(item.count)) }));
    const queryPlanningMode = ['MODEL_INTERPRETED', 'SEMANTIC_METADATA_RECOVERY', 'ORIGINAL_QUERY_FALLBACK'].includes(String(input.queryPlanningMode)) ? input.queryPlanningMode : undefined;
    const customerLanguage = input.customerLanguage && input.customerLanguage.length <= 80 && /^[\p{L}\p{M}\p{N} .,+()/'&_-]+$/u.test(input.customerLanguage) ? input.customerLanguage : null;
    const queryVariantHashes = (input.queryVariants ?? []).slice(0, 8).flatMap((query) => {
      const safeQuery = query.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 300);
      return safeQuery ? [createHash('sha256').update(safeQuery).digest('hex').slice(0, 16)] : [];
    });
    const sourceIndexStates = (input.sourceIndexStates ?? []).slice(0, 20).flatMap((source) => {
      if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(source.sourceId) || !Number.isSafeInteger(source.sourceVersion) || source.sourceVersion < 0 || !(source.activeGeneration === null || Number.isSafeInteger(source.activeGeneration)) || !/^[A-Z_]{1,40}$/u.test(source.processingStatus) || typeof source.ready !== 'boolean') return [];
      return [{ sourceId: source.sourceId, sourceVersion: source.sourceVersion, activeGeneration: source.activeGeneration, processingStatus: source.processingStatus, ready: source.ready }];
    });
    this.retrieval = { attempted: true, queryHash: normalizedQuery ? createHash('sha256').update(normalizedQuery).digest('hex').slice(0, 16) : null, queryVariantHashes, mode: input.mode, audience: input.audience, eligibilityStatus, eligibleSourceCount: Math.max(0, Math.min(10_000, Math.floor(input.eligibleSourceCount))), resultCount: Math.max(0, Math.min(10_000, Math.floor(input.resultCount))), ...(safeCode ? { semanticUnavailableCode: safeCode } : {}), ...(queryPlanningMode ? { queryPlanningMode } : {}), customerLanguage, sourceLanguageHintCount: bounded(input.sourceLanguageHintCount), ...(safeReason ? { retrievalReason: safeReason } : {}), ...counts, rejectionReasons, sourceIndexStates, methodsAttempted: methods };
    this.setExecutedQueries([...priorExecutedQueries, ...(input.executedQueries ?? [])]);
  }

  setLanguageHandling(input: { customerLanguage: string | null; responseLanguage: string | null; script: string | null }): void {
    const safeLabel = (value: string | null) => value && value.length <= 80 && /^[\p{L}\p{M}\p{N} .,+()/'&_-]+$/u.test(value) ? value : null;
    const script = input.script && ['MIXED_LATIN_DEVANAGARI', 'DEVANAGARI', 'LATIN', 'OTHER', 'UNKNOWN'].includes(input.script) ? input.script : null;
    this.languageHandling = { customerLanguage: safeLabel(input.customerLanguage), responseLanguage: safeLabel(input.responseLanguage), script };
  }

  setRevalidationOutcome(rejectedCount: number, selectedCount: number): void {
    if (rejectedCount <= 0) return;
    const boundedCount = (value: number) => Math.max(0, Math.min(10_000, Math.floor(value)));
    this.retrieval = { ...this.retrieval, retrievalReason: 'REVALIDATION_FAILED', filteredCandidateCount: boundedCount((this.retrieval.filteredCandidateCount ?? 0) + rejectedCount), selectedEvidenceCount: boundedCount(selectedCount) };
  }

  setCitationValidation(input: { accepted: boolean; reason: string; evidenceCount: number; citedReferences: readonly string[]; unknownReferences: readonly string[]; attempts: number; expectedFormat?: string; recognizedReferenceCount?: number; suppliedReferences?: readonly string[]; initialDraftNonempty?: boolean; recoveryUsedVerifiedEvidence?: boolean }): void {
    const safeReferences = (values: readonly string[]) => [...new Set(values.filter((value) => /^(?:S|C)\d{1,3}$/u.test(value)))].slice(0, 8);
    const safeReason = ['valid_references', 'missing_reference', 'unknown_reference', 'missing_conflict_sources', 'unsupported_numeric_claim', 'unsupported_url', 'unsupported_merchant_fact', 'unsupported_structured_product_fact', 'evidence_authorization_changed', 'retry_generation_failed'].includes(input.reason) ? input.reason : 'unknown';
    this.citationValidation = { accepted: input.accepted, reason: safeReason, evidenceCount: Math.max(0, Math.min(10_000, Math.floor(input.evidenceCount))), citedReferences: safeReferences(input.citedReferences), unknownReferences: safeReferences(input.unknownReferences), attempts: Math.max(1, Math.min(2, Math.floor(input.attempts))), expectedFormat: '[S<number>] or [C<number>]', recognizedReferenceCount: Math.max(0, Math.min(100, Math.floor(input.recognizedReferenceCount ?? 0))), suppliedReferences: safeReferences(input.suppliedReferences ?? []), initialDraftNonempty: input.initialDraftNonempty === true, recoveryUsedVerifiedEvidence: input.recoveryUsedVerifiedEvidence === true };
  }

  addEvidence(item: Omit<PlaygroundDiagnosticEvidence, 'selectedForContext' | 'revalidated' | 'suppliedToProvider' | 'cited'> & Partial<Pick<PlaygroundDiagnosticEvidence, 'selectedForContext' | 'revalidated' | 'suppliedToProvider' | 'cited'>>): void {
    if (this.evidence.size >= MAX_EVIDENCE && !this.evidence.has(item.reference)) return;
    const locator = safeLocator(item.locator);
    this.evidence.set(item.reference.slice(0, 12), {
      reference: item.reference.slice(0, 12), sourceId: item.sourceId.slice(0, 64), chunkId: item.chunkId.slice(0, 64),
      ...(item.pageId ? { pageId: item.pageId.slice(0, 64) } : {}), ...(item.contentHash ? { contentHash: item.contentHash.slice(0, 64) } : {}),
      ...(Number.isSafeInteger(item.indexGeneration) && (item.indexGeneration ?? 0) > 0 ? { indexGeneration: item.indexGeneration } : {}),
      ...(Number.isSafeInteger(item.rankingPosition) && (item.rankingPosition ?? 0) > 0 ? { rankingPosition: item.rankingPosition } : {}),
      sourceType: item.sourceType.slice(0, 40), title: item.title.replace(/[\u0000-\u001f\u007f]/gu, ' ').slice(0, 160), locator,
      excerpt: item.excerpt.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').slice(0, MAX_EXCERPT),
      ...(typeof item.score === 'number' && Number.isFinite(item.score) ? { score: item.score } : {}),
      ...(item.scoreMethod ? { scoreMethod: item.scoreMethod.slice(0, 40) } : {}),
      ...(Number.isSafeInteger(item.sourceVersion) && (item.sourceVersion ?? 0) > 0 ? { sourceVersion: item.sourceVersion } : {}),
      ...(item.fetchedAt ? { fetchedAt: item.fetchedAt.slice(0, 40) } : {}),
      retrieved: item.retrieved, selectedForContext: item.selectedForContext ?? false, revalidated: item.revalidated ?? false,
      suppliedToProvider: item.suppliedToProvider ?? false, cited: item.cited ?? false,
    });
  }

  markSelected(references: readonly string[]): void {
    const selected = new Set(references);
    for (const [reference, item] of this.evidence) if (selected.has(reference)) this.evidence.set(reference, { ...item, selectedForContext: true });
  }

  markRevalidated(references: readonly string[]): void {
    const passed = new Set(references);
    for (const [reference, item] of this.evidence) if (item.selectedForContext) this.evidence.set(reference, { ...item, revalidated: item.revalidated || passed.has(reference) });
  }

  markSupplied(references: readonly string[]): void {
    const supplied = new Set(references);
    for (const [reference, item] of this.evidence) this.evidence.set(reference, { ...item, suppliedToProvider: item.suppliedToProvider || supplied.has(reference) });
  }

  recordTool(tool: string, outcome: string, resultCount?: number, reason?: string, details: { input?: string; dataSource?: 'NORMALIZED_SNAPSHOT' | 'AUTHORIZED_KNOWLEDGE_INDEX'; durationMs?: number; queryOrigin?: RetrievalQueryDiagnostic['origin']; queryLanguageTarget?: string | null } = {}): void {
    if (this.toolEvents.length >= 12) return;
    const knownTools = new Set(['search_business_knowledge', 'search_store_products', 'shopify_product_search']);
    const safeReasons = new Set(['tool_timeout', 'permission_unavailable', 'invalid_arguments', 'tool_not_authorized', 'tool_unavailable', 'tool_budget_exhausted', 'not_product_request', 'commerce_read_unavailable', 'PRODUCT_INTENT_NOT_DETECTED', 'PRODUCT_TOOL_NOT_SUPPORTED', 'NO_PRODUCT_EVIDENCE_RETURNED', 'PRODUCT_OPERATION_UNSUPPORTED', 'NO_CONNECTED_SHOPIFY_CONNECTION', 'SHOPIFY_SCOPE_SNAPSHOT_STALE', 'SHOPIFY_READ_PRODUCTS_NOT_GRANTED', 'PRODUCT_CATALOG_CAPABILITY_UNVERIFIED', 'WORKSPACE_PERMISSION_DISABLED', 'ASSISTANT_PERMISSION_DISABLED', 'NO_QUERY_READY_PRODUCTS', 'PRODUCT_PERMISSION_UNAVAILABLE', 'PRODUCT_AUTHORIZATION_CHECK_FAILED', 'NO_AUTHORIZED_MATCHING_PRODUCT_EVIDENCE', 'PRODUCT_SEARCH_FAILED', 'PRICE_WORKSPACE_PERMISSION_DISABLED', 'PRICE_ASSISTANT_PERMISSION_DISABLED', 'PRICE_CAPABILITY_UNVERIFIED']);
    const safeOutcomes = new Set(['requested', 'completed', 'skipped', 'denied', 'failed', 'timed_out']);
    safeReasons.add('PRODUCT_SEARCH_DEFERRED_TO_NATIVE_TOOL');
    safeReasons.add('query_already_searched');
    safeReasons.add('knowledge_recovery_budget_exhausted');
    safeReasons.add('knowledge_recovery_not_requested');
    const safeTool = knownTools.has(tool) ? tool : 'unknown';
    const safeOutcome = safeOutcomes.has(outcome) ? outcome : 'unknown';
    const boundedCount = Number.isFinite(resultCount) ? Math.max(0, Math.min(100, Math.round(resultCount!))) : undefined;
    const safeReason = reason && safeReasons.has(reason) ? reason : undefined;
    const safeInput = details.input?.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b/giu, '[email]').replace(/(?:\+?\d[\d ().-]{6,}\d)/gu, '[number]').replace(/\b(?:gid:\/\/shopify\/[^\s"']+|#?\d{5,})\b/giu, '[id]').replace(/\s+/gu, ' ').trim().slice(0, 180);
    const durationMs = Number.isFinite(details.durationMs) ? Math.max(0, Math.min(60_000, Math.round(details.durationMs!))) : undefined;
    const origins = ['CUSTOMER_MESSAGE', 'CONTEXT_RESOLUTION', 'LLM_INTERPRETATION', 'LLM_ANSWER_ASPECT', 'LLM_RECOVERY', 'LLM_TOOL_RETRY', 'BACKEND_FALLBACK'];
    const safeLanguageTarget = details.queryLanguageTarget && details.queryLanguageTarget.length <= 80 && /^[\p{L}\p{M}\p{N} .,+()/'&_-]+$/u.test(details.queryLanguageTarget) ? details.queryLanguageTarget : undefined;
    this.toolEvents.push({ tool: safeTool, outcome: safeOutcome, ...(boundedCount !== undefined ? { resultCount: boundedCount } : {}), ...(safeReason ? { reason: safeReason } : {}), ...(safeInput ? { input: safeInput } : {}), ...(details.dataSource ? { dataSource: details.dataSource } : {}), ...(durationMs !== undefined ? { durationMs } : {}), ...(details.queryOrigin && origins.includes(details.queryOrigin) ? { queryOrigin: details.queryOrigin } : {}), ...(safeLanguageTarget ? { queryLanguageTarget: safeLanguageTarget } : {}) });
    if (this.events.length >= MAX_EVENTS) return;
    const mappedOutcome: ConversationStageEvent['outcome'] = safeOutcome === 'requested' ? 'STARTED'
      : safeOutcome === 'completed' ? 'COMPLETED'
        : safeOutcome === 'skipped' ? 'SKIPPED'
          : safeOutcome === 'timed_out' ? 'TIMED_OUT'
            : safeOutcome === 'denied' || safeOutcome === 'failed' ? 'FAILED' : 'SKIPPED';
    const event: StoredEvent = {
      requestId: this.traceId, organizationId: this.organizationId, assistantId: this.assistantId, channel: 'PLAYGROUND', stage: 'TOOL_EXECUTION',
      outcome: mappedOutcome, durationMs: durationMs ?? 0, sequence: ++this.sequence, at: new Date().toISOString(), tool: safeTool,
      ...(boundedCount !== undefined ? { resultCount: boundedCount } : {}), ...(safeReason ? { reason: safeReason } : {}),
    };
    this.events.push(event);
    this.emit(event);
  }

  snapshot(result: { messageId?: string; answerOrigin?: string; provenance?: string; deliveryStatus?: string; sources?: readonly { reference?: string; type?: string }[]; retrievalMode?: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }, terminal: { outcome?: ConversationStageEvent['outcome']; errorCategory?: ConversationStageEvent['errorCategory'] } = {}) {
    const buildRevision = /^[a-f0-9]{40}$/iu.test(process.env.VERCEL_GIT_COMMIT_SHA ?? '') ? process.env.VERCEL_GIT_COMMIT_SHA : 'UNAVAILABLE';
    const cited = new Set((result.sources ?? []).map((source) => source.reference).filter((value): value is string => typeof value === 'string'));
    for (const [reference, item] of this.evidence) this.evidence.set(reference, { ...item, cited: cited.has(reference) });
    const citedSources = (result.sources ?? []).filter((source) => source.reference && cited.has(source.reference));
    const usesKnowledge = citedSources.some((source) => source.type !== 'COMMERCE_PRODUCT');
    const usesCommerce = citedSources.some((source) => source.type === 'COMMERCE_PRODUCT');
    const finalSource = ['DETERMINISTIC_SOCIAL', 'DETERMINISTIC_POLICY', 'KNOWLEDGE_FALLBACK'].includes(result.answerOrigin || '') ? 'SYSTEM_RESPONSE'
      : usesKnowledge && usesCommerce ? 'KNOWLEDGE_BASE_AND_SHOPIFY'
        : usesKnowledge ? 'KNOWLEDGE_BASE' : usesCommerce ? 'SHOPIFY' : result.answerOrigin === 'MODEL_GENERATED' ? 'AI_GENERATED' : 'UNKNOWN';
    const suppliedEvidenceCount = [...this.evidence.values()].filter((item) => item.suppliedToProvider).length;
    const groundingStatus = this.citationValidation ? this.citationValidation.accepted ? 'CITATIONS_VALIDATED' : 'CITATIONS_REJECTED'
      : this.retrieval.attempted && this.retrieval.resultCount === 0 ? 'NO_EVIDENCE'
        : suppliedEvidenceCount ? 'SUPPLIED_NOT_VALIDATED' : 'NOT_APPLICABLE';
    const finishedAt = new Date().toISOString();
    const events = [...this.events];
    if (events.length < MAX_EVENTS && !events.some((event) => event.stage === 'FINAL_RESPONSE')) {
      const finalEvent: StoredEvent = { requestId: this.traceId, organizationId: this.organizationId, assistantId: this.assistantId, channel: 'PLAYGROUND', stage: 'FINAL_RESPONSE', outcome: terminal.outcome ?? 'COMPLETED', durationMs: 0, ...(terminal.errorCategory ? { errorCategory: terminal.errorCategory } : {}), sequence: ++this.sequence, at: finishedAt };
      events.push(finalEvent);
      this.emit(finalEvent);
    }
    return {
      traceId: this.traceId, ...(result.messageId ? { messageId: result.messageId.slice(0, 64) } : {}), startedAt: this.startedAt, finishedAt,
      ...(this.developmentCapture && Date.now() < this.captureExpiresAt ? { developmentCapture: { mode: 'METADATA_ONLY' as const, diagnosticVersion: 'interpretation-boundaries-v3', buildRevision, interpretationVersion: 'semantic-recovery-v2', expiresAt: new Date(this.captureExpiresAt).toISOString(), checks: this.developmentChecks.map((check) => ({ stage: check.stage, metadata: { ...check.metadata } })) } } : {}),
      totalLatencyMs: Math.max(0, Date.parse(finishedAt) - Date.parse(this.startedAt)),
      events: events.map((event) => ({ ...event, traceId: this.traceId, operation: event.tool ? 'TOOL_EXECUTION' : event.stage, status: event.outcome.toLowerCase() })),
      retrieval: { ...this.retrieval, ...(result.retrievalMode ? { responseRetrievalMode: result.retrievalMode } : {}) },
      ...(this.languageHandling ? { languageHandling: { ...this.languageHandling } } : {}),
      ...(this.memory ? { memory: { ...this.memory, truncationReasons: [...this.memory.truncationReasons] } } : {}),
      ...(this.assistantConfiguration ? { assistantConfiguration: { ...this.assistantConfiguration, sectionLengths: { ...this.assistantConfiguration.sectionLengths } } } : {}),
      ...(this.promptAssembly ? { promptAssembly: { ...this.promptAssembly, historyRoles: [...this.promptAssembly.historyRoles] } } : {}),
      ...(this.configuredFacts ? { configuredFacts: { ...this.configuredFacts } } : {}),
      ...(this.commerceReadiness ? { commerceReadiness: { ...this.commerceReadiness } } : {}),
      ...(this.citationValidation ? { citationValidation: { ...this.citationValidation } } : {}),
      finalAnswer: { answerOrigin: result.answerOrigin ?? 'UNKNOWN', provenance: result.provenance ?? 'UNKNOWN', deliveryStatus: result.deliveryStatus ?? (terminal.errorCategory ? terminal.errorCategory.startsWith('PROVIDER_') ? 'PROVIDER_UNAVAILABLE' : 'INTERNAL_EXECUTION_FAILURE' : this.citationValidation && !this.citationValidation.accepted ? 'FACTUAL_VERIFICATION_REJECTED' : 'SAFE_ANSWER_DELIVERED'), groundingStatus, suppliedEvidenceCount },
      tools: this.toolEvents, providerCalls: [...this.providerCalls], providerCallCount: this.providerCallTotal, providerRequestCount: this.providerRequestTotal, evidence: [...this.evidence.values()], finalSource, ...(result.usage ? { usage: result.usage } : {}),
    };
  }

  private emit(event: StoredEvent): void {
    try { this.onEvent?.({ ...event, traceId: this.traceId, operation: event.tool ? 'TOOL_EXECUTION' : event.stage, status: event.outcome.toLowerCase() }); }
    catch { /* A disconnected Inspector must not interrupt the authorized AI turn. */ }
  }
}

function boundedUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) {
  const bounded = (value?: number) => Number.isSafeInteger(value) ? Math.max(0, Math.min(10_000_000, value!)) : undefined;
  return { ...(bounded(usage.inputTokens) !== undefined ? { inputTokens: bounded(usage.inputTokens) } : {}), ...(bounded(usage.outputTokens) !== undefined ? { outputTokens: bounded(usage.outputTokens) } : {}), ...(bounded(usage.totalTokens) !== undefined ? { totalTokens: bounded(usage.totalTokens) } : {}) };
}

function safeLocator(value: string | null): string | null {
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return value.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, 500);
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString().slice(0, 500);
  } catch { return null; }
}

export function playgroundDiagnosticsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PLAYGROUND_DIAGNOSTICS_ENABLED === 'true' && (env.NODE_ENV === 'development' || env.APP_ENV === 'uat');
}

export function playgroundDevelopmentCaptureEnabled(optIn: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  return optIn === true && env.NODE_ENV === 'development' && playgroundDiagnosticsEnabled(env);
}
