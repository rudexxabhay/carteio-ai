import type { BusinessCapability, CapabilityCategory } from './intelligence-foundation';
import type { InformationNeed, MultilingualSemanticInterpretation, SemanticIntent } from './multilingual-semantics';

export type SourceRouteOutcome =
  | 'TRUSTED_KNOWLEDGE'
  | 'AUTHORIZED_LIVE_API'
  | 'TRUSTED_KNOWLEDGE_AND_API'
  | 'CLARIFICATION_REQUIRED'
  | 'UNSUPPORTED_CAPABILITY'
  | 'NO_AUTHORIZED_SOURCE'
  | 'NO_TRUSTED_EVIDENCE'
  | 'TEMPORARILY_UNAVAILABLE';
export type SourceRouteReason =
  | 'STATIC_INFORMATION_REQUESTED'
  | 'PERSONAL_RECORD_REQUIRES_LIVE_CONNECTOR'
  | 'MIXED_REQUEST_LIVE_CONNECTOR_UNAVAILABLE'
  | 'AMBIGUOUS_INFORMATION_NEED'
  | 'UNKNOWN_INTENT_SAFE_KNOWLEDGE_CHECK'
  | 'NO_ELIGIBLE_ASSISTANT_KNOWLEDGE'
  | 'NO_RELEVANT_KNOWLEDGE_EVIDENCE'
  | 'ELIGIBLE_KNOWLEDGE_AVAILABLE'
  | 'LIVE_CONNECTOR_NOT_CONFIGURED'
  | 'LIVE_CONNECTOR_TEMPORARILY_UNAVAILABLE'
  | 'LIVE_CONNECTOR_NOT_EXECUTED'
  | 'AUTHORIZED_LIVE_CONNECTOR_AVAILABLE'
  | 'ASSISTANT_AUTHORIZATION_NOT_VERIFIED';

export type BusinessRequestPlan = Readonly<{
  informationNeed: InformationNeed;
  capability: CapabilityCategory;
  requiresKnowledge: boolean;
  requiresLiveApi: boolean;
  clarificationRequired: boolean;
  reason: SourceRouteReason;
}>;

export type LiveConnectorReadiness = Readonly<{
  configured: boolean;
  assistantAuthorized: boolean;
  connected: boolean;
  temporarilyUnavailable: boolean;
}>;

export type SourceRouteDecision = Readonly<{
  outcome: SourceRouteOutcome;
  reason: SourceRouteReason;
  capability: CapabilityCategory;
  knowledgeEligibleSourceCount: number;
  evidenceCount: number;
  liveConnector: LiveConnectorReadiness;
  partialResultAllowed: boolean;
  missingRequirements: readonly ('KNOWLEDGE_EVIDENCE' | 'AUTHORIZED_LIVE_API' | 'CLARIFICATION')[];
}>;

/** Future adapters must be server configured and receive only a server authorized request. */
export type AuthorizedBusinessDataConnector<Request, Result> = Readonly<{
  capability: CapabilityCategory;
  execute(input: Readonly<{ organizationId: string; assistantId: string; userId: string; request: Request; signal?: AbortSignal }>): Promise<Result>;
}>;

const staticIntents = new Set<SemanticIntent>([
  'BUSINESS_INFORMATION', 'KNOWLEDGE_QUESTION', 'PRODUCT_INQUIRY', 'PRICING_INQUIRY', 'AVAILABILITY_INQUIRY',
]);
const isSafeIntentPolarity = (semantic: MultilingualSemanticInterpretation) => semantic.intents.every((intent) =>
  intent.polarity === 'AFFIRMATIVE' || intent.polarity === 'NOT_APPLICABLE' || intent.polarity === 'NEGATED');

function capabilityForIntent(intents: readonly SemanticIntent[]): CapabilityCategory {
  if (intents.includes('STATUS_INQUIRY')) return 'ORDER_TRACKING';
  if (intents.includes('BOOKING_INQUIRY') || intents.includes('APPOINTMENT_INFORMATION')) return 'APPOINTMENT_INFORMATION';
  if (intents.includes('PAYMENT_INQUIRY') || intents.includes('REFUND_INQUIRY')) return 'BILLING_INFORMATION';
  return 'KNOWLEDGE_QA';
}

/**
 * Plans a source class from validated semantic labels. This makes no access
 * decision and cannot authorize a connector. Missing/new fields fail safely.
 */
export function planBusinessRequest(semantic: MultilingualSemanticInterpretation | null, legacyIntent?: string): BusinessRequestPlan {
  const intents = semantic?.intents.filter((item) => item.polarity !== 'NEGATED').map((item) => item.category) ?? [];
  const capability = capabilityForIntent(intents);
  const explicit = semantic?.informationNeed ?? 'UNKNOWN';
  if (!semantic) return { informationNeed: 'UNKNOWN', capability, requiresKnowledge: true, requiresLiveApi: false, clarificationRequired: false, reason: 'UNKNOWN_INTENT_SAFE_KNOWLEDGE_CHECK' };
  if (explicit === 'AMBIGUOUS' || semantic.uncertainty === 'AMBIGUOUS' || (semantic.clarificationRequired && semantic.uncertainty !== 'UNKNOWN')
    || (!isSafeIntentPolarity(semantic) && (explicit === 'PERSONAL_LIVE_RECORD' || explicit === 'MIXED_STATIC_AND_PERSONAL'))) {
    return { informationNeed: 'AMBIGUOUS', capability, requiresKnowledge: false, requiresLiveApi: false, clarificationRequired: true, reason: 'AMBIGUOUS_INFORMATION_NEED' };
  }

  let informationNeed = explicit;
  // A current-status intent is a deterministic live-record boundary. A
  // semantic label cannot downgrade that request into a static FAQ route.
  // When the same interpretation also identifies a public-information need,
  // retain both needs so the public portion can be answered separately.
  const hasCurrentStatusIntent = intents.includes('STATUS_INQUIRY');
  const hasStaticInformationIntent = intents.some((intent) => staticIntents.has(intent));
  if (hasCurrentStatusIntent && explicit !== 'MIXED_STATIC_AND_PERSONAL') {
    // Preserve an explicit public-information need even when the semantic
    // intent list only labels the request as a status inquiry. Route both
    // needs: Knowledge may answer only its verified public portion, while the
    // live-record requirement remains enforced independently.
    informationNeed = hasStaticInformationIntent || explicit === 'STATIC_BUSINESS_INFORMATION'
      ? 'MIXED_STATIC_AND_PERSONAL'
      : 'PERSONAL_LIVE_RECORD';
  }
  if (informationNeed === 'UNKNOWN') {
    if (intents.includes('STATUS_INQUIRY') || intents.includes('BOOKING_INQUIRY') || intents.includes('APPOINTMENT_INFORMATION')) informationNeed = 'PERSONAL_LIVE_RECORD';
    else if (intents.includes('PAYMENT_INQUIRY') || intents.includes('REFUND_INQUIRY')) return { informationNeed: 'AMBIGUOUS', capability, requiresKnowledge: false, requiresLiveApi: false, clarificationRequired: true, reason: 'AMBIGUOUS_INFORMATION_NEED' };
    else if (intents.some((intent) => staticIntents.has(intent)) || legacyIntent === 'business' || legacyIntent === 'capability') informationNeed = 'STATIC_BUSINESS_INFORMATION';
    else informationNeed = 'UNKNOWN';
  }
  if (informationNeed === 'PERSONAL_LIVE_RECORD') return { informationNeed, capability, requiresKnowledge: false, requiresLiveApi: true, clarificationRequired: false, reason: 'PERSONAL_RECORD_REQUIRES_LIVE_CONNECTOR' };
  if (informationNeed === 'MIXED_STATIC_AND_PERSONAL') return { informationNeed, capability, requiresKnowledge: true, requiresLiveApi: true, clarificationRequired: false, reason: 'MIXED_REQUEST_LIVE_CONNECTOR_UNAVAILABLE' };
  if (informationNeed === 'STATIC_BUSINESS_INFORMATION') return { informationNeed, capability, requiresKnowledge: true, requiresLiveApi: false, clarificationRequired: false, reason: 'STATIC_INFORMATION_REQUESTED' };
  // For new or absent semantic labels, preserve bounded Knowledge behavior.
  return { informationNeed: 'UNKNOWN', capability, requiresKnowledge: true, requiresLiveApi: false, clarificationRequired: false, reason: 'UNKNOWN_INTENT_SAFE_KNOWLEDGE_CHECK' };
}

/** Resolves source availability after Knowledge search; eligible source count is not evidence sufficiency. */
export function decideBusinessSourceRoute(
  plan: BusinessRequestPlan,
  input: Readonly<{ knowledgeEligibleSourceCount: number; evidenceCount: number; liveConnector: LiveConnectorReadiness; capability?: BusinessCapability; assistantAuthorizationVerified: boolean; liveDataExecuted?: boolean; liveEvidenceValidated?: boolean }>,
): SourceRouteDecision {
  const eligible = Number.isSafeInteger(input.knowledgeEligibleSourceCount) && input.knowledgeEligibleSourceCount > 0 ? input.knowledgeEligibleSourceCount : 0;
  const evidence = Number.isSafeInteger(input.evidenceCount) && input.evidenceCount > 0 ? input.evidenceCount : 0;
  const live = input.liveConnector;
  const missingRequirements: Array<'KNOWLEDGE_EVIDENCE' | 'AUTHORIZED_LIVE_API' | 'CLARIFICATION'> = [];

  if (!input.assistantAuthorizationVerified || !input.capability?.assistantAuthorizationVerified) return { outcome: 'NO_AUTHORIZED_SOURCE', reason: 'ASSISTANT_AUTHORIZATION_NOT_VERIFIED', capability: plan.capability, knowledgeEligibleSourceCount: eligible, evidenceCount: evidence, liveConnector: live, partialResultAllowed: false, missingRequirements: ['KNOWLEDGE_EVIDENCE', ...(plan.requiresLiveApi ? ['AUTHORIZED_LIVE_API' as const] : [])] };

  if (plan.clarificationRequired) return { outcome: 'CLARIFICATION_REQUIRED', reason: 'AMBIGUOUS_INFORMATION_NEED', capability: plan.capability, knowledgeEligibleSourceCount: eligible, evidenceCount: evidence, liveConnector: live, partialResultAllowed: false, missingRequirements: ['CLARIFICATION'] };
  const canExecuteLive = live.configured && live.assistantAuthorized && live.connected && !live.temporarilyUnavailable;
  if (plan.requiresLiveApi && live.temporarilyUnavailable && live.configured && live.assistantAuthorized) {
    return { outcome: 'TEMPORARILY_UNAVAILABLE', reason: 'LIVE_CONNECTOR_TEMPORARILY_UNAVAILABLE', capability: plan.capability, knowledgeEligibleSourceCount: eligible, evidenceCount: evidence, liveConnector: live, partialResultAllowed: plan.requiresKnowledge && evidence > 0, missingRequirements: [...(plan.requiresKnowledge && evidence === 0 ? ['KNOWLEDGE_EVIDENCE' as const] : []), 'AUTHORIZED_LIVE_API'] };
  }
  if (plan.requiresLiveApi && !canExecuteLive) {
    if (plan.requiresKnowledge) {
      missingRequirements.push('AUTHORIZED_LIVE_API');
      if (evidence === 0) missingRequirements.push('KNOWLEDGE_EVIDENCE');
      return {
        outcome: eligible && evidence ? 'TRUSTED_KNOWLEDGE' : eligible ? 'NO_TRUSTED_EVIDENCE' : 'NO_AUTHORIZED_SOURCE',
        reason: 'MIXED_REQUEST_LIVE_CONNECTOR_UNAVAILABLE', capability: plan.capability,
        knowledgeEligibleSourceCount: eligible, evidenceCount: evidence, liveConnector: live,
        partialResultAllowed: evidence > 0, missingRequirements,
      };
    }
    return { outcome: 'UNSUPPORTED_CAPABILITY', reason: 'LIVE_CONNECTOR_NOT_CONFIGURED', capability: plan.capability, knowledgeEligibleSourceCount: eligible, evidenceCount: evidence, liveConnector: live, partialResultAllowed: false, missingRequirements: ['AUTHORIZED_LIVE_API'] };
  }
  if (plan.requiresLiveApi && canExecuteLive) {
    if (input.liveDataExecuted && input.liveEvidenceValidated) {
      if (plan.requiresKnowledge && eligible > 0 && evidence > 0) return { outcome: 'TRUSTED_KNOWLEDGE_AND_API', reason: 'AUTHORIZED_LIVE_CONNECTOR_AVAILABLE', capability: plan.capability, knowledgeEligibleSourceCount: eligible, evidenceCount: evidence, liveConnector: live, partialResultAllowed: false, missingRequirements: [] };
      if (plan.requiresKnowledge) return { outcome: 'AUTHORIZED_LIVE_API', reason: 'AUTHORIZED_LIVE_CONNECTOR_AVAILABLE', capability: plan.capability, knowledgeEligibleSourceCount: eligible, evidenceCount: evidence, liveConnector: live, partialResultAllowed: true, missingRequirements: ['KNOWLEDGE_EVIDENCE'] };
      return { outcome: 'AUTHORIZED_LIVE_API', reason: 'AUTHORIZED_LIVE_CONNECTOR_AVAILABLE', capability: plan.capability, knowledgeEligibleSourceCount: eligible, evidenceCount: evidence, liveConnector: live, partialResultAllowed: false, missingRequirements: [] };
    }
    return { outcome: 'NO_AUTHORIZED_SOURCE', reason: 'LIVE_CONNECTOR_NOT_EXECUTED', capability: plan.capability, knowledgeEligibleSourceCount: eligible, evidenceCount: evidence, liveConnector: live, partialResultAllowed: false, missingRequirements: ['AUTHORIZED_LIVE_API'] };
  }
  if (!plan.requiresKnowledge) return { outcome: 'NO_AUTHORIZED_SOURCE', reason: 'NO_ELIGIBLE_ASSISTANT_KNOWLEDGE', capability: plan.capability, knowledgeEligibleSourceCount: eligible, evidenceCount: evidence, liveConnector: live, partialResultAllowed: false, missingRequirements: ['KNOWLEDGE_EVIDENCE'] };
  if (!eligible) return { outcome: 'NO_AUTHORIZED_SOURCE', reason: 'NO_ELIGIBLE_ASSISTANT_KNOWLEDGE', capability: plan.capability, knowledgeEligibleSourceCount: 0, evidenceCount: 0, liveConnector: live, partialResultAllowed: false, missingRequirements: ['KNOWLEDGE_EVIDENCE'] };
  if (!evidence) return { outcome: 'NO_TRUSTED_EVIDENCE', reason: 'NO_RELEVANT_KNOWLEDGE_EVIDENCE', capability: plan.capability, knowledgeEligibleSourceCount: eligible, evidenceCount: 0, liveConnector: live, partialResultAllowed: false, missingRequirements: ['KNOWLEDGE_EVIDENCE'] };
  return { outcome: 'TRUSTED_KNOWLEDGE', reason: 'ELIGIBLE_KNOWLEDGE_AVAILABLE', capability: plan.capability, knowledgeEligibleSourceCount: eligible, evidenceCount: evidence, liveConnector: live, partialResultAllowed: false, missingRequirements: [] };
}

/** No customer-specific live-record connector is currently registered. Catalog tools are authorized separately. */
export const noLiveBusinessConnector: LiveConnectorReadiness = Object.freeze({ configured: false, assistantAuthorized: false, connected: false, temporarilyUnavailable: false });

/** Minimal security refusal used only after answer validation detects a false personal-record claim. */
export function personalStatusSafetyRefusal(need: InformationNeed, language: 'English' | 'Hindi' | 'Hinglish' | null): string {
  const isMixed = need === 'MIXED_STATIC_AND_PERSONAL';
  if (language === 'Hindi') return isMixed
    ? 'मैं सामान्य नीति बता सकता हूँ, लेकिन यहाँ आपकी व्यक्तिगत स्थिति नहीं देख सकता। उसके लिए व्यवसाय के सुरक्षित सहायता माध्यम का उपयोग करें।'
    : 'मैं यहाँ व्यक्तिगत रिकॉर्ड या मौजूदा स्थिति नहीं देख सकता। कृपया व्यवसाय के सुरक्षित सहायता माध्यम का उपयोग करें।';
  if (language === 'Hinglish') return isMixed
    ? 'Main general policy bata sakta hoon, lekin yahan aapka personal status nahi dekh sakta. Iske liye business ke secure support channel ka use karein.'
    : 'Main yahan personal record ya current status nahi dekh sakta. Business ke secure support channel ka use karein.';
  return isMixed
    ? 'I can help with the general policy, but I can’t check your personal status here. Please use the business’s secure support channel for that.'
    : 'I can’t check personal records or current status here. Please use the business’s secure support channel.';
}

