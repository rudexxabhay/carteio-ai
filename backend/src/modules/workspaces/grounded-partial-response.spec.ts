import { supportedPartialResponse } from './grounded-partial-response';
import { isCustomerReportedQuotation } from './fact-provenance';
import type { ConversationEvidence } from './conversation.contracts';

const source: ConversationEvidence = { reference: 'S1', sourceId: 'authorized-source', chunkId: 'authorized-chunk', sourceVersion: 3, contentHash: 'a'.repeat(64), title: 'Policy', type: 'TEXT', locator: null, excerpt: 'Delivery takes 3 business days if the item is available.' };

describe('bounded supported partial response', () => {
  it('preserves a complete supported policy and its condition while dropping a separate unsupported claim', () => {
    const valid = `${source.excerpt} [S1]`;
    expect(supportedPartialResponse(`${valid}\nDelivery is guaranteed in 1 day. [S1]`, [source], ['S1'])).toBe(valid);
  });
  it('does not preserve a sentence that drops the policy condition', () => {
    expect(supportedPartialResponse('Delivery takes 3 business days. [S1]', [source], ['S1'])).toBeNull();
  });
  it('rejects irrelevant same-number claims and mixed supported/unsupported conclusions', () => {
    expect(supportedPartialResponse('Returns take 3 business days. [S1]', [source], ['S1'])).toBeNull();
    expect(supportedPartialResponse(`${source.excerpt} All customers are eligible. [S1]`, [source], ['S1'])).toBeNull();
  });
  it('does not use an absent, revoked or irrelevant reference', () => {
    const draft = `${source.excerpt} [S1]`;
    expect(supportedPartialResponse(draft, [], ['S1'])).toBeNull();
    expect(supportedPartialResponse(draft, [source], [])).toBeNull();
    expect(supportedPartialResponse(`${source.excerpt} [S2]`, [source], ['S1'])).toBeNull();
  });
  it('accepts grammatical person changes without changing quantities or conditions', () => {
    expect(isCustomerReportedQuotation('You mentioned: “you purchased 4 items”', ['I purchased 4 items'])).toBe(true);
    expect(isCustomerReportedQuotation('You mentioned: “you purchased 5 items”', ['I purchased 4 items'])).toBe(false);
    expect(isCustomerReportedQuotation('You mentioned: “you purchased 4 items”, so a refund is guaranteed.', ['I purchased 4 items'])).toBe(false);
    expect(isCustomerReportedQuotation('You mentioned: “you purchased 4 items”', ['I did not purchase 4 items'])).toBe(false);
  });
  it('does not take assistant history or a different customer statement as authority', () => {
    expect(isCustomerReportedQuotation('You mentioned: “you purchased 4 items”', ['Where can I find the policy?'])).toBe(false);
  });
});
