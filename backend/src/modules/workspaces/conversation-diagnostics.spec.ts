import { historyDiagnostic, providerHistoryDiagnostic, safeDiagnosticSourceIds, selectBoundedHistory } from './conversation-diagnostics';
import { groundingSearchState, validateGroundedResponse } from './grounded-response-validation';
import type { ConversationEvidence } from './conversation.contracts';

const evidence = (input: Partial<ConversationEvidence> & Pick<ConversationEvidence, 'reference' | 'excerpt'>): ConversationEvidence => ({
  reference: input.reference, excerpt: input.excerpt, chunkId: input.chunkId ?? 'chunk-1', sourceId: input.sourceId ?? 'source-1', sourceVersion: input.sourceVersion ?? 1,
  contentHash: input.contentHash ?? 'a'.repeat(64), title: input.title ?? 'Merchant FAQ', type: input.type ?? 'FAQ', locator: input.locator ?? null,
  ...(input.sourceAuthority ? { sourceAuthority: input.sourceAuthority } : {}),
});

describe('conversation diagnostics metadata', () => {
  it('reports bounded history truncation without including message content', () => {
    expect(historyDiagnostic(12, 8, 1024)).toEqual({ loadedMessageCount: 12, includedMessageCount: 8, contextBytes: 1024, contentTruncated: false, truncated: true });
    expect(historyDiagnostic(4, 4, 256).truncated).toBe(false);
    expect(historyDiagnostic(1, 1, 200, true).truncated).toBe(true);
  });

  it('allows only a bounded list of UUID source identifiers', () => {
    const ids = Array.from({ length: 7 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`);
    expect(safeDiagnosticSourceIds([...ids, 'customer@email.test', 'private excerpt'])).toEqual(ids.slice(0, 5));
  });

  it('keeps empty, one-message, and within-budget histories stable', () => {
    expect(selectBoundedHistory([], 12, 1000).turns).toEqual([]);
    const one = [{ role: 'user' as const, content: 'Earlier question' }];
    expect(selectBoundedHistory(one, 12, 1000).turns).toEqual(one);
    const within = [{ role: 'user' as const, content: 'Question' }, { role: 'assistant' as const, content: 'Answer' }];
    expect(selectBoundedHistory(within, 12, 1000).turns).toEqual(within);
  });

  it('keeps the newest complete turns and returns chronological order on overflow', () => {
    const turns = Array.from({ length: 8 }, (_, index) => [
      { role: 'user' as const, content: `Question ${index}` },
      { role: 'assistant' as const, content: `Answer ${index}` },
    ]).flat();
    const selected = selectBoundedHistory(turns, 4, 1000);
    expect(selected.turns).toEqual(turns.slice(-4));
    expect(selected.turns.at(-2)?.content).toBe('Question 7');
    expect(selected.turns.at(-1)?.content).toBe('Answer 7');
    expect(selected.droppedMessageCount).toBe(12);
  });

  it('retains the latest customer follow-up and handles oversized and repeated messages safely', () => {
    const turns = [
      { role: 'user' as const, content: 'Show running shoes below 2000.' },
      { role: 'assistant' as const, content: 'Here are the available options.' },
      { role: 'user' as const, content: 'Black colour me?' },
      { role: 'assistant' as const, content: 'Two options are available.' },
      { role: 'user' as const, content: 'Black colour me?' },
    ];
    const selected = selectBoundedHistory(turns, 4, 180);
    expect(selected.turns.map((turn) => turn.content)).toEqual(['Black colour me?', 'Two options are available.', 'Black colour me?']);
    const long = selectBoundedHistory([{ role: 'user', content: 'Earlier context '.repeat(4000) }], 12, 1024);
    expect(long.turns).toHaveLength(1);
    expect(long.contextBytes).toBeLessThanOrEqual(1024);
    expect(long.contentTruncationCount).toBe(1);
    expect(long.turns[0]?.content.startsWith('…[earlier message omitted]')).toBe(true);
    expect(long.turns[0]?.content.endsWith('Earlier context ')).toBe(true);
  });

  it('does not insert the current message into prior history', () => {
    const prior = [{ role: 'user' as const, content: 'Show running shoes below 2000.' }, { role: 'assistant' as const, content: 'Here are the available options.' }];
    const current = 'Black colour me?';
    const selected = selectBoundedHistory(prior, 12, 1000);
    expect(selected.turns.filter((turn) => turn.content === current)).toHaveLength(0);
    expect([ ...selected.turns, { role: 'user', content: current } ].filter((turn) => turn.content === current)).toHaveLength(1);
  });

  it('accepts cited policy durations only when the cited source contains the same value', () => {
    const policy = evidence({ reference: 'S1', excerpt: 'Returns are accepted within 30 days.' });
    expect(validateGroundedResponse('Returns are accepted within 30 days. [S1]', [policy]).accepted).toBe(true);
    expect(validateGroundedResponse('Returns are accepted within 60 days. [S1]', [policy])).toMatchObject({ accepted: false, reason: 'unsupported_numeric_claim', unsupportedClaimCount: 1 });
    expect(validateGroundedResponse('Returns are accepted within 30 hours. [S1]', [policy]).accepted).toBe(false);
  });

  it('validates a Hindi answer against English policy evidence without changing language behavior', () => {
    const policy = evidence({ reference: 'S1', excerpt: 'Returns are accepted within 30 days.' });
    expect(validateGroundedResponse('रिटर्न 30 दिनों के भीतर स्वीकार किए जाते हैं। [S1]', [policy]).accepted).toBe(true);
  });

  it('rejects a claim whose citation points to an unrelated source', () => {
    const unrelated = evidence({ reference: 'S2', excerpt: 'Contact support by email.' });
    expect(validateGroundedResponse('Returns are accepted within 30 days. [S2]', [evidence({ reference: 'S1', excerpt: 'Returns are accepted within 30 days.' }), unrelated])).toMatchObject({ accepted: false, reason: 'unsupported_numeric_claim' });
  });

  it('rejects valid references that are not mapped to the requested evidence aspects', () => {
    const contact = evidence({ reference: 'S1', excerpt: 'Contact support for help with the store.' });
    const product = evidence({ reference: 'C1', type: 'COMMERCE_PRODUCT', excerpt: JSON.stringify({ name: 'Item', category: 'Accessories' }) });
    expect(validateGroundedResponse('A factual catalog claim. [S1]', [contact, product], undefined, { relevantReferences: ['C1'] }))
      .toMatchObject({ accepted: false, reason: 'unsupported_merchant_fact', unsupportedClaimCount: 1 });
    expect(validateGroundedResponse('A factual catalog claim. [C1]', [contact, product], undefined, { relevantReferences: ['C1'] }).accepted).toBe(true);
  });

  it('does not treat an unavailable or empty search as verified absence', () => {
    expect(groundingSearchState(false, 0)).toEqual({ availability: 'UNAVAILABLE', retrievedRecordCompleteness: 'NOT_ESTABLISHED', authoritativeAbsenceVerified: false });
    expect(groundingSearchState(true, 0)).toEqual({ availability: 'NO_MATCH', retrievedRecordCompleteness: 'NOT_ESTABLISHED', authoritativeAbsenceVerified: false });
    expect(groundingSearchState(true, 1, false)).toEqual({ availability: 'RESULTS', retrievedRecordCompleteness: 'PARTIAL_OR_UNKNOWN', authoritativeAbsenceVerified: false });
    expect(groundingSearchState(true, 1, true)).toEqual({ availability: 'RESULTS', retrievedRecordCompleteness: 'COMPLETE', authoritativeAbsenceVerified: false });
  });

  it('checks structured product amount and currency against cited Shopify snapshot evidence', () => {
    const product = evidence({ reference: 'C1', type: 'COMMERCE_PRODUCT', excerpt: JSON.stringify({ name: 'Running Shoe', price: '1999.00', currency: 'INR', compareAtPrice: null, stale: false, variants: [] }) });
    expect(validateGroundedResponse('The price is ₹1,999 INR. [C1]', [product]).accepted).toBe(true);
    expect(validateGroundedResponse('The price is $1,999 USD. [C1]', [product])).toMatchObject({ accepted: false, reason: 'unsupported_structured_product_fact' });
    expect(validateGroundedResponse('The live price is ₹1,999 INR. [C1]', [product])).toMatchObject({ accepted: false, reason: 'unsupported_structured_product_fact' });
  });

  it('rejects fabricated price when the product record has no price data', () => {
    const missing = evidence({ reference: 'C1', type: 'COMMERCE_PRODUCT', excerpt: JSON.stringify({ name: 'Running Shoe', price: null, currency: null, variants: [] }) });
    expect(validateGroundedResponse('The price is ₹1,200 INR. [C1]', [missing]).accepted).toBe(false);
  });

  it('requires stale synchronized Shopify prices to be labeled as snapshots', () => {
    const stale = evidence({ reference: 'C1', type: 'COMMERCE_PRODUCT', excerpt: JSON.stringify({ name: 'Running Shoe', price: '1999.00', currency: 'INR', stale: true, syncedAt: '2026-10-16T10:00:00.000Z', variants: [] }) });
    expect(validateGroundedResponse('The price is ₹1,999 INR. [C1]', [stale]).accepted).toBe(false);
    expect(validateGroundedResponse('The last synced snapshot price as of 2026-10-16 is ₹1,999 INR. [C1]', [stale]).accepted).toBe(true);
    const noSyncDate = evidence({ reference: 'C2', type: 'COMMERCE_PRODUCT', excerpt: JSON.stringify({ name: 'Running Shoe', price: '1999.00', currency: 'INR', stale: true, variants: [] }) });
    expect(validateGroundedResponse('The snapshot price as of today is ₹1,999 INR. [C2]', [noSyncDate]).accepted).toBe(false);
  });

  it('validates only explicit, snapshot-labeled Shopify availability states', () => {
    const product = evidence({ reference: 'C1', type: 'COMMERCE_PRODUCT', excerpt: JSON.stringify({ name: 'Running Shoe', availability: 'IN_STOCK', stale: false, syncedAt: '2026-10-17T10:00:00.000Z', variants: [] }) });
    expect(validateGroundedResponse('The last synced snapshot lists it as in stock as of 2026-10-17. [C1]', [product]).accepted).toBe(true);
    expect(validateGroundedResponse('It is in stock. [C1]', [product]).accepted).toBe(false);
    const missing = evidence({ reference: 'C2', type: 'COMMERCE_PRODUCT', excerpt: JSON.stringify({ name: 'Running Shoe', availability: null, stale: false, variants: [] }) });
    expect(validateGroundedResponse('The last synced snapshot lists it as in stock. [C2]', [missing]).accepted).toBe(false);
  });

  it('checks exact cited URLs and rejects URLs absent from that source', () => {
    const page = evidence({ reference: 'S1', excerpt: 'Contact support.', locator: 'https://shop.example/returns' });
    expect(validateGroundedResponse('See https://shop.example/returns [S1]', [page]).accepted).toBe(true);
    expect(validateGroundedResponse('See https://other.example/returns [S1]', [page])).toMatchObject({ accepted: false, reason: 'unsupported_url' });
  });

  it('binds the complete snapshot date to its cited source and rejects changed or uncited dates', () => {
    const product = evidence({ reference: 'C1', type: 'COMMERCE_PRODUCT', excerpt: JSON.stringify({ availability: 'IN_STOCK', stale: true, syncedAt: '2026-10-17T10:00:00.000Z' }) });
    const other = evidence({ reference: 'S1', excerpt: 'Contact support for help.' });
    expect(validateGroundedResponse('The snapshot lists it as in stock as of 2026-10-17. [C1]', [product]).accepted).toBe(true);
    expect(validateGroundedResponse('The snapshot date is 2026-17-10. [C1]', [product])).toMatchObject({ accepted: false, reason: 'unsupported_numeric_claim' });
    expect(validateGroundedResponse('The snapshot date is 2026-10-18. [C1]', [product]).accepted).toBe(false);
    expect(validateGroundedResponse('The snapshot date is 2026-10-17. [S1]', [product, other]).accepted).toBe(false);
    expect(validateGroundedResponse('The snapshot date is 2026-10-17.', [product]).accepted).toBe(false);
  });

  it('checks cited merchant contact details and structured SKUs exactly', () => {
    const contact = evidence({ reference: 'S1', excerpt: 'Contact help@example.com or call +1 (555) 123-4567.' });
    expect(validateGroundedResponse('Contact help@example.com. [S1]', [contact]).accepted).toBe(true);
    expect(validateGroundedResponse('Contact fake@example.com. [S1]', [contact]).reason).toBe('unsupported_merchant_fact');
    const product = evidence({ reference: 'C1', type: 'COMMERCE_PRODUCT', excerpt: JSON.stringify({ name: 'Running Shoe', sku: 'SHOE-42', variants: [{ sku: 'SHOE-42-BLK' }] }) });
    expect(validateGroundedResponse('SKU: SHOE-42-BLK [C1]', [product]).accepted).toBe(true);
    expect(validateGroundedResponse('SKU: SHOE-99 [C1]', [product]).reason).toBe('unsupported_structured_product_fact');
  });

  it('rejects missing and unauthorized citations without leaking source details', () => {
    const page = evidence({ reference: 'S1', excerpt: 'Returns are accepted within 30 days.' });
    expect(validateGroundedResponse('Returns take 30 days.', [page]).reason).toBe('missing_reference');
    expect(validateGroundedResponse('Returns take 30 days. [S9]', [page]).reason).toBe('unknown_reference');
  });

  it('validates multiple cited facts against the specific sources named in each sentence', () => {
    const returns = evidence({ reference: 'S1', excerpt: 'Returns are accepted within 30 days.' });
    const refunds = evidence({ reference: 'S2', excerpt: 'Refunds take 5 business days.' });
    expect(validateGroundedResponse('Returns are accepted within 30 days [S1]. Refunds take 5 business days [S2].', [returns, refunds]).accepted).toBe(true);
  });

  it('keeps contradictory cited source values distinguishable for the existing conflict plan', () => {
    const first = evidence({ reference: 'S1', sourceId: 'merchant-a', excerpt: 'Returns are accepted within 30 days.' });
    const second = evidence({ reference: 'S2', sourceId: 'merchant-b', excerpt: 'Returns are accepted within 45 days.' });
    expect(validateGroundedResponse('One page says 30 days [S1]; another says 45 days [S2].', [first, second]).accepted).toBe(true);
  });

  it('leaves ordinary conversational and semantic prose outside fact entailment claims', () => {
    expect(validateGroundedResponse('Hello! How can I help?', []).accepted).toBe(false);
    const source = evidence({ reference: 'S1', excerpt: 'Returns are accepted within 30 days.' });
    const result = validateGroundedResponse('The store is family owned. [S1]', [source]);
    expect(result).toMatchObject({ accepted: true, verifiedFactCount: 0 });
    // Acceptance here means deterministic checks found no unsupported measurable
    // field; it does not mean the qualitative sentence was semantically verified.
  });
});


describe('Phase 05 memory boundaries', () => {
  it('budgets escaped JSON while retaining the newest oversized message', () => {
    const selected = selectBoundedHistory([{ role: 'user', content: '\"\\\n'.repeat(500) }], 12, 180);
    expect(selected.turns).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(selected.turns[0]), 'utf8')).toBeLessThanOrEqual(180);
    expect(selected.turns[0]?.content.length).toBeGreaterThan(30);
    expect(selected.truncationReasons).toEqual(['BYTE_LIMIT', 'CONTENT_TRUNCATED']);
    expect(selected.droppedMessageCount).toBe(0);
  });

  it('reports message-window truncation without inventing a byte truncation', () => {
    const turns = Array.from({ length: 6 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `Turn ${index}` }));
    const selected = selectBoundedHistory(turns, 4, 5000);
    expect(selected.turns).toEqual(turns.slice(-4));
    expect(selected.truncationReasons).toEqual(['MESSAGE_LIMIT']);
    expect(selected.droppedMessageCount).toBe(2);
  });

  it('describes actual outbound history roles without exposing text or counting the current message', () => {
    const messages = [
      { role: 'system', content: 'Protected instructions' },
      { role: 'user', content: JSON.stringify({ type: 'untrusted_conversation_context', priorTurns: [{ role: 'user', content: 'private customer text' }, { role: 'assistant', content: 'private prior reply' }] }) },
      { role: 'user', content: 'Current correction' },
    ];
    const metadata = providerHistoryDiagnostic(messages);
    expect(metadata).toEqual({ historyMessageCount: 2, historyRoles: ['user', 'assistant'] });
    expect(JSON.stringify(metadata)).not.toContain('private');
    expect(providerHistoryDiagnostic([messages[0]!, messages[1]!])).toEqual({ historyMessageCount: 0, historyRoles: [] });
  });
});
