import { buildRetrievalQueryPlan, MAX_RETRIEVAL_QUERY_VARIANTS } from '../src/modules/workspaces/retrieval-query-plan';

describe('bounded retrieval query planning', () => {
  it('keeps contextual and original wording and caps multi-aspect expansion', () => {
    const plan = buildRetrievalQueryPlan({
      originalMessage: 'Kitne din lagte hain?',
      contextualQuery: 'What is your refund policy? Kitne din lagte hain?',
      answerAspectQueries: ['refund processing duration', 'return conditions', 'shipping eligibility'],
      semanticQueries: ['refund timeline', 'how long for a refund', 'processing duration', 'return period', 'shipping countries'],
    });
    expect(plan.queries[0]).toBe('What is your refund policy? Kitne din lagte hain?');
    expect(plan.queries).toContain('Kitne din lagte hain?');
    expect(plan.queries).toContain('refund processing duration');
    expect(plan.queries).toHaveLength(MAX_RETRIEVAL_QUERY_VARIANTS);
  });

  it('does not let an answer-aspect search expression introduce an identifier', () => {
    const plan = buildRetrievalQueryPlan({
      originalMessage: 'Where is order ORD-1042?',
      answerAspectQueries: ['shipment status ORD-9999'],
      protectedEntities: [{ type: 'ORDER_ID', raw: 'ORD-1042' }],
    });
    expect(plan.rejectedExpansionCount).toBe(1);
    expect(plan.queries).not.toContain('shipment status ORD-9999');
  });

  it('rejects provider rewrites that introduce identifier-shaped values', () => {
    const plan = buildRetrievalQueryPlan({
      originalMessage: 'Where is order ORD-1042?',
      semanticQueries: ['shipment location ORD-9999', 'shipment location ord-1042', 'shipment location'],
      protectedEntities: [{ type: 'ORDER_ID', raw: 'ORD-1042' }],
    });
    expect(plan.queries).toEqual(['Where is order ORD-1042?', 'shipment location ORD-1042']);
    expect(plan.rejectedExpansionCount).toBe(2);
    expect(plan.queries.some((query) => query.includes('ORD-9999'))).toBe(false);
    expect(plan.queries.some((query) => query.includes('ord-1042'))).toBe(false);
  });

  it('preserves exact validated entities in rewrites and rejects entities outside current or resolved context', () => {
    const plan = buildRetrievalQueryPlan({
      originalMessage: 'Is this item refundable?',
      contextualQuery: 'Does product Alpine-7 qualify for a refund?',
      semanticQueries: ['refund conditions for Alpine-7', 'refund conditions for Alpine-9'],
      protectedEntities: [{ type: 'PRODUCT_NAME', raw: 'Alpine-7' }],
    });
    expect(plan.queries).toContain('refund conditions for Alpine-7');
    expect(plan.queries).not.toContain('refund conditions for Alpine-9');
    expect(plan.rejectedExpansionCount).toBe(1);
  });

  it('strips control characters, bounds text, and deduplicates without changing source access', () => {
    const plan = buildRetrievalQueryPlan({
      originalMessage: 'refund\u0000 policy',
      semanticQueries: ['refund policy', 'x'.repeat(400)],
    });
    expect(plan.queries[0]).toBe('refund  policy');
    expect(plan.queries).toHaveLength(1);
    expect(plan.queries.every((query) => query.length <= 300)).toBe(true);
  });

  it('preserves resolved conversation context alongside Hindi and a model-written English search variant', () => {
    const plan = buildRetrievalQueryPlan({
      originalMessage: 'और दूसरे शहर में?',
      contextualQuery: 'Shipping options for delivery to another city',
      semanticQueries: ['delivery region eligibility'],
    });
    expect(plan.queries).toEqual(['Shipping options for delivery to another city', 'और दूसरे शहर में?', 'delivery region eligibility']);
    expect(plan.rejectedExpansionCount).toBe(0);
  });

});
