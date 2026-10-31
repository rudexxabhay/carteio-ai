import { answerOutcome } from './answer-outcome';
import { buildGroundedAnswerPlan } from './grounded-answer-plan';
import { groundingFailureMetadata, validateGroundedResponse } from './grounded-response-validation';
import { supportedPartialResponse } from './grounded-partial-response';
import type { ConversationEvidence } from './conversation.contracts';

const source: ConversationEvidence = { reference: 'S1', sourceId: 's1', chunkId: 'c1', sourceVersion: 1, contentHash: 'a'.repeat(64), title: 'Delivery', type: 'TEXT', locator: null, excerpt: 'Delivery takes 3 business days.' };
const plan = (evidence: ConversationEvidence[] = [source], live = false) => buildGroundedAnswerPlan({ question: 'Delivery?', responseLanguage: 'English', aspects: [{ questionSpan: 'Delivery?', retrievalQuery: 'delivery' }], evidence, requiresLiveLimitation: live });

describe('server-owned answer outcomes and repair metadata', () => {
  it('never equates candidate coverage with a verified answer', () => {
    expect(answerOutcome(plan())).toBe('EVIDENCE_INSUFFICIENT');
    expect(answerOutcome(plan(), validateGroundedResponse(`${source.excerpt} [S1]`, [source]))).toBe('ANSWER_SUPPORTED');
  });
  it('distinguishes absent evidence, unavailable live data and rejected claims', () => {
    expect(answerOutcome(plan([]))).toBe('EVIDENCE_INSUFFICIENT');
    expect(answerOutcome(plan([], true))).toBe('LIVE_INFORMATION_UNAVAILABLE');
    expect(answerOutcome(plan(), validateGroundedResponse('Delivery takes 9 days. [S1]', [source]))).toBe('GENERATED_CLAIM_REJECTED');
  });
  it('preserves separately supported content and reports failures without raw text', () => {
    const draft = `${source.excerpt} [S1]\nDelivery takes 99 days. [S1]`;
    const partial = supportedPartialResponse(draft, [source], ['S1']);
    expect(partial).toBe(`${source.excerpt} [S1]`);
    expect(answerOutcome(plan(), validateGroundedResponse(partial!, [source]), true)).toBe('ANSWER_PARTIALLY_SUPPORTED');
    const metadata = groundingFailureMetadata(draft, [source]);
    expect(metadata[1]).toMatchObject({ lineIndex: 1, accepted: false, reason: 'unsupported_numeric_claim' });
    expect(JSON.stringify(metadata)).not.toContain('99');
    expect(JSON.stringify(metadata)).not.toContain(source.excerpt);
  });
  it('does not grant authority to absent/revoked evidence or customer numbers', () => {
    expect(validateGroundedResponse('Delivery takes 9 days. [S1]', [], undefined, { customerStatements: ['9 days'] }).accepted).toBe(false);
    expect(groundingFailureMetadata('You mentioned: “9 days”\nDelivery takes 9 days. [S1]', [source], { customerStatements: ['9 days'] })).toEqual(expect.arrayContaining([expect.objectContaining({ provenance: 'CUSTOMER_REPORTED', accepted: true }), expect.objectContaining({ accepted: false })]));
  });
});
