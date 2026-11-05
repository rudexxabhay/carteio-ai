import { describe, expect, it, vi } from 'vitest';
const traceMocks = vi.hoisted(() => ({ getPlaygroundDiagnosticTraces: vi.fn() }));
vi.mock('../services/api/assistants', async importOriginal => ({ ...await importOriginal<typeof import('../services/api/assistants')>(), getPlaygroundDiagnosticTraces: traceMocks.getPlaygroundDiagnosticTraces }));
import { buildPlaygroundDebugReport, formatPlaygroundDiagnostics, formatPlaygroundHistory, formatPlaygroundMessage, loadCompletePlaygroundDiagnosticTraces, PLAYGROUND_EXPORT_MAX_BYTES } from '../pages/training/playground-copy';

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
    expect(result.report).toMatchObject({ reportVersion: 'playground-execution-debug-v2', executionIdentity: { conversationId: 'session-1' }, conversationSummary: { totalTurns: 1, successfulResponses: 1 }, turns: [{ role: 'user' }, { role: 'assistant', diagnosticStatus: 'NOT_CAPTURED' }] });
    expect(result.json).toContain('दूसरी पंक्ति');
  });

  it('reports omitted turns when the safe byte limit is exceeded', () => {
    const result = buildPlaygroundDebugReport({ assistantName: 'Carteio AI', conversationId: null, messages, maxBytes: 100 });
    expect(result.report.completeness).toMatchObject({ status: 'INCOMPLETE_BYTE_LIMIT' });
  });

  it('copies failed retry attempts, successful stages, and safe trace JSON without protected provider output', () => {
    const trace = { traceId: 'trace-2', startedAt: '', finishedAt: '', totalLatencyMs: 9, finalSource: 'AI_GENERATED' as const, events: [{ sequence: 1, at: '', operation: 'ANSWER_GENERATION', outcome: 'FAILED', status: 'failed', errorCategory: 'PROVIDER_ERROR' }], retrieval: { attempted: false, mode: 'not_attempted', resultCount: 0, eligibleSourceCount: 0 }, tools: [], evidence: [], protectedResponseDebug: { records: [{ text: 'SECRET PROVIDER PROMPT' }] } };
    const attempts = [{ id: 'attempt-1', requestId: 'request-1', clientTurnId: 'turn-1', attempt: 1, outcome: 'FAILED' as const, payload: trace as never, createdAt: '2026-10-23T10:15:00Z' }];
    const result = buildPlaygroundDebugReport({ assistantName: 'Carteio AI', conversationId: 'session-1', messages: [{ ...messages[0]!, clientTurnId: 'turn-1' }], attempts });
    const report = result.report as { attempts: Array<{ attempt: number }> };
    expect(report.attempts).toHaveLength(1);
    expect(report.attempts[0]?.attempt).toBe(1);
    expect(result.json).toContain('PROVIDER_ERROR');
    expect(result.json).not.toContain('SECRET PROVIDER PROMPT');
  });

  it('loads authorized trace pages in order and deduplicates overlapping record IDs', async () => {
    traceMocks.getPlaygroundDiagnosticTraces.mockReset()
      .mockResolvedValueOnce({ sessionId: 'session-1', captureEnabled: true, offset: 0, limit: 100, hasMore: true, nextOffset: 1, items: [{ id: 'trace-1', requestId: 'request-1', clientTurnId: 'turn-1', attempt: 1, outcome: 'FAILED', payload: {} as never, createdAt: '2026-10-23T10:15:00Z' }] })
      .mockResolvedValueOnce({ sessionId: 'session-1', captureEnabled: true, offset: 1, limit: 100, hasMore: false, nextOffset: null, items: [{ id: 'trace-1', requestId: 'request-1', clientTurnId: 'turn-1', attempt: 1, outcome: 'FAILED', payload: {} as never, createdAt: '2026-10-23T10:15:00Z' }, { id: 'trace-2', requestId: 'request-2', clientTurnId: 'turn-1', attempt: 2, outcome: 'COMPLETED', payload: {} as never, createdAt: '2026-10-23T10:16:00Z' }] });
    const result = await loadCompletePlaygroundDiagnosticTraces({ workspaceSlug: 'north', assistantId: 'assistant-1', conversationId: 'session-1', signal: new AbortController().signal });
    expect(result.traces.map(item => item.id)).toEqual(['trace-1', 'trace-2']);
    expect(result.captureEnabled).toBe(true);
    expect(result.incomplete).toBe(false);
    expect(traceMocks.getPlaygroundDiagnosticTraces).toHaveBeenNthCalledWith(1, 'north', 'assistant-1', 'session-1', expect.any(AbortSignal), { offset: 0, limit: 100 });
    expect(traceMocks.getPlaygroundDiagnosticTraces).toHaveBeenNthCalledWith(2, 'north', 'assistant-1', 'session-1', expect.any(AbortSignal), { offset: 1, limit: 100 });
  });


});
