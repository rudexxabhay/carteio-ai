import type { AuthorizedConversationContext, ConversationAssistantRecord } from './conversation.contracts';

/** Phase 09D foundation contracts. These decisions describe eligibility; they never grant access. */
export const INTELLIGENCE_LAYERS = [
  { id: 1, name: 'INPUT_SECURITY_GUARD', status: 'ACTIVE' },
  { id: 2, name: 'LANGUAGE_DETECTION', status: 'ACTIVE', coverage: 'One shared model interpretation emits language, script, mix and uncertainty signals; quality is not independently benchmarked.' },
  { id: 3, name: 'SLANG_SHORTHAND_INTERPRETATION', status: 'ACTIVE', coverage: 'Shared provider reasoning over bounded context; generalization quality is unmeasured and no slang dictionary is authoritative.' },
  { id: 4, name: 'TYPO_TOLERANCE', status: 'ACTIVE', coverage: 'Shared model interpretation may tolerate ordinary typos; identifiers are exact-span validated and never fuzzy-corrected.' },
  { id: 5, name: 'CODE_SWITCHING_UNDERSTANDING', status: 'ACTIVE', coverage: 'Validated mixed-language signals feed query and response generation; cross-lingual quality is not independently measured.' },
  { id: 6, name: 'SEMANTIC_INTENT_DETECTION', status: 'ACTIVE', coverage: 'Schema-validated generic candidate intents plus deterministic route guards; intent never enables capabilities or sources.' },
  { id: 7, name: 'ENTITY_SLOT_EXTRACTION', status: 'ACTIVE', coverage: 'Typed raw spans accepted only when exact text occurs in the current user message.' },
  { id: 8, name: 'CONVERSATION_MEMORY_CONTEXT', status: 'ACTIVE', coverage: 'Uses server-authorized, byte- and turn-bounded session history; no cross-session memory or durable summaries.' },
  { id: 9, name: 'REFERENCE_COREFERENCE_RESOLUTION', status: 'ACTIVE', coverage: 'Validated model turn offsets and deterministic fallback resolve only same-session bounded user turns. Missing, truncated, unsafe, ambiguous and non-reference states are distinguished. Prior assistant text is never evidence.' },
  { id: 10, name: 'BUSINESS_SCOPE_GUARD', status: 'ACTIVE', coverage: 'Combines server-resolved business context with advisory scope assessment. Mixed requests proceed only when both exact spans validate; otherwise safe handoff. Scope cannot grant capabilities.' },
  { id: 11, name: 'TRUSTED_SOURCE_SELECTION', status: 'ACTIVE', coverage: 'Runtime route planning distinguishes static, personal-live, mixed and ambiguous needs; current authorized Knowledge retrieval is revalidated, while no live business connector is registered.' },
  { id: 12, name: 'EVIDENCE_GROUNDING_VALIDATION', status: 'ACTIVE', coverage: 'Revalidates authorized evidence and citation identifiers; detects selected high-risk personal/live claims and retains server-owned limitations. Citations do not prove entailment, and universal factual verification is not implemented.' },
  { id: 13, name: 'AMBIGUITY_CLARIFICATION_GUARD', status: 'ACTIVE', coverage: 'Clarification decisions use resolved references and bounded session history. Natural wording reuses the configured provider route with deterministic fallback; no durable pending state.' },
  { id: 14, name: 'NATURAL_RESPONSE_LANGUAGE_CONTROL', status: 'ACTIVE', coverage: 'Grounded and clarification wording use the existing configured provider and explicit/current language signals; narrow social greetings may use deterministic safety fallbacks.' },
  { id: 15, name: 'REPETITION_CONTRADICTION_PROTECTION', status: 'ACTIVE', coverage: 'Shared interpretation distinguishes repeat/detail/simplification/language-switch/correction/contradiction; exact duplicate detection is deterministic and advisory. Model signals can cause clarification but never actions.' },
  { id: 16, name: 'QUALITY_DIAGNOSTICS_EVALUATION', status: 'FOUNDATION_ONLY' },
] as const;

export type CapabilityCategory = 'GENERAL_BUSINESS_INFORMATION' | 'KNOWLEDGE_QA' | 'ORDER_TRACKING' | 'SHIPMENT_TRACKING' | 'BOOKING_STATUS' | 'PRODUCT_DISCOVERY' | 'APPOINTMENT_INFORMATION' | 'ACCOUNT_SUPPORT' | 'BILLING_INFORMATION';
export type CapabilitySupport = 'STATIC_KNOWLEDGE' | 'AUTHORIZED_CONNECTED_API' | 'STATIC_KNOWLEDGE_AND_API' | 'CONFIGURED_UNAVAILABLE' | 'UNSUPPORTED';
export type CapabilityStatus = 'KNOWLEDGE_SUPPORTED' | 'LIVE_API_SUPPORTED' | 'KNOWLEDGE_AND_API_SUPPORTED' | 'CONFIGURED_BUT_UNAVAILABLE' | 'UNSUPPORTED' | 'UNKNOWN';
export type BusinessCapability = Readonly<{
  category: CapabilityCategory; support: CapabilitySupport; status: CapabilityStatus;
  capabilityExplicitlyConfigured: false; assistantAuthorizationVerified: boolean;
  eligibleKnowledgeSourceCount: number;
  liveApi: Readonly<{ configured: false; assistantAuthorized: false; connected: false }>;
  reason: 'EXISTING_PUBLIC_KNOWLEDGE' | 'NO_CAPABILITY_CONFIGURATION' | 'LIVE_API_UNAVAILABLE' | 'UNSUPPORTED_BY_CONFIGURATION';
}>;
export type CapabilityRegistry = Readonly<{
  organizationId: string; assistantId: string; assistantAuthorizationVerified: boolean;
  liveApiConfigured: false; capabilities: readonly BusinessCapability[];
}>;

export type IntelligenceContext = Readonly<{
  workspaceId: string;
  assistantId: string;
  executionBoundary: 'AUTHENTICATED_OWNER' | 'PUBLIC_VISITOR';
  conversationId?: string;
  currentMessage: string;
  previousContextReferences: readonly string[];
  businessConfiguration: Readonly<{ purpose: string | null; defaultLanguage: string | null; tone: string | null }>;
  capabilities: CapabilityRegistry;
  allowedSourceTypes: readonly ['PUBLIC_REFERENCE'];
  trustedSourceEligible: boolean;
  providerPolicy: Readonly<{ mode: 'MANUAL' | 'AUTO_FALLBACK' }>;
  correlationId: string;
}>;

export function buildIntelligenceContext(input: {
  authorized: AuthorizedConversationContext; assistant: ConversationAssistantRecord; eligiblePublicKnowledgeCount: number;
  previousContextReferences?: readonly string[]; claimedIdentity?: unknown;
}): IntelligenceContext {
  const { authorized, assistant } = input;
  const registry = buildCapabilityRegistry(authorized.organizationId, authorized.assistantId, assistant.businessPurpose, input.eligiblePublicKnowledgeCount, true);
  return Object.freeze({
    workspaceId: authorized.organizationId, assistantId: authorized.assistantId,
    executionBoundary: authorized.channel === 'PLAYGROUND' ? 'AUTHENTICATED_OWNER' : 'PUBLIC_VISITOR',
    ...(authorized.sessionId ? { conversationId: authorized.sessionId } : {}), currentMessage: authorized.message,
    previousContextReferences: Object.freeze([...(input.previousContextReferences ?? [])]),
    businessConfiguration: Object.freeze({ purpose: assistant.businessPurpose, defaultLanguage: assistant.defaultLanguage, tone: assistant.responseTone }),
    capabilities: registry, allowedSourceTypes: ['PUBLIC_REFERENCE'] as const, trustedSourceEligible: input.eligiblePublicKnowledgeCount > 0,
    providerPolicy: Object.freeze({ mode: assistant.providerMode === 'AUTO_FALLBACK' ? 'AUTO_FALLBACK' : 'MANUAL' }), correlationId: authorized.requestId,
  });
}

const capabilityCategories: readonly CapabilityCategory[] = ['GENERAL_BUSINESS_INFORMATION', 'KNOWLEDGE_QA', 'ORDER_TRACKING', 'SHIPMENT_TRACKING', 'BOOKING_STATUS', 'PRODUCT_DISCOVERY', 'APPOINTMENT_INFORMATION', 'ACCOUNT_SUPPORT', 'BILLING_INFORMATION'];
export function buildCapabilityRegistry(organizationId: string, assistantId: string, businessPurpose: string | null, eligiblePublicKnowledgeCount: number, assistantAuthorizationVerified = false): CapabilityRegistry {
  const knowledge = Number.isSafeInteger(eligiblePublicKnowledgeCount) && eligiblePublicKnowledgeCount > 0;
  return Object.freeze({ organizationId, assistantId, assistantAuthorizationVerified, liveApiConfigured: false as const, capabilities: Object.freeze(capabilityCategories.map((category): BusinessCapability => {
    let support: CapabilitySupport;
    let status: CapabilityStatus;
    let reason: BusinessCapability['reason'];
    if (knowledge) {
      support = 'STATIC_KNOWLEDGE'; status = 'KNOWLEDGE_SUPPORTED';
      reason = category === 'GENERAL_BUSINESS_INFORMATION' || category === 'KNOWLEDGE_QA' ? 'EXISTING_PUBLIC_KNOWLEDGE' : 'LIVE_API_UNAVAILABLE';
    } else if (category === 'GENERAL_BUSINESS_INFORMATION' || category === 'KNOWLEDGE_QA') {
      support = businessPurpose?.trim() ? 'CONFIGURED_UNAVAILABLE' : 'UNSUPPORTED';
      // Assistant business purpose describes the domain; it is not a persisted
      // capability grant. Without linked eligible sources the state is unknown.
      status = 'UNKNOWN';
      reason = businessPurpose?.trim() ? 'NO_CAPABILITY_CONFIGURATION' : 'UNSUPPORTED_BY_CONFIGURATION';
    } else {
      support = 'UNSUPPORTED'; status = 'UNSUPPORTED'; reason = 'LIVE_API_UNAVAILABLE';
    }
    return Object.freeze({ category, support, status, capabilityExplicitlyConfigured: false, assistantAuthorizationVerified,
      eligibleKnowledgeSourceCount: knowledge ? eligiblePublicKnowledgeCount : 0,
      liveApi: Object.freeze({ configured: false as const, assistantAuthorized: false as const, connected: false as const }), reason });
  })) });
}

export type Interpretation = Readonly<{ language: Readonly<{ primary: string | null; mixed: boolean; signals: readonly string[] }>; intent: CapabilityCategory | 'GREETING' | 'FOLLOW_UP' | 'UNKNOWN' | 'AMBIGUOUS'; candidateCapabilities: readonly CapabilityCategory[]; entities: Readonly<Record<string, string>>; uncertainty: 'NONE' | 'AMBIGUOUS' | 'UNKNOWN'; clarificationRequired: boolean; scope: 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'UNKNOWN'; reasonCodes: readonly string[] }>;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export function validateInterpretation(value: unknown): Interpretation | null {
  if (!isRecord(value) || !isRecord(value.language) || !Array.isArray(value.candidateCapabilities) || !isRecord(value.entities) || !Array.isArray(value.reasonCodes)) return null;
  const language = value.language;
  if (!(language.primary === null || (typeof language.primary === 'string' && language.primary.length <= 80)) || typeof language.mixed !== 'boolean' || !Array.isArray(language.signals) || !language.signals.every((x) => typeof x === 'string' && x.length <= 80)) return null;
  if (!value.candidateCapabilities.every((x) => capabilityCategories.includes(x as CapabilityCategory)) || Object.values(value.entities).some((x) => typeof x !== 'string' || x.length > 200)) return null;
  if (!value.reasonCodes.every((x) => typeof x === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(x))) return null;
  if (!['GREETING', 'FOLLOW_UP', 'UNKNOWN', 'AMBIGUOUS', ...capabilityCategories].includes(value.intent as string) || !['NONE', 'AMBIGUOUS', 'UNKNOWN'].includes(value.uncertainty as string) || typeof value.clarificationRequired !== 'boolean' || !['IN_SCOPE', 'OUT_OF_SCOPE', 'UNKNOWN'].includes(value.scope as string)) return null;
  return Object.freeze({ language: Object.freeze({ primary: language.primary as string | null, mixed: language.mixed, signals: Object.freeze([...language.signals] as string[]) }), intent: value.intent as Interpretation['intent'], candidateCapabilities: Object.freeze([...value.candidateCapabilities] as CapabilityCategory[]), entities: Object.freeze({ ...(value.entities as Record<string, string>) }), uncertainty: value.uncertainty as Interpretation['uncertainty'], clarificationRequired: value.clarificationRequired, scope: value.scope as Interpretation['scope'], reasonCodes: Object.freeze([...value.reasonCodes] as string[]) });
}

export type SourceDecision = Readonly<{ outcome: 'TRUSTED_KNOWLEDGE' | 'AUTHORIZED_LIVE_API' | 'TRUSTED_KNOWLEDGE_AND_API' | 'CLARIFICATION_REQUIRED' | 'UNSUPPORTED_CAPABILITY' | 'NO_AUTHORIZED_SOURCE'; reason: string }>;
export function decideSource(capability: BusinessCapability | undefined, eligibleKnowledgeCount: number, liveApiAvailable = false): SourceDecision {
  if (!capability || capability.support === 'UNSUPPORTED') return { outcome: 'UNSUPPORTED_CAPABILITY', reason: 'CAPABILITY_UNSUPPORTED' };
  if (capability.support === 'CONFIGURED_UNAVAILABLE') return { outcome: 'NO_AUTHORIZED_SOURCE', reason: 'CAPABILITY_CONFIGURED_BUT_UNAVAILABLE' };
  const knowledge = eligibleKnowledgeCount > 0 && (capability.support === 'STATIC_KNOWLEDGE' || capability.support === 'STATIC_KNOWLEDGE_AND_API');
  const api = liveApiAvailable && (capability.support === 'AUTHORIZED_CONNECTED_API' || capability.support === 'STATIC_KNOWLEDGE_AND_API');
  if (knowledge && api) return { outcome: 'TRUSTED_KNOWLEDGE_AND_API', reason: 'AUTHORIZED_SOURCES_AVAILABLE' };
  if (knowledge) return { outcome: 'TRUSTED_KNOWLEDGE', reason: 'ELIGIBLE_KNOWLEDGE_AVAILABLE' };
  if (api) return { outcome: 'AUTHORIZED_LIVE_API', reason: 'AUTHORIZED_API_AVAILABLE' };
  return { outcome: 'NO_AUTHORIZED_SOURCE', reason: liveApiAvailable ? 'NO_ELIGIBLE_KNOWLEDGE' : 'LIVE_API_UNAVAILABLE' };
}

export type QualityStatus = 'NOT_EVALUATED' | 'INSUFFICIENT_EVIDENCE' | 'ESTIMATED' | 'INDEPENDENTLY_REVIEWED';
export type QualityDiagnostics = Readonly<{ version: string; executionStatus: 'COMPLETED' | 'FAILED'; dimensions: Readonly<Record<string, QualityStatus>>; accuracy: 'NOT_EVALUATED'; accuracyReason: 'INSUFFICIENT_EVIDENCE'; correlationId: string; reviewedSampleCount?: number; reviewedSampleDenominator?: number }>;
export function diagnosticsVisible(role: string, enabled = process.env.CARTEIO_OWNER_DIAGNOSTICS_ENABLED === 'true'): boolean { return enabled && ['OWNER', 'ADMIN'].includes(role.toUpperCase()); }
export function notEvaluatedDiagnostics(correlationId: string): QualityDiagnostics { return Object.freeze({ version: '09D.1', executionStatus: 'COMPLETED', dimensions: Object.freeze({ languageIntent: 'NOT_EVALUATED', scope: 'NOT_EVALUATED', sourceSelection: 'NOT_EVALUATED', evidence: 'INSUFFICIENT_EVIDENCE', grounding: 'NOT_EVALUATED', continuity: 'NOT_EVALUATED', naturalness: 'NOT_EVALUATED', repetition: 'NOT_EVALUATED', safety: 'NOT_EVALUATED' }), accuracy: 'NOT_EVALUATED', accuracyReason: 'INSUFFICIENT_EVIDENCE', correlationId }); }

