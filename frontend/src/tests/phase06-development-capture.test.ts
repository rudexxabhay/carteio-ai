import { describe, expect, it } from 'vitest';
import { formatPlaygroundDiagnostics } from '../pages/training/playground-copy';
import type { PlaygroundTrace } from '../services/api/assistants';

describe('Phase 06 optional development metadata export', () => {
  const trace = (expiresAt: string): PlaygroundTrace => ({
    traceId: 'trace-north', startedAt: '2026-10-27T00:00:00Z', finishedAt: '2026-10-27T00:00:01Z', totalLatencyMs: 10, finalSource: 'SYSTEM_RESPONSE',
    retrieval: { attempted: true, queryHash: null, mode: 'lexical_only', audience: 'PUBLIC_VISITOR', eligibilityStatus: 'ELIGIBLE_SOURCES_FOUND', eligibleSourceCount: 1, resultCount: 0 }, events: [], tools: [], evidence: [],
    developmentCapture: { mode: 'METADATA_ONLY', expiresAt, checks: [{ stage: 'INTERPRETATION', metadata: { reason: 'invalid_intent', recovered: true } }] },
  });

  it('exports opted-in validation metadata from the current response', () => {
    const output = formatPlaygroundDiagnostics([{ id: 'answer', role: 'assistant', content: 'Response', diagnostics: trace(new Date(Date.now() + 60_000).toISOString()) }]);
    expect(output).toContain('metadata only');
    expect(output).toContain('invalid_intent');
    expect(output).toContain('"recovered":true');
  });

  it('omits development capture after expiry', () => {
    const output = formatPlaygroundDiagnostics([{ id: 'answer', role: 'assistant', content: 'Response', diagnostics: trace(new Date(0).toISOString()) }]);
    expect(output).not.toContain('Development capture');
    expect(output).not.toContain('invalid_intent');
  });
});
