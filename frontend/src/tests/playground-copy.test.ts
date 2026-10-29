import { describe, expect, it } from 'vitest';
import { buildPlaygroundDebugReport, formatPlaygroundDiagnostics, formatPlaygroundHistory, formatPlaygroundMessage, PLAYGROUND_EXPORT_MAX_BYTES } from '../pages/training/playground-copy';

describe('Playground copy formatting', () => {
  const messages = [
    { id: 'u1', role: 'user' as const, content: 'Tumhare paas kaunse products available hain?\nदूसरी पंक्ति', createdAt: Date.parse('2026-10-23T10:15:00Z') },
    { id: 'a1', role: 'assistant' as const, content: 'Maaf kijiye…', createdAt: Date.parse('2026-10-23T10:16:00Z'), provenance: 'AI_GENERATED', sources: [{ reference: 'S1', title: 'Catalog FAQ', type: 'FAQ' }] },
    { id: 'a2', role: 'assistant' as const, content: 'Theek hai.', createdAt: Date.parse('2026-10-23T10:17:00Z'), provenance: 'SYSTEM_RESPONSE' },
  ];

  it('formats every message in chronological order with origin, timestamp, source, Unicode and multiline text', () => {
    const text = formatPlaygroundHistory({ assistantName: 'Carteio AI', conversationId: 'safe-session-id', messages, exportedAt: new Date('2026-10-23T12:00:00Z') });
    expect(text.indexOf('Tumhare paas')).toBeLessThan(text.indexOf('Maaf kijiye'));
    expect(text.indexOf('Maaf kijiye')).toBeLessThan(text.indexOf('Theek hai.'));
    const localTime = new Date(messages[0]!.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(text).toContain(`[${localTime}] USER`);
    expect(text).toContain('दूसरी पंक्ति');
    expect(text).toContain('Response origin: AI generated');
    expect(text).toContain('Response origin: System response');
    expect(text).toContain('Sources: [S1] Catalog FAQ (FAQ)');
    expect(text).toContain('Conversation: safe-session-id');
  });

  it('copies only the selected message body for individual copy', () => {
    expect(formatPlaygroundMessage(messages[0]!)).toBe('Tumhare paas kaunse products available hain?\nदूसरी पंक्ति');
  });

  it('marks export incomplete when message or byte limits omit content', () => {
    const byCount = formatPlaygroundHistory({ assistantName: 'Carteio AI', conversationId: null, messages, maxMessages: 1 });
    const bySize = formatPlaygroundHistory({ assistantName: 'Carteio AI', conversationId: null, messages, maxBytes: 260 });
    expect(byCount).toContain('EXPORT INCOMPLETE');
    expect(bySize).toContain('EXPORT INCOMPLETE');
    expect(new TextEncoder().encode(formatPlaygroundHistory({ assistantName: 'Carteio AI', conversationId: null, messages, maxBytes: PLAYGROUND_EXPORT_MAX_BYTES })).byteLength).toBeLessThanOrEqual(PLAYGROUND_EXPORT_MAX_BYTES);
  });

  it('exports only safe trace metadata and excludes evidence excerpts', () => {
    const trace = { traceId: 'trace-1', startedAt: '', finishedAt: '', totalLatencyMs: 123, finalSource: 'AI_GENERATED' as const, events: [{ sequence: 1, at: '', operation: 'INTENT_INTERPRETATION', outcome: 'FAILED', status: 'failed', durationMs: 20, errorCategory: 'PROVIDER_INVALID_RESPONSE', provider: 'openrouter', model: 'google/gemini-2.5-flash' }], retrieval: { attempted: true, queryHash: null, mode: 'lexical_only', audience: 'PUBLIC_VISITOR' as const, eligibilityStatus: 'READY', eligibleSourceCount: 2, resultCount: 1 }, tools: [{ tool: 'shopify_product_search', outcome: 'skipped', reason: 'PRODUCT_INTENT_NOT_DETECTED' }], evidence: [{ reference: 'S1', sourceId: 'source-id', chunkId: 'chunk-id', sourceType: 'FAQ', title: 'FAQ', locator: null, excerpt: 'PRIVATE COMPLETE KNOWLEDGE DOCUMENT', retrieved: true, selectedForContext: false, revalidated: false, suppliedToProvider: false, cited: false }] };
    const text = formatPlaygroundDiagnostics([{ ...messages[1]!, diagnostics: trace }]);
    expect(text).toContain('PROVIDER_INVALID_RESPONSE');
    expect(text).toContain('openrouter · google/gemini-2.5-flash');
    expect(text).toContain('PRODUCT_INTENT_NOT_DETECTED');
    expect(text).not.toContain('PRIVATE COMPLETE KNOWLEDGE DOCUMENT');
  });

  it('builds chronological conversation debug JSON and marks historical trace gaps explicitly', () => {
    const result = buildPlaygroundDebugReport({ assistantName: 'Carteio AI', conversationId: 'session-1', messages: [messages[0]!, messages[1]!] });
    expect(result.report).toMatchObject({ reportVersion: 'playground-execution-debug-v1', executionIdentity: { conversationId: 'session-1' }, conversationSummary: { totalTurns: 1, successfulResponses: 1 }, turns: [{ role: 'user' }, { role: 'assistant', diagnostics: { status: 'NOT_CAPTURED' } }] });
    expect(result.json).not.toContain('दूसरी पंक्ति');
  });

  it('reports omitted turns when the safe byte limit is exceeded', () => {
    const result = buildPlaygroundDebugReport({ assistantName: 'Carteio AI', conversationId: null, messages, maxBytes: 100 });
    expect(result.report.diagnosticCompleteness).toMatchObject({ status: 'TRUNCATED', reason: 'BYTE_LIMIT', omittedTurnCount: messages.length });
  });
});
