import { buildGroundedAnswerPlan } from './grounded-answer-plan';
import type { ConversationEvidence } from './conversation.contracts';

const product: ConversationEvidence = {
  reference: 'C1', sourceId: 'catalog-a', chunkId: 'product-a', sourceVersion: 1,
  contentHash: 'c'.repeat(64), title: 'North Shirt', type: 'COMMERCE_PRODUCT',
  excerpt: JSON.stringify({ name: 'North Shirt', price: '1200.00', currency: 'INR' }), locator: null,
};
const policy = (overrides: Partial<ConversationEvidence> = {}): ConversationEvidence => ({
  reference: 'S1', sourceId: 'source-a', chunkId: 'chunk-a', sourceVersion: 1,
  contentHash: 'a'.repeat(64), title: 'Returns Policy', type: 'TEXT',
  excerpt: 'Returns are accepted within 30 days of delivery.', locator: 'policy.pdf · page 1',
  retrievalReason: 'hybrid_rrf', ...overrides,
});
const plan = (question: string, query: string, evidence: ConversationEvidence[], broadProductBrowse = false) =>
  buildGroundedAnswerPlan({ question, responseLanguage: 'English', aspects: [{ questionSpan: question, retrievalQuery: query }], evidence, requiresLiveLimitation: false, broadProductBrowse });

describe('grounded answer candidate planning', () => {
  it('keeps authorized catalog results as candidates for broad product browsing', () => {
    expect(plan('Show your products', 'Show your products', [product], true).aspects[0]).toMatchObject({ status: 'EVIDENCE_CANDIDATE', evidenceReferences: ['C1'] });
  });
  it('does not map an empty catalog result to evidence', () => {
    expect(plan('Show your products', 'Show your products', [], true).coverage).toBe('NO_EVIDENCE');
  });
  it('does not treat an unrelated result as relevant to a specific product query', () => {
    expect(plan('Find red shoes', 'red shoes', [product], false).aspects[0]?.status).toBe('NO_MATCHING_CANDIDATE');
  });
  it('retains a semantically ranked English policy candidate for Romanized Hindi query planning', () => {
    expect(plan('Return kar sakta hu?', 'return kar sakta hu', [policy()]).aspects[0]).toMatchObject({ status: 'EVIDENCE_CANDIDATE', evidenceReferences: ['S1'] });
  });
  it('does not let an unrelated lexical-only chunk establish a candidate', () => {
    expect(plan('What is the return window?', 'return window', [policy({ title: 'Our history', excerpt: 'The company was founded recently.', retrievalReason: 'lexical' })]).coverage).toBe('NO_EVIDENCE');
  });
  it('keeps candidate mapping separate from entailment verification', () => {
    expect(plan('Show your products', 'Show your products', [product], true).entailmentVerified).toBe(false);
  });
});
