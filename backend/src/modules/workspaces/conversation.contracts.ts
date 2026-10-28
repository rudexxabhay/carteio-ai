import type { ConversationProvider, ConversationProviderMessage, ConversationProviderResult, ProviderRoute } from './conversation-provider.service';
import type { ConversationUsage, PlaygroundConversationHandle, PlaygroundTurn, QueryInterpretation } from './conversation-intent';
import type { PlaygroundTraceRecorder } from './playground-diagnostics';

/** Validated by the HTTP DTO. Identifiers are still authorized by the server. */
export type PlaygroundTurnRequest = Readonly<{ message: string; sessionId?: string; clientTurnId?: string; diagnosticCapture?: boolean }>;
export type ResponseProvenance = 'AI_GENERATED' | 'KNOWLEDGE_GROUNDED' | 'SYSTEM_RESPONSE';
export type ConversationChannel = 'PLAYGROUND' | 'PUBLIC_WIDGET' | 'CUSTOMER_INTERNAL';
export type ConversationLifecycleStage =
  | 'SECURITY_CONTEXT' | 'SESSION_RESOLUTION' | 'CONVERSATION_CONTEXT' | 'PROVIDER_SELECTION'
  | 'INTENT_INTERPRETATION' | 'INTERPRETATION_RECOVERY' | 'PRODUCT_ROUTING_DECISION' | 'KNOWLEDGE_RETRIEVAL' | 'EVIDENCE_SELECTION' | 'ANSWER_GENERATION'
  | 'RESPONSE_VERIFICATION' | 'TURN_PERSISTENCE' | 'SESSION_RELEASE'
  | 'MESSAGE_RECEIVED' | 'ASSISTANT_RESOLVED' | 'KNOWLEDGE_ELIGIBILITY' | 'KNOWLEDGE_RETRIEVAL_SKIPPED' | 'STRUCTURED_OUTPUT_COMPATIBILITY' | 'RETRIEVAL_STARTED'
  | 'RETRIEVAL_COMPLETED' | 'KNOWLEDGE_BASE_ASSIGNMENT' | 'KNOWLEDGE_SOURCE_ELIGIBILITY' | 'RETRIEVAL_QUERY_PLANNING' | 'SOURCE_INDEX_READINESS' | 'LEXICAL_RETRIEVAL' | 'SEMANTIC_RETRIEVAL' | 'HYBRID_RANKING' | 'CANDIDATE_FILTERING' | 'EVIDENCE_SELECTED' | 'EVIDENCE_REVALIDATED' | 'LLM_CONTEXT_ASSEMBLED'
  | 'PROVIDER_REQUEST_STARTED' | 'PROVIDER_RESPONSE_RECEIVED' | 'CITATION_RECOVERY' | 'GROUNDING_VALIDATED' | 'RESPONSE_PERSISTED';

/** Server-created identity after membership and assistant scope checks. */
export type AuthorizedConversationContext = Readonly<{
  requestId: string;
  organizationId: string;
  assistantId: string;
  userId: string;
  channel: ConversationChannel;
  sessionId?: string;
  clientTurnId: string;
  message: string;
  /** Monotonic process deadline, never accepted from the HTTP client. */
  requestDeadline: number;
  signal?: AbortSignal;
  /** Present only for explicitly enabled, authenticated Playground diagnostics. */
  diagnostics?: PlaygroundTraceRecorder;
}>;

export type ConversationStageFailure = Readonly<{
  ok: false;
  outcome: 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
  errorCategory: ConversationErrorCode;
  retryable: boolean;
}>;
export type ConversationStageResult<T> = Readonly<{ ok: true; value: T }> | ConversationStageFailure;
export type ConversationStageContract<TInput, TOutput> = Readonly<{
  input: TInput;
  output: TOutput;
  result: ConversationStageResult<TOutput>;
}>;

export type ConversationAssistantContext = Readonly<{
  id: string;
  organizationId: string;
  provider: ConversationProvider;
  model: string;
  providerMode: 'MANUAL' | 'AUTO_FALLBACK';
}>;
export type ConversationAssistantRecord = Readonly<{
  id: string; organizationId: string; createdById: string | null; name: string; description: string | null;
  providerMode: string | null; providerFallbacks: unknown;
  businessPurpose: string | null; systemInstructions: string | null; defaultLanguage: string | null;
  responseTone: string | null; responseStyle: string | null; fallbackMessage: string | null; greetingMessage: string | null;
  escalationMessage: string | null; status: string; updatedAt?: Date;
  organization?: Readonly<{ name: string }> | null;
}>;
export type PlaygroundTurnReplay = Readonly<{
  sessionId: string; messageId: string; createdAt: string; reply: string;
  sources: readonly Readonly<{ reference: string; title: string; type: string; locator: string | null }>[];
  retrievalMode: string; responseLanguage: string; responseType: string; answerOrigin: string;
  provenance?: ResponseProvenance;
  providerUsed?: ConversationProvider; modelUsed?: string;
  /** Persisted token metrics are partial when totalTokens is unavailable. */
  usage?: ConversationUsage;
  fallbackReason?: 'no_relevant_match' | 'uncited_or_invalid_reference';
  deliveryStatus?: 'SAFE_ANSWER_DELIVERED' | 'FACTUAL_VERIFICATION_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'INTERNAL_EXECUTION_FAILURE';
}>;
export type ConversationSessionResolution = Readonly<{ kind: 'active'; session: PlaygroundConversationHandle } | { kind: 'replay'; response: PlaygroundTurnReplay }>;
export type ConversationProviderSelection = Readonly<{
  primary: ProviderRoute;
  approvedFallbacks: readonly ProviderRoute[];
  mode: 'MANUAL' | 'AUTO_FALLBACK';
}>;
export type ConversationSourceAuthority = 'SHOPIFY_API_POLICY' | 'SHOPIFY_API_POLICY_STALE' | 'PUBLIC_WEBSITE' | 'MERCHANT_KNOWLEDGE';
export type ConversationKnowledgeResult = Readonly<{
  mode: string;
  audience: 'PUBLIC_VISITOR' | 'INTERNAL_MANAGER_PREVIEW';
  eligibleSourceCount: number;
  semanticUnavailableCode?: string;
  diagnostics?: Readonly<{ assignedSourceCount: number; rejectedSourceCount: number; rejectionReasons: readonly Readonly<{ reason: string; count: number }>[]; indexReadySourceCount: number; activeIndexChunkCount: number; indexReadinessDurationMs: number; sourceIndexStates: readonly Readonly<{ sourceId: string; sourceVersion: number; activeGeneration: number | null; processingStatus: string; ready: boolean }>[]; queryVariantCount: number; lexicalCandidateCount: number; semanticCandidateCount: number; rankedCandidateCount: number; selectedEvidenceCount: number; lexicalDurationMs: number; semanticDurationMs: number; rankingDurationMs: number; methodsAttempted: readonly string[]; retrievalReason?: string }>;
  results: readonly Readonly<{ chunkId: string; sourceId: string; sourceVersion: number; generation: number; pageId: string | null; rankingPosition?: number; contentHash: string; content: string; sourceTitle: string; sourceType: string; locator?: string | null; pageUrl?: string | null; pageTitle?: string | null; pageCategory?: string | null; languageHint?: string | null; sourceAuthority?: 'SHOPIFY_API_POLICY' | 'SHOPIFY_API_POLICY_STALE' | 'PUBLIC_WEBSITE' | 'MERCHANT_KNOWLEDGE'; sourceDataAt?: Date | string | null; pageFetchedAt?: Date | string | null; dataCompleteness: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN'; score: number; method: string }>[];
}>;
export type ConversationEvidence = Readonly<{ reference: string; chunkId: string; sourceId: string; sourceVersion: number; contentHash: string; pageId?: string | null; indexGeneration?: number; title: string; type: string; excerpt: string; locator: string | null; retrievalScore?: number; retrievalReason?: string; dataCompleteness?: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN'; sourceAuthority?: ConversationSourceAuthority; pageCategory?: string | null; languageHint?: string | null; sourceDataAt?: Date | string | null; pageFetchedAt?: Date | string | null }>;
export type ConversationVerification = Readonly<{ accepted: boolean; citedReferences: readonly string[]; reason: 'valid_references' | 'missing_reference' | 'unknown_reference' | 'missing_conflict_sources' | 'unsupported_numeric_claim' | 'unsupported_url' | 'unsupported_merchant_fact' | 'unsupported_structured_product_fact' | 'evidence_authorization_changed' | 'retry_generation_failed'; unsupportedClaimCount?: number; verifiedFactCount?: number }>;
export type PersistedTurn = Readonly<{ id: string; createdAt: Date }>;

/** Inputs and outputs for the ten implemented turn stages; trust remains explicit at every boundary. */
export interface ConversationStageContracts {
  SECURITY_CONTEXT: ConversationStageContract<Readonly<{ userId: string; workspaceSlug: string; assistantId: string; requestId: string; request: PlaygroundTurnRequest }>, Readonly<{ authorized: AuthorizedConversationContext; assistant: ConversationAssistantRecord }>>;
  SESSION_RESOLUTION: ConversationStageContract<Readonly<{ authorized: AuthorizedConversationContext; requestedSessionId?: string }>, ConversationSessionResolution>;
  CONVERSATION_CONTEXT: ConversationStageContract<Readonly<{ authorized: AuthorizedConversationContext; session: PlaygroundConversationHandle }>, readonly PlaygroundTurn[]>;
  PROVIDER_SELECTION: ConversationStageContract<Readonly<{ authorized: AuthorizedConversationContext; assistant: Readonly<{ mode: string | null; fallbacks: unknown }> }>, ConversationProviderSelection>;
  INTENT_INTERPRETATION: ConversationStageContract<Readonly<{ authorized: AuthorizedConversationContext; turns: readonly PlaygroundTurn[]; sourceLanguages: readonly string[] }>, Readonly<{ value: QueryInterpretation | null; reason: string; semanticValidationReason?: string; semanticValidationDetail?: string }>>;
  KNOWLEDGE_RETRIEVAL: ConversationStageContract<Readonly<{ authorized: AuthorizedConversationContext; workspaceSlug: string; queries: readonly string[] }>, ConversationKnowledgeResult>;
  EVIDENCE_SELECTION: ConversationStageContract<Readonly<{ authorized: AuthorizedConversationContext; retrieval: ConversationKnowledgeResult }>, readonly ConversationEvidence[]>;
  ANSWER_GENERATION: ConversationStageContract<Readonly<{ authorized: AuthorizedConversationContext; assistant: ConversationAssistantContext; selection: ConversationProviderSelection; activeRoute: ProviderRoute; messages: ConversationProviderMessage[]; maxCompletionTokens: number }>, ConversationProviderResult>;
  RESPONSE_VERIFICATION: ConversationStageContract<Readonly<{ authorized: AuthorizedConversationContext; evidence: readonly ConversationEvidence[]; response: string }>, ConversationVerification>;
  TURN_PERSISTENCE: ConversationStageContract<Readonly<{ authorized: AuthorizedConversationContext; session: PlaygroundConversationHandle; response: string; responseCategory: string; answerOrigin: string; sources: readonly PersistedConversationSource[]; providerUsed: ConversationProvider | null; modelUsed: string | null; usage?: ConversationUsage }>, PersistedTurn>;
}
export type PersistedConversationSource = Readonly<{ [key: string]: string | number | null | undefined; reference: string; title: string; type: string; locator: string | null; chunkId: string; sourceId: string; sourceVersion?: number; contentHash: string; cited: 'true' | 'false'; sourceAuthority?: ConversationSourceAuthority }>;

export type ConversationStageEvent = Readonly<{
  requestId: string;
  organizationId: string | null;
  assistantId: string;
  channel: ConversationChannel;
  stage: ConversationLifecycleStage;
  outcome: 'STARTED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT' | 'SKIPPED';
  durationMs: number;
  errorCategory?: ConversationErrorCode;
  reason?: string;
  provider?: ConversationProvider;
  model?: string;
  resultCount?: number;
  evidenceCount?: number;
  purpose?: 'intent_interpretation' | 'answer_generation' | 'tool_followup' | 'citation_recovery' | 'provider_compatibility_retry';
  callIndex?: number;
  requestDispatched?: boolean;
  retryReason?: 'approved_provider_fallback' | 'provider_rejected_json_mode' | 'tool_protocol_compatibility' | 'citation_validation_rejected';
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}>;

/** Safe categories only; messages, prompts, evidence, headers, and credentials are excluded. */
export type ConversationErrorCode =
  | 'VALIDATION_ERROR' | 'AUTHENTICATION_REQUIRED' | 'AUTHORIZATION_DENIED' | 'SESSION_NOT_FOUND' | 'SESSION_EXPIRED' | 'RATE_LIMITED'
  | 'PROVIDER_AUTH_FAILURE' | 'PROVIDER_RATE_LIMIT' | 'PROVIDER_TIMEOUT' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_INVALID_RESPONSE' | 'PROVIDER_OUTPUT_TRUNCATED' | 'PROVIDER_EMPTY_RESPONSE'
  | 'KNOWLEDGE_NOT_CONFIGURED' | 'KNOWLEDGE_NO_MATCH' | 'EVIDENCE_INSUFFICIENT' | 'CITATION_INVALID'
  | 'REQUEST_CANCELLED' | 'DEADLINE_EXCEEDED' | 'INTERNAL_ERROR';
