import { decideBusinessSourceRoute, noLiveBusinessConnector, planBusinessRequest } from '../src/modules/workspaces/business-source-router';
import { buildCapabilityRegistry } from '../src/modules/workspaces/intelligence-foundation';
import type { MultilingualSemanticInterpretation } from '../src/modules/workspaces/multilingual-semantics';

const interpretation = (informationNeed: MultilingualSemanticInterpretation['informationNeed'], category: MultilingualSemanticInterpretation['intents'][number]['category'] = 'KNOWLEDGE_QUESTION'): MultilingualSemanticInterpretation => ({
  language: { primary: 'English', scripts: ['Latin'], mixed: false, certainty: 'CLEAR', signals: [] },
  responseLanguagePreference: null, socialClassification: 'OTHER', informationNeed, businessScopeAssessment: 'UNKNOWN',
  intents: [{ category, polarity: 'AFFIRMATIVE' }], entities: [], uncertainty: 'NONE', clarificationRequired: false,
});
const verified = (count: number, authorized = true) => buildCapabilityRegistry('org-a', 'assistant-a', 'Customer support', count, authorized);
const route = (need: MultilingualSemanticInterpretation['informationNeed'], category?: MultilingualSemanticInterpretation['intents'][number]['category'], options: { eligible?: number; evidence?: number; authorized?: boolean } = {}) => {
  const plan = planBusinessRequest(interpretation(need, category));
  const capability = verified(options.eligible ?? 0, options.authorized ?? true).capabilities.find((item) => item.category === plan.capability);
  return decideBusinessSourceRoute(plan, { knowledgeEligibleSourceCount: options.eligible ?? 0, evidenceCount: options.evidence ?? 0, liveConnector: noLiveBusinessConnector, capability, assistantAuthorizationVerified: options.authorized ?? true });
};

describe('business capability and source routing', () => {
  it('routes a static policy need to Knowledge and separates eligible sources from relevant evidence', () => {
    expect(planBusinessRequest(interpretation('STATIC_BUSINESS_INFORMATION')).requiresKnowledge).toBe(true);
    expect(route('STATIC_BUSINESS_INFORMATION', 'KNOWLEDGE_QUESTION', { eligible: 2, evidence: 1 })).toMatchObject({ outcome: 'TRUSTED_KNOWLEDGE', partialResultAllowed: false, missingRequirements: [] });
    expect(route('STATIC_BUSINESS_INFORMATION', 'KNOWLEDGE_QUESTION', { eligible: 2, evidence: 0 })).toMatchObject({ outcome: 'NO_TRUSTED_EVIDENCE', reason: 'NO_RELEVANT_KNOWLEDGE_EVIDENCE', knowledgeEligibleSourceCount: 2 });
    expect(route('STATIC_BUSINESS_INFORMATION', 'KNOWLEDGE_QUESTION')).toMatchObject({ outcome: 'NO_AUTHORIZED_SOURCE', reason: 'NO_ELIGIBLE_ASSISTANT_KNOWLEDGE' });
  });

  it('treats generic service availability as a static Knowledge question unless semantics identify a personal live record', () => {
    expect(planBusinessRequest(interpretation('UNKNOWN', 'AVAILABILITY_INQUIRY'))).toMatchObject({ informationNeed: 'STATIC_BUSINESS_INFORMATION', requiresKnowledge: true, requiresLiveApi: false });
    expect(planBusinessRequest(interpretation('PERSONAL_LIVE_RECORD', 'AVAILABILITY_INQUIRY'))).toMatchObject({ informationNeed: 'PERSONAL_LIVE_RECORD', requiresKnowledge: false, requiresLiveApi: true });
  });

  it('requires unavailable live lookup for personal status and does not treat generic Knowledge as status evidence', () => {
    const plan = planBusinessRequest(interpretation('PERSONAL_LIVE_RECORD', 'STATUS_INQUIRY'));
    expect(plan).toMatchObject({ capability: 'ORDER_TRACKING', requiresKnowledge: false, requiresLiveApi: true });
    expect(route('PERSONAL_LIVE_RECORD', 'STATUS_INQUIRY', { eligible: 5, evidence: 5 })).toMatchObject({ outcome: 'UNSUPPORTED_CAPABILITY', reason: 'LIVE_CONNECTOR_NOT_CONFIGURED', partialResultAllowed: false });
    expect(route('UNKNOWN', 'STATUS_INQUIRY')).toMatchObject({ outcome: 'UNSUPPORTED_CAPABILITY', reason: 'LIVE_CONNECTOR_NOT_CONFIGURED' });
  });

  it('preserves explicitly requested public Knowledge alongside a current-status intent', () => {
    const plan = planBusinessRequest(interpretation('STATIC_BUSINESS_INFORMATION', 'STATUS_INQUIRY'));
    expect(plan).toMatchObject({ informationNeed: 'MIXED_STATIC_AND_PERSONAL', requiresKnowledge: true, requiresLiveApi: true });
    expect(route('STATIC_BUSINESS_INFORMATION', 'STATUS_INQUIRY', { eligible: 2, evidence: 1 })).toMatchObject({
      outcome: 'TRUSTED_KNOWLEDGE', partialResultAllowed: true, missingRequirements: ['AUTHORIZED_LIVE_API'],
    });
  });

  it('allows a truthful static-only partial result for mixed requests and records the missing live source', () => {
    expect(route('MIXED_STATIC_AND_PERSONAL', 'STATUS_INQUIRY', { eligible: 3, evidence: 1 })).toMatchObject({ outcome: 'TRUSTED_KNOWLEDGE', partialResultAllowed: true, missingRequirements: ['AUTHORIZED_LIVE_API'] });
    expect(route('MIXED_STATIC_AND_PERSONAL', 'STATUS_INQUIRY', { eligible: 3, evidence: 0 })).toMatchObject({ outcome: 'NO_TRUSTED_EVIDENCE', partialResultAllowed: false, missingRequirements: ['AUTHORIZED_LIVE_API', 'KNOWLEDGE_EVIDENCE'] });
    expect(route('MIXED_STATIC_AND_PERSONAL', 'STATUS_INQUIRY')).toMatchObject({ outcome: 'NO_AUTHORIZED_SOURCE', partialResultAllowed: false });
  });

  it('requires clarification for ambiguous transaction needs without asking for sensitive identifiers', () => {
    const plan = planBusinessRequest(interpretation('AMBIGUOUS', 'PAYMENT_INQUIRY'));
    expect(plan).toMatchObject({ clarificationRequired: true, requiresKnowledge: false, requiresLiveApi: false });
    const capability = verified(4, true).capabilities.find((item) => item.category === plan.capability);
    expect(decideBusinessSourceRoute(plan, { knowledgeEligibleSourceCount: 4, evidenceCount: 4, liveConnector: noLiveBusinessConnector, capability, assistantAuthorizationVerified: true })).toMatchObject({ outcome: 'CLARIFICATION_REQUIRED', missingRequirements: ['CLARIFICATION'] });
  });

  it('fails closed if assistant authorization was not verified and ignores a user claim of integration access', () => {
    expect(route('STATIC_BUSINESS_INFORMATION', 'KNOWLEDGE_QUESTION', { eligible: 4, evidence: 4, authorized: false })).toMatchObject({ outcome: 'NO_AUTHORIZED_SOURCE', reason: 'ASSISTANT_AUTHORIZATION_NOT_VERIFIED' });
    expect(noLiveBusinessConnector).toEqual({ configured: false, assistantAuthorized: false, connected: false, temporarilyUnavailable: false });
  });

  it('marks only authenticated configured adapters temporarily unavailable and never fabricates execution', () => {
    const plan = planBusinessRequest(interpretation('PERSONAL_LIVE_RECORD', 'STATUS_INQUIRY'));
    const capability = verified(0, true).capabilities.find((item) => item.category === plan.capability);
    expect(decideBusinessSourceRoute(plan, {
      knowledgeEligibleSourceCount: 0, evidenceCount: 0,
      liveConnector: { configured: true, assistantAuthorized: true, connected: false, temporarilyUnavailable: true },
      capability, assistantAuthorizationVerified: true,
    })).toMatchObject({ outcome: 'TEMPORARILY_UNAVAILABLE', reason: 'LIVE_CONNECTOR_TEMPORARILY_UNAVAILABLE' });
  });
});
