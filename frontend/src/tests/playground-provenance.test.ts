import { describe, expect, it } from 'vitest';
import { playgroundSourceLabel } from '../dashboard-source/playground-provenance';

describe('Playground response source attribution', () => {
  it('uses model provenance without inventing external evidence', () => {
    expect(playgroundSourceLabel({ provenance: 'AI_GENERATED', sources: [] })).toBe('AI generated');
    expect(playgroundSourceLabel({ provenance: undefined, sources: [] })).toBe('Source unavailable');
  });

  it('labels only the source types returned as validated citations', () => {
    expect(playgroundSourceLabel({ provenance: 'KNOWLEDGE_GROUNDED', sources: [{ reference: 'S1', title: 'Delivery', type: 'FAQ', locator: null }] })).toBe('AI generated · Knowledge Base');
    expect(playgroundSourceLabel({ provenance: 'KNOWLEDGE_GROUNDED', sources: [{ reference: 'C1', title: 'Product', type: 'COMMERCE_PRODUCT', locator: null }] })).toBe('AI generated · Shopify data');
    expect(playgroundSourceLabel({ provenance: 'KNOWLEDGE_GROUNDED', sources: [{ reference: 'S1', title: 'Delivery', type: 'FAQ', locator: null }, { reference: 'C1', title: 'Product', type: 'COMMERCE_PRODUCT', locator: null }] })).toBe('AI generated · Knowledge Base + Shopify data');
  });

  it('keeps deterministic replies classified as system responses', () => {
    expect(playgroundSourceLabel({ provenance: 'SYSTEM_RESPONSE', sources: [] })).toBe('System response');
  });
});
