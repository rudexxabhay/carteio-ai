import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiGet, ApiError } from '../services/api/client';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('API client', () => {
  it('returns a successful JSON response from the same-origin API path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ status: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(apiGet('/health')).resolves.toEqual({ status: 'ok' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/health');
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

  it('aborts on caller cancellation and applies its timeout', async () => {
    const caller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    })));
    const cancelled = apiGet('/health', caller.signal);
    caller.abort();
    await expect(cancelled).rejects.toBeDefined();

    vi.useFakeTimers();
    const timed = apiGet('/health');
    await vi.advanceTimersByTimeAsync(8000);
    await expect(timed).rejects.toBeInstanceOf(ApiError);
    await expect(timed).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('rejects invalid JSON instead of treating it as success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => { throw new Error('invalid'); } }));
    await expect(apiGet('/health')).rejects.toMatchObject({ kind: 'invalid-response' });
  });
});
