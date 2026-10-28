import { buildGroundedAnswerPlan, validateGroundedAnswerPlan } from '../src/modules/workspaces/grounded-answer-plan';
import type { ConversationEvidence } from '../src/modules/workspaces/conversation.contracts';

const evidence = (input: Partial<ConversationEvidence> & Pick<ConversationEvidence, 'reference' | 'sourceId' | 'excerpt' | 'title'>): ConversationEvidence => ({
  reference: input.reference, sourceId: input.sourceId, chunkId: input.chunkId ?? `chunk-${input.reference}`, sourceVersion: input.sourceVersion ?? 2,
  contentHash: input.contentHash ?? 'a'.repeat(64), title: input.title, type: input.type ?? 'FAQ', excerpt: input.excerpt,
  locator: input.locator ?? null,
});

describe('grounded answer planning', () => {
  it('maps exact evidence identities to distinct answer aspects without claiming entailment', () => {
    const plan = buildGroundedAnswerPlan({
      question: 'What is the return policy and how long does a refund take?', responseLanguage: 'English', requiresLiveLimitation: false,
      aspects: [
        { questionSpan: 'What is the return policy', retrievalQuery: 'return policy' },
        { questionSpan: 'how long does a refund take', retrievalQuery: 'refund processing time' },
      ],
      evidence: [
        evidence({ reference: 'S1', sourceId: 'source-return', title: 'Return Policy', excerpt: 'Returns are accepted within 30 days.' }),
        evidence({ reference: 'S2', sourceId: 'source-refund', title: 'Refund Policy', excerpt: 'Refunds are processed within 5 business days.' }),
      ],
    });
    expect(plan.aspects.map((aspect) => aspect.evidenceReferences)).toEqual([['S1', 'S2'], ['S2']]);
    expect(plan.coverage).toBe('CANDIDATES_FOR_ALL_ASPECTS');
    expect(plan.evidence[1]).toMatchObject({ reference: 'S2', sourceId: 'source-refund', sourceVersion: 2, contentHash: 'a'.repeat(64) });
    expect(plan.entailmentVerified).toBe(false);
  });

  it('reports partial candidate coverage and leaves unsupported aspects explicit', () => {
    const plan = buildGroundedAnswerPlan({
      question: 'Do you ship internationally and what is the Dubai delivery fee?', responseLanguage: 'Hinglish', requiresLiveLimitation: false,
      aspects: [
        { questionSpan: 'Do you ship internationally', retrievalQuery: 'international shipping' },
        { questionSpan: 'what is the Dubai delivery fee', retrievalQuery: 'delivery fee Dubai' },
      ],
      evidence: [evidence({ reference: 'S1', sourceId: 'source-shipping', title: 'Shipping Policy', excerpt: 'International shipping is available to selected countries.' })],
    });
    expect(plan.coverage).toBe('PARTIAL_CANDIDATES');
    expect(plan.aspects.map((aspect) => aspect.status)).toEqual(['EVIDENCE_CANDIDATE', 'NO_MATCHING_CANDIDATE']);
  });

  it('marks different time values from distinct sources as a potential unresolved conflict', () => {
    const plan = buildGroundedAnswerPlan({
      question: 'How long do refunds take?', responseLanguage: 'English', requiresLiveLimitation: false,
      aspects: [{ questionSpan: 'How long do refunds take', retrievalQuery: 'refund processing time' }],
      evidence: [
        evidence({ reference: 'S1', sourceId: 'source-a', title: 'Refund Policy', excerpt: 'Refunds are processed within 5 business days.' }),
        evidence({ reference: 'S2', sourceId: 'source-b', title: 'Refund Timing', excerpt: 'Refunds may take 7 to 10 business days.' }),
      ],
    });
    expect(plan.aspects[0]).toMatchObject({ status: 'POTENTIAL_CONFLICT', evidenceReferences: ['S1', 'S2'] });
    expect(plan.aspects[0]?.differingValues).toEqual(['5 business day', '7-10 business day']);
  });

  it('does not call an evidence candidate a verified factual claim', () => {
    const plan = buildGroundedAnswerPlan({ question: 'Shipping?', responseLanguage: null, aspects: [{ questionSpan: 'Shipping', retrievalQuery: 'shipping policy' }], evidence: [], requiresLiveLimitation: true });
    expect(plan).toMatchObject({ coverage: 'NO_EVIDENCE', requiresLiveLimitation: true, citationRequired: true, entailmentVerified: false });
  });

  it('validates bounded plans and binds every evidence reference to authorized observed evidence', () => {
    const plan = buildGroundedAnswerPlan({ question: 'What is shipping?', responseLanguage: 'English', aspects: [{ questionSpan: 'What is shipping?', retrievalQuery: 'shipping policy' }], evidence: [evidence({ reference: 'S1', sourceId: 'source-shipping', title: 'Shipping policy', excerpt: 'Shipping is available.' })], requiresLiveLimitation: false });
    expect(validateGroundedAnswerPlan(plan, ['S1'])).toBe(true);
    expect(validateGroundedAnswerPlan(plan, [])).toBe(false);
    expect(validateGroundedAnswerPlan({ ...plan, evidence: [...plan.evidence, { ...plan.evidence[0], reference: 'S9' }] })).toBe(false);
    expect(validateGroundedAnswerPlan({ ...plan, entailmentVerified: true })).toBe(false);
  });
});
