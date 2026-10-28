import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, apiPostEventStream, ApiError, clearPendingApiGets } from '../services/api/client';
import { previewKnowledgeBaseFaqImport } from '../services/api/knowledge-bases';
import { getConnectorPermissions } from '../services/api/connectors';

afterEach(() => { clearPendingApiGets(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('API client', () => {
  it('returns a successful JSON response from the same-origin API path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ status: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiGet('/health')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/health');
  });

  it('sends the selected FAQ workbook as multipart file bytes without overriding the browser boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ rows: [], total: 0, valid: 0, invalid: 0, duplicates: 0 }) });
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'support.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await previewKnowledgeBaseFaqImport('north', 'base-1', file);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/workspaces/north/knowledge-bases/base-1/sources/faqs/import/preview');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get('file')).toBe(file);
    expect(new Headers(init?.headers).has('content-type')).toBe(false);
    expect(init?.credentials).toBe('same-origin');
  });

  it('supports explicit no-store reads for mutable connector and catalog status', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ items: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await apiGet('/workspaces/carteio/connectors', undefined, { cache: 'no-store' });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
  });

  it('always reads mutable assistant permissions without browser cache reuse', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ categories: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await getConnectorPermissions('acme', 'connector-a', 'assistant-a');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/workspaces/acme/connectors/connector-a/permissions?assistantId=assistant-a');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
  });

  it('normalizes network and non-JSON HTTP failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(apiGet('/health')).rejects.toMatchObject({ name: 'ApiError', kind: 'network' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, headers: new Headers({ 'content-type': 'text/html' }) }));
    await expect(apiGet('/health')).rejects.toMatchObject({ name: 'ApiError', kind: 'http', status: 502 });
  });

  it('preserves safe structured API error codes for feature-specific messaging', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ code: 'EMAIL_SERVICE_UNAVAILABLE', message: 'Email code delivery is temporarily unavailable.' }) }));
    await expect(apiGet('/auth/otp/request')).rejects.toMatchObject({ kind: 'http', status: 503, code: 'EMAIL_SERVICE_UNAVAILABLE' });
  });

  it('uses safe session, access and server messages without exposing raw 5xx details', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ message: 'private session diagnostics' }) })
      .mockResolvedValueOnce({ ok: false, status: 403, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ message: 'private permission diagnostics' }) })
      .mockResolvedValueOnce({ ok: false, status: 500, headers: new Headers({ 'content-type': 'application/json', 'x-request-id': 'req-safe-123' }), json: async () => ({ message: 'raw SQL and stack details' }) }));
    await expect(apiGet('/workspace')).rejects.toMatchObject({ status: 401, message: 'Your session has expired. Sign in again.' });
    await expect(apiGet('/workspace')).rejects.toMatchObject({ status: 403, message: 'You do not have permission to complete this request.' });
    await expect(apiGet('/workspace')).rejects.toMatchObject({ status: 500, message: 'The server could not complete this request. Try again. Reference: req-safe-123', requestId: 'req-safe-123' });
  });

  it('aborts on caller cancellation and applies its timeout', async () => {
    const caller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    })));
    const cancelled = apiGet('/health', caller.signal);
    const cancellationOutcome = cancelled.then(() => null, (error: unknown) => error);
    caller.abort();
    expect(await cancellationOutcome).toBeDefined();

    // End the cancelled shared GET before switching clocks; its StrictMode
    // grace timer and timeout were created with real timers.
    clearPendingApiGets();
    vi.useFakeTimers();
    const timed = apiGet('/health');
    const timeoutOutcome = timed.then(() => null, (error: unknown) => error);
    await vi.advanceTimersByTimeAsync(8000);
    const timeoutError = await timeoutOutcome;
    expect(timeoutError).toBeInstanceOf(ApiError);
    expect(timeoutError).toMatchObject({ kind: 'timeout' });
  });

  it('allows an AI request budget and correlation ID without changing ordinary API timeouts', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = apiGet('/playground/chat', undefined, { timeoutMs: 55_000, requestId: 'chat-request-123' });
    const timeoutOutcome = pending.then(() => null, (error: unknown) => error);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-Request-ID': 'chat-request-123' });
    await vi.advanceTimersByTimeAsync(8_001);
    expect(vi.isFakeTimers()).toBe(true);
    await vi.advanceTimersByTimeAsync(46_999);
    expect(await timeoutOutcome).toMatchObject({ kind: 'timeout', requestId: 'chat-request-123' });
  });

  it('delivers correlated SSE events in wire order and waits for the terminal response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response([
      'event: ready\ndata: {"traceId":"trace-1"}\n\n',
      'id: 1\nevent: trace\ndata: {"sequence":1,"operation":"MESSAGE_RECEIVED"}\n\n',
      'id: 2\nevent: trace\ndata: {"sequence":2,"operation":"ANSWER_GENERATION"}\n\n',
      'event: response\ndata: {"reply":"Answer","sessionId":"session-1"}\n\n',
      'event: terminal\ndata: {"status":"SUCCEEDED","lastSequence":2}\n\n',
    ].join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const events: unknown[] = [];
    const state = { ready: false, terminal: false };
    await expect(apiPostEventStream<{ reply: string }, { sequence: number }>('/playground/stream', { message: 'hello' }, undefined, { requestId: 'trace-1' }, {
      onReady: () => { state.ready = true; },
      onEvent: event => events.push(event),
      onTerminal: () => { state.terminal = true; },
    })).resolves.toEqual({ reply: 'Answer', sessionId: 'session-1' });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: expect.objectContaining({ Accept: 'text/event-stream', 'X-Request-ID': 'trace-1' }) });
    expect(state).toEqual({ ready: true, terminal: true });
    expect(events).toEqual([{ sequence: 1, operation: 'MESSAGE_RECEIVED' }, { sequence: 2, operation: 'ANSWER_GENERATION' }]);
  });

  it('rejects invalid JSON instead of treating it as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => { throw new Error('invalid'); } }));
    await expect(apiGet('/health')).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('deduplicates concurrent exact-match GETs while allowing one caller to cancel independently', async () => {
    let resolveResponse!: (response: unknown) => void;
    const fetchMock = vi.fn(() => new Promise((resolve) => { resolveResponse = resolve; }));
    vi.stubGlobal('fetch', fetchMock);
    const cancelledCaller = new AbortController();
    const first = apiGet<{ value: string }>('/workspaces/north', cancelledCaller.signal);
    const second = apiGet<{ value: string }>('/workspaces/north');
    const firstOutcome = first.then(() => null, (error: unknown) => error);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    cancelledCaller.abort();
    expect(await firstOutcome).toBeDefined();
    resolveResponse({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ value: 'authorized' }) });
    await expect(second).resolves.toEqual({ value: 'authorized' });
  });

  it('keeps concurrent workspace reads isolated by their exact tenant-scoped path', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ url }) }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(Promise.all([apiGet('/workspaces/north'), apiGet('/workspaces/south')])).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
