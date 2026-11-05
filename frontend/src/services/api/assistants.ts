import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPostEventStream } from './client';

export type AssistantStatus = 'draft' | 'active' | 'inactive' | 'archived';
export type ResponseTone = 'professional' | 'friendly' | 'casual' | 'supportive' | 'concise' | 'empathetic';
export type ResponseStyle = 'short' | 'balanced' | 'detailed';
export type AssistantProvider = 'openrouter';
export type ResponseProvenance = 'AI_GENERATED' | 'KNOWLEDGE_GROUNDED' | 'SYSTEM_RESPONSE';
export interface EffectiveProviderConfiguration { provider: AssistantProvider | null; model: string | null; status: 'READY_FOR_TESTING' | 'MISSING_PROVIDER' | 'INVALID_PROVIDER' | 'MISSING_MODEL' | 'INVALID_MODEL' | 'INVALID_ENDPOINT' | 'MISSING_API_KEY'; configurationValid: boolean; keyConfigured: boolean; ready: boolean; }
export interface Assistant {
  id: string;
  organizationId: string;
  createdById: string | null;
  name: string;
  description: string | null;
  businessPurpose: string | null;
  systemInstructions: string | null;
  defaultLanguage: string;
  responseTone: ResponseTone;
  responseStyle: ResponseStyle;
  /** Backward-compatible response aliases for effectiveProviderConfiguration. */
  aiProvider?: AssistantProvider | null;
  aiModel?: string | null;
  effectiveProviderConfiguration?: EffectiveProviderConfiguration;
  fallbackMessage: string;
  greetingMessage: string | null;
  escalationMessage: string | null;
  useAllEligibleWorkspaceKnowledge?: boolean;
  status: AssistantStatus;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
export type AssistantInput = Pick<Assistant, 'name' | 'description' | 'businessPurpose' | 'systemInstructions' | 'defaultLanguage' | 'responseTone' | 'fallbackMessage'> & Partial<Pick<Assistant, 'responseStyle' | 'greetingMessage' | 'escalationMessage' | 'useAllEligibleWorkspaceKnowledge'>>;
export const ASSISTANT_SYSTEM_INSTRUCTIONS_MAX_LENGTH = 10_000;
export interface AssistantPage { assistants: Assistant[]; page: number; pageSize: number; total: number; }

const base = (slug: string) => `/workspaces/${encodeURIComponent(slug)}/assistants`;
export function listAssistants(slug: string, page = 1, signal?: AbortSignal, status: 'ALL' | 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' = 'ALL') {
  return apiGet<AssistantPage>(`${base(slug)}?page=${page}&pageSize=100&status=${status}`, signal);
}
export function getAssistant(slug: string, id: string, signal?: AbortSignal) {
  return apiGet<Assistant>(`${base(slug)}/${encodeURIComponent(id)}`, signal);
}
export function createAssistant(slug: string, input: AssistantInput, signal?: AbortSignal) {
  return apiPost<Assistant>(base(slug), input, signal);
}
export function updateAssistant(slug: string, id: string, input: Partial<AssistantInput>, signal?: AbortSignal) {
  return apiPatch<Assistant>(`${base(slug)}/${encodeURIComponent(id)}`, input, signal);
}
export function setAssistantActive(slug: string, id: string, active: boolean, signal?: AbortSignal) {
  return apiPost<Assistant>(`${base(slug)}/${encodeURIComponent(id)}/${active ? 'activate' : 'deactivate'}`, undefined, signal);
}
export const archiveAssistant = (slug: string, id: string) => apiPost<Assistant>(`${base(slug)}/${encodeURIComponent(id)}/archive`);
export const restoreAssistant = (slug: string, id: string) => apiPost<Assistant>(`${base(slug)}/${encodeURIComponent(id)}/restore`);

export interface ProviderConfigurationStatus {
  openrouter: { keyConfigured: boolean; status: 'READY_FOR_TESTING' | 'MISSING_API_KEY'; modelValidation: { model: string; available: boolean | null; toolCalling: 'SUPPORTED' | 'UNSUPPORTED' | 'UNVERIFIED'; checkedAt?: string; contextLength?: number; maxCompletionTokens?: number; inputModalities?: string[]; outputModalities?: string[]; supportedParameters?: string[]; pricing?: { prompt: string; completion: string } } | null };
  effective: EffectiveProviderConfiguration;
}

export const getProviderConfigurationStatus = (slug: string, signal?: AbortSignal) => apiGet<ProviderConfigurationStatus>(`${base(slug)}/provider-status`, signal);
export const validateOpenRouterModel = (slug: string, signal?: AbortSignal) => apiPost<NonNullable<ProviderConfigurationStatus['openrouter']['modelValidation']>>(`${base(slug)}/provider-status/openrouter/validate`, undefined, signal);

export interface AssistantRule { id: string; assistantId: string; title: string; instruction: string; enabled: boolean; createdAt: string; updatedAt: string; }
export interface AssistantAuditEvent { id: string; action: string; entityType: string; entityId: string | null; actorUserId: string | null; metadata: unknown; createdAt: string; actorUser: { name: string | null; email: string } | null; }
export const listAssistantRules = (slug: string, id: string, signal?: AbortSignal) => apiGet<AssistantRule[]>(`${base(slug)}/${encodeURIComponent(id)}/rules`, signal);
export const createAssistantRule = (slug: string, id: string, input: Pick<AssistantRule, 'title' | 'instruction'> & Partial<Pick<AssistantRule, 'enabled'>>) => apiPost<AssistantRule>(`${base(slug)}/${encodeURIComponent(id)}/rules`, input);
export const updateAssistantRule = (slug: string, id: string, ruleId: string, input: Partial<Pick<AssistantRule, 'title' | 'instruction' | 'enabled'>>) => apiPatch<AssistantRule>(`${base(slug)}/${encodeURIComponent(id)}/rules/${encodeURIComponent(ruleId)}`, input);
export const deleteAssistantRule = (slug: string, id: string, ruleId: string) => apiDelete<{ deleted: boolean }>(`${base(slug)}/${encodeURIComponent(id)}/rules/${encodeURIComponent(ruleId)}`);
export interface AssistantTrainingHistoryPage { events: AssistantAuditEvent[]; total: number; page: number; pageSize: number; hasMore: boolean; }
export function getAssistantTrainingHistory(slug: string, id: string, query: Record<string, string | number> = {}, signal?: AbortSignal) {
  const params = new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]));
  const queryString = params.toString();
  return apiGet<AssistantTrainingHistoryPage>(`${base(slug)}/${encodeURIComponent(id)}/training-history${queryString ? `?${queryString}` : ''}`, signal);
}
export interface AssistantTrainingOverview {
  assistant: Assistant;
  linkedKnowledgeBaseCount: number;
  linkedKnowledgeBases: Array<{ id: string; name: string }>;
  faqCount: number;
  textCount: number;
  totalKnowledge: number;
  readyCount: number;
  playgroundReadyCount?: number;
  processingCount: number;
  notIndexedCount: number;
  failedCount: number;
  attentionCount: number;
  activeRuleCount: number;
  disabledRuleCount: number;
  activeRulesPreview: Array<Pick<AssistantRule, 'id' | 'title' | 'instruction'>>;
  recentActivity: AssistantAuditEvent[];
  behaviorConfigured: boolean;
  hasCustomInstructions: boolean;
  hasGreeting: boolean;
  hasCustomFallback: boolean;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isKnowledgeBaseLink(value: unknown): boolean {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string';
}
function isTrainingOverview(value: unknown): value is AssistantTrainingOverview {
  if (!isRecord(value)) return false;
  const data = value;
  const countFields = ['linkedKnowledgeBaseCount', 'faqCount', 'textCount', 'totalKnowledge', 'readyCount', 'processingCount', 'notIndexedCount', 'failedCount', 'attentionCount', 'activeRuleCount', 'disabledRuleCount'];
  return isRecord(data.assistant) && typeof data.assistant.id === 'string' && typeof data.assistant.name === 'string' &&
    countFields.every((field) => typeof data[field] === 'number' && Number.isFinite(data[field])) &&
    Array.isArray(data.linkedKnowledgeBases) && data.linkedKnowledgeBases.every(isKnowledgeBaseLink) &&
    Array.isArray(data.activeRulesPreview) && Array.isArray(data.recentActivity) &&
    ['behaviorConfigured', 'hasCustomInstructions', 'hasGreeting', 'hasCustomFallback'].every((field) => typeof data[field] === 'boolean') &&
    (data.playgroundReadyCount === undefined || typeof data.playgroundReadyCount === 'number');
}
export async function getAssistantTrainingOverview(slug: string, id: string, signal?: AbortSignal): Promise<AssistantTrainingOverview> {
  const response = await apiGet<unknown>(`${base(slug)}/${encodeURIComponent(id)}/training-overview`, signal);
  if (!isTrainingOverview(response)) {
    throw new ApiError('The assistant training overview returned an invalid response.', 'invalid-response');
  }
  return response;
}
export interface PlaygroundTrace {
  schemaVersion?: number; requestId?: string; conversationId?: string; clientTurnId?: string; organizationId?: string; assistantId?: string; attempt?: number;
  developmentCapture?: { mode: 'METADATA_ONLY'; expiresAt: string; checks: Array<{ stage: string; metadata: Record<string, string | number | boolean> }> };
  protectedResponseDebug?: { expiresAt: string; records: Array<{ stage: string; attemptId: string; at: string; text: string; truncated: boolean }>; modelCalls?: Array<{ requestId: string; traceId: string; providerCallIndex: number; purpose: string; provider: string; model: string; stage: string; requestedInput: unknown; response: { representation: string; status: string; content: string | null; responseLength: number; truncated: boolean; toolCalls?: unknown; finishReason: string | null; httpStatus?: number; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; durationMs: number }; outcome: string; at: string; errorCategory?: string; parsing?: unknown; validation?: unknown; backendDecision?: unknown; repair?: unknown }>; omittedModelCallCount?: number; modelCallCaptureStatus?: 'COMPLETE' | 'CAPPED' };
  protectedCaptureStatus?: string;
  traceId: string; messageId?: string; startedAt: string; finishedAt: string; totalLatencyMs: number; retentionExpiresAt?: string; stageCoverage?: Array<{ stage: string; status: 'EXECUTED' | 'EXECUTED_FAILED' | 'SKIPPED' | 'IN_PROGRESS' | 'NOT_REACHED' | 'NOT_RECORDED_LIMIT' }>; finalSource: 'SYSTEM_RESPONSE' | 'KNOWLEDGE_BASE' | 'SHOPIFY' | 'KNOWLEDGE_BASE_AND_SHOPIFY' | 'AI_GENERATED' | 'UNKNOWN';
  events: Array<{ sequence: number; traceId?: string; at: string; startedAt?: string; operation: string; outcome: string; status: string; durationMs: number; reason?: string; errorCategory?: string; provider?: string; model?: string; tool?: string; resultCount?: number; evidenceCount?: number; purpose?: string; callIndex?: number; requestDispatched?: boolean; retryReason?: string; input?: Record<string, unknown>; output?: Record<string, unknown>; decision?: Record<string, unknown>; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }>;
  retrieval: { attempted: boolean; queryHash: string | null; queryVariantHashes?: string[]; executedQueries?: Array<{ query: string; origin: 'CUSTOMER_MESSAGE' | 'CONTEXT_RESOLUTION' | 'LLM_INTERPRETATION' | 'LLM_ANSWER_ASPECT' | 'LLM_RECOVERY' | 'LLM_TOOL_RETRY' | 'BACKEND_FALLBACK'; languageTarget: string | null }>; mode: string; audience: 'PUBLIC_VISITOR' | 'INTERNAL_MANAGER_PREVIEW' | null; eligibilityStatus: string; eligibleSourceCount: number; resultCount: number; semanticUnavailableCode?: string; responseRetrievalMode?: string; queryPlanningMode?: string; customerLanguage?: string | null; sourceLanguageHintCount?: number; queryVariantCount?: number; assignedSourceCount?: number; rejectedSourceCount?: number; rejectionReasons?: Array<{ reason: string; count: number }>; indexReadySourceCount?: number; activeIndexChunkCount?: number; sourceIndexStates?: Array<{ sourceId: string; sourceVersion: number; activeGeneration: number | null; processingStatus: string; ready: boolean }>; lexicalCandidateCount?: number; semanticCandidateCount?: number; rankedCandidateCount?: number; filteredCandidateCount?: number; selectedEvidenceCount?: number; retrievalReason?: string; methodsAttempted?: string[] };
  languageHandling?: { customerLanguage: string | null; responseLanguage: string | null; script: string | null };
  memory?: { loadedMessageCount: number; includedMessageCount: number; contextBytes: number; droppedMessageCount: number; contentTruncationCount: number; truncationReasons: string[]; order: 'chronological'; windowAtCapacity: boolean };
  assistantConfiguration?: { id: string; version: string | null; loaded: boolean; sectionLengths: Record<string, number> };
  promptAssembly?: { completed: boolean; platformInstructionsIncluded: boolean; assistantBehaviorIncluded: boolean; assistantBehaviorSectionCount: number; agentBuilderNodeInstructionsIncluded: boolean; outboundProviderRequestDispatched: boolean; assistantBehaviorSentToProvider: boolean; providerCallIndexes: number[]; assistantBehaviorCallIndexes: number[]; historyMessageCount?: number; historyRoles?: Array<'user' | 'assistant'>; historySentToProvider?: boolean };
  configuredFacts?: { kind: 'support_contacts'; configured: boolean; selected: boolean; revalidated: boolean; supplied: boolean; excludedReason?: string; sourceId?: string };
  commerceReadiness?: { connectionStatus: string; scopeSnapshotStatus: string; relevantGrantedScopes: string[]; assistantEnabledOperations: string[]; eligible: boolean; reason: string | null; recordCount: number; dataSource: 'NORMALIZED_SNAPSHOT' };
  citationValidation?: { accepted: boolean; reason: string; evidenceCount: number; citedReferences: string[]; unknownReferences: string[]; attempts: number };
  finalAnswer?: { answerOrigin: string; provenance: string; deliveryStatus?: 'SAFE_ANSWER_DELIVERED' | 'FACTUAL_VERIFICATION_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'INTERNAL_EXECUTION_FAILURE'; groundingStatus: string; suppliedEvidenceCount: number };
  tools: Array<{ tool: string; outcome: string; resultCount?: number; reason?: string; input?: string; dataSource?: 'NORMALIZED_SNAPSHOT' | 'AUTHORIZED_KNOWLEDGE_INDEX'; durationMs?: number }>;
  providerCallCount?: number;
  providerRequestCount?: number;
  providerCalls?: Array<{ callIndex: number; purpose: string; provider: string; model: string; outcome: 'COMPLETED' | 'FAILED'; requestDispatched: boolean; durationMs: number; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; retryReason?: string; errorCategory?: string }>;
  evidence: Array<{ reference: string; sourceId: string; pageId?: string | null; chunkId: string; contentHash?: string; indexGeneration?: number; rankingPosition?: number; sourceType: string; title: string; locator: string | null; excerpt: string; score?: number; scoreMethod?: string; sourceVersion?: number; fetchedAt?: string | null; retrieved: boolean; selectedForContext: boolean; revalidated: boolean; suppliedToProvider: boolean; cited: boolean }>;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}
export interface ProductCard { id: string; title: string; imageUrl: string | null; imageAltText: string | null; price: string | null; currency: string | null; compareAtPrice: string | null; availability: 'IN_STOCK' | 'OUT_OF_STOCK' | null; productUrl: string | null; variants: Array<{ title: string; price: string | null; currency: string | null; availability: 'IN_STOCK' | 'OUT_OF_STOCK' | null }>; syncedAt: string; stale: boolean; }
export interface PlaygroundChatReply { sessionId: string; diagnosticCaptureEnabled?: boolean; messageId?: string; createdAt?: string; reply: string; sources: Array<{ reference: string; title: string; type: string; locator: string | null }>; productCards?: ProductCard[]; retrievalMode: string; responseLanguage: string; responseType?: 'greeting' | 'social' | 'business_scope_redirect' | 'policy_refusal' | 'knowledge_setup' | 'knowledge_fallback' | 'grounded_answer'; answerOrigin?: 'MODEL_GENERATED' | 'DETERMINISTIC_SOCIAL' | 'DETERMINISTIC_POLICY' | 'KNOWLEDGE_FALLBACK'; deliveryStatus?: 'SAFE_ANSWER_DELIVERED' | 'FACTUAL_VERIFICATION_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'INTERNAL_EXECUTION_FAILURE'; provenance?: ResponseProvenance; providerUsed?: AssistantProvider; modelUsed?: string; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; fallbackReason?: 'no_relevant_match' | 'uncited_or_invalid_reference'; diagnostics?: PlaygroundTrace; }
export const sendPlaygroundMessage = (slug: string, id: string, message: string, sessionId: string | undefined, clientTurnId: string, signal?: AbortSignal, requestId = crypto.randomUUID(), diagnosticCapture = false) => apiPost<PlaygroundChatReply>(`${base(slug)}/${encodeURIComponent(id)}/playground/chat`, { message, ...(sessionId ? { sessionId } : {}), clientTurnId, diagnosticCapture }, signal, { timeoutMs: 55_000, requestId });
export type PlaygroundLiveEvent = PlaygroundTrace['events'][number];
export const sendPlaygroundMessageStream = (slug: string, id: string, message: string, sessionId: string | undefined, clientTurnId: string, signal: AbortSignal | undefined, requestId: string, handlers: { onReady: () => void; onEvent: (event: PlaygroundLiveEvent) => void; onTerminal: (event: { status: string; lastSequence: number }) => void }, diagnosticCapture = false) => apiPostEventStream<PlaygroundChatReply, PlaygroundLiveEvent>(`${base(slug)}/${encodeURIComponent(id)}/playground/chat/stream`, { message, ...(sessionId ? { sessionId } : {}), clientTurnId, diagnosticCapture }, signal, { timeoutMs: 55_000, requestId }, { onReady: handlers.onReady, onEvent: handlers.onEvent, onTerminal: (payload) => handlers.onTerminal(payload as { status: string; lastSequence: number }) });
export interface PlaygroundConversation { sessionId: string; diagnosticCaptureEnabled?: boolean; latest?: boolean; offset?: number; limit?: number; hasMore?: boolean; nextOffset?: number | null; messages: Array<{ id: string; clientTurnId?: string | null; role: 'user' | 'assistant'; content: string; sources: PlaygroundChatReply['sources']; productCards?: ProductCard[]; responseType?: string | null; provenance?: ResponseProvenance; providerUsed?: AssistantProvider | null; modelUsed?: string | null; usage?: { inputTokens?: number; outputTokens?: number }; createdAt: string }> }
export const getPlaygroundConversation = (slug: string, id: string, sessionId: string, signal?: AbortSignal, page?: { offset?: number; limit?: number; latest?: boolean }) => {
  const params = new URLSearchParams();
  if (page?.latest) params.set('latest', 'true');
  if (page?.offset !== undefined) params.set('offset', String(page.offset));
  if (page?.limit !== undefined) params.set('limit', String(page.limit));
  const query = params.toString();
  return apiGet<PlaygroundConversation>(`${base(slug)}/${encodeURIComponent(id)}/playground/sessions/${encodeURIComponent(sessionId)}${query ? `?${query}` : ''}`, signal);
};
export type PlaygroundDiagnosticTrace = { id: string; requestId: string; clientTurnId: string | null; attempt: number; outcome: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT'; payload: PlaygroundTrace; createdAt: string; expiresAt?: string };
export const setPlaygroundDiagnosticCapture = (slug: string, id: string, sessionId: string, enabled: boolean) => apiPatch<{ sessionId: string; enabled: boolean }>(`${base(slug)}/${encodeURIComponent(id)}/playground/sessions/${encodeURIComponent(sessionId)}/diagnostic-capture`, { enabled });
export const getPlaygroundDiagnosticTraces = (slug: string, id: string, sessionId: string, signal?: AbortSignal, page?: { offset?: number; limit?: number }) => {
  const params = new URLSearchParams();
  if (page?.offset !== undefined) params.set('offset', String(page.offset));
  if (page?.limit !== undefined) params.set('limit', String(page.limit));
  const query = params.toString();
  return apiGet<{ sessionId: string; captureEnabled: boolean; offset: number; limit: number; hasMore: boolean; nextOffset: number | null; items: PlaygroundDiagnosticTrace[] }>(`${base(slug)}/${encodeURIComponent(id)}/playground/sessions/${encodeURIComponent(sessionId)}/traces${query ? `?${query}` : ''}`, signal, { cache: 'no-store' });
};
export const listPlaygroundSessions = (slug: string, id: string, signal?: AbortSignal, page?: { offset?: number; limit?: number }) => {
  const params = new URLSearchParams();
  if (page?.offset !== undefined) params.set('offset', String(page.offset));
  if (page?.limit !== undefined) params.set('limit', String(page.limit));
  const query = params.toString();
  return apiGet<{ offset: number; limit: number; hasMore: boolean; nextOffset: number | null; captureAvailable: boolean; items: Array<{ id: string; captureEnabled: boolean; createdAt: string; updatedAt: string; expiresAt: string; messageCount: number; traceCount: number; preview: string }> }>(`${base(slug)}/${encodeURIComponent(id)}/playground/sessions${query ? `?${query}` : ''}`, signal, { cache: 'no-store' });
};
export async function deletePlaygroundSession(slug: string, id: string, sessionId: string) {
  const sessionsPath = `${base(slug)}/${encodeURIComponent(id)}/playground/sessions`;
  return apiDelete<{ conversationId: string; deleted: boolean }>(`${sessionsPath}/${encodeURIComponent(sessionId)}`);
}
export type WidgetDiagnosticSession = { id: string; captureEnabled: boolean; createdAt: string; updatedAt: string; preview: string; messageCount: number; traceCount: number };
export const setWidgetDiagnosticCapture = (slug: string, id: string, conversationId: string, enabled: boolean) => apiPatch<{ conversationId: string; enabled: boolean }>(`${base(slug)}/${encodeURIComponent(id)}/inspector/widget/conversations/${encodeURIComponent(conversationId)}/diagnostic-capture`, { enabled });
export const listWidgetDiagnosticSessions = (slug: string, id: string, signal?: AbortSignal, page?: { offset?: number; limit?: number }) => {
  const params = new URLSearchParams(); if (page?.offset !== undefined) params.set('offset', String(page.offset)); if (page?.limit !== undefined) params.set('limit', String(page.limit));
  const query = params.toString();
  return apiGet<{ channel: 'Widget'; offset: number; limit: number; hasMore: boolean; nextOffset: number | null; captureAvailable: boolean; items: WidgetDiagnosticSession[] }>(`${base(slug)}/${encodeURIComponent(id)}/inspector/widget/conversations${query ? `?${query}` : ''}`, signal, { cache: 'no-store' });
};
export const getWidgetDiagnosticTraces = (slug: string, id: string, conversationId: string, signal?: AbortSignal, page?: { offset?: number; limit?: number }) => {
  const params = new URLSearchParams(); if (page?.offset !== undefined) params.set('offset', String(page.offset)); if (page?.limit !== undefined) params.set('limit', String(page.limit));
  const query = params.toString();
  return apiGet<{ sessionId: string; channel: 'Widget'; captureEnabled: boolean; offset: number; limit: number; hasMore: boolean; nextOffset: number | null; messages: Array<{ id: string; role: string; content: string; createdAt: string }>; items: PlaygroundDiagnosticTrace[] }>(`${base(slug)}/${encodeURIComponent(id)}/inspector/widget/conversations/${encodeURIComponent(conversationId)}/traces${query ? `?${query}` : ''}`, signal, { cache: 'no-store' });
};
