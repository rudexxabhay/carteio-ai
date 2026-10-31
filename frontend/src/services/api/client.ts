import { apiConfig } from '../../config';

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'invalid-response';
export class ApiError extends Error {
  constructor(message: string, readonly kind: ApiErrorKind, readonly status?: number, options?: ErrorOptions, readonly code?: string, readonly requestId?: string, readonly details?: unknown) {
    super(message, options);
    this.name = 'ApiError';
  }
}

export type ApiRequestOptions = { timeoutMs?: number; requestId?: string; cache?: RequestCache };

type InFlightGet = { controller: AbortController; promise: Promise<unknown>; subscribers: number; settled: boolean; cancelTimer?: ReturnType<typeof setTimeout> };
const inFlightGets = new Map<string, InFlightGet>();
let sessionGeneration = 0;

/** Session-scoped caches may key private data by this monotonic, non-secret generation. */
export function getApiSessionGeneration() { return sessionGeneration; }

/** Drop pending private reads when the authenticated session ends or becomes invalid. */
export function clearPendingApiGets() {
  sessionGeneration += 1;
  for (const request of inFlightGets.values()) {
    if (request.cancelTimer) clearTimeout(request.cancelTimer);
    request.controller.abort(new DOMException('Session context changed', 'AbortError'));
  }
  inFlightGets.clear();
}

async function apiRequest<T>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown, signal?: AbortSignal, options: ApiRequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? apiConfig.timeoutMs, 60_000));
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (signal?.aborted) abortFromCaller();
  try {
    const response = await fetch(`${apiConfig.baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
      method, headers: { Accept: 'application/json', ...(options.requestId ? { 'X-Request-ID': options.requestId } : {}), ...(body === undefined || (typeof FormData !== 'undefined' && body instanceof FormData) ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: typeof FormData !== 'undefined' && body instanceof FormData ? body : JSON.stringify(body) }), signal: controller.signal, credentials: 'same-origin', ...(options.cache ? { cache: options.cache } : {}),
    });
    const contentType = response.headers.get('content-type') || '';
    let responseBody: unknown;
    if (contentType.includes('application/json')) {
      try { responseBody = await response.json(); } catch (cause) {
        throw new ApiError('The API returned invalid JSON', 'invalid-response', response.status, { cause });
      }
    }
    if (!response.ok) {
      const responseMessage = typeof responseBody === 'object' && responseBody !== null && 'message' in responseBody ? responseBody.message : undefined;
      const code = typeof responseBody === 'object' && responseBody !== null && 'code' in responseBody && typeof responseBody.code === 'string' ? responseBody.code : undefined;
      const details = typeof responseBody === 'object' && responseBody !== null && 'diagnostics' in responseBody ? responseBody.diagnostics : undefined;
      const fieldErrors = typeof responseBody === 'object' && responseBody !== null && 'details' in responseBody && Array.isArray(responseBody.details)
        ? responseBody.details.filter((item): item is string => typeof item === 'string').slice(0, 10)
        : [];
      const requestId = response.headers.get('x-request-id') || options.requestId;
      const message = response.status === 401 ? 'Your session has expired. Sign in again.'
        : response.status === 403 ? 'You do not have permission to complete this request.'
          : response.status >= 500 ? `The server could not complete this request. Try again.${requestId ? ` Reference: ${requestId}` : ''}`
          : typeof responseMessage === 'string' ? `${responseMessage}${response.status === 400 && code === 'VALIDATION_ERROR' && fieldErrors.length ? ` (${fieldErrors.join('; ')})` : ''}`
        : Array.isArray(responseMessage) && responseMessage.every((item) => typeof item === 'string')
          ? responseMessage.join(' ') : `API request failed with status ${response.status}`;
      if (response.status === 401) clearPendingApiGets();
      throw new ApiError(message, 'http', response.status, undefined, code, requestId, details);
    }
    if (!contentType.includes('application/json') || responseBody === undefined) {
      throw new ApiError('The API returned an unexpected response', 'invalid-response', response.status, undefined, undefined, response.headers.get('x-request-id') || options.requestId);
    }
    return responseBody as T;
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    if (signal?.aborted) throw cause;
    if (controller.signal.aborted) throw new ApiError('The server request timed out. Check your connection and try again.', 'timeout', undefined, { cause }, undefined, options.requestId);
    throw new ApiError('Carteio could not reach the server. Check your internet connection and try again.', 'network', undefined, { cause });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function apiGet<T>(path: string, signal?: AbortSignal, options: ApiRequestOptions = {}): Promise<T> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'));
  const key = `${sessionGeneration}:${path}:${options.timeoutMs ?? ''}:${options.cache ?? ''}:${options.requestId ?? ''}`;
  let request = inFlightGets.get(key);
  if (!request) {
    const controller = new AbortController();
    const next: InFlightGet = { controller, promise: Promise.resolve(), subscribers: 0, settled: false };
    next.promise = apiRequest<T>('GET', path, undefined, controller.signal, options).finally(() => {
      next.settled = true;
      if (next.cancelTimer) clearTimeout(next.cancelTimer);
      if (inFlightGets.get(key) === next) inFlightGets.delete(key);
    });
    request = next;
    inFlightGets.set(key, next);
  }

  const shared = request;
  if (shared.cancelTimer) { clearTimeout(shared.cancelTimer); shared.cancelTimer = undefined; }
  shared.subscribers += 1;

  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const release = () => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      shared.subscribers = Math.max(0, shared.subscribers - 1);
      if (shared.subscribers === 0 && !shared.settled) {
        // Let same-tick StrictMode remounts subscribe before cancelling the shared read.
        shared.cancelTimer = setTimeout(() => {
          if (shared.subscribers === 0 && !shared.settled) {
            if (inFlightGets.get(key) === shared) inFlightGets.delete(key);
            shared.controller.abort(new DOMException('All request consumers cancelled', 'AbortError'));
          }
        }, 0);
      }
    };
    const abort = () => { reject(signal?.reason ?? new DOMException('Request aborted', 'AbortError')); release(); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    shared.promise.then((value) => {
      if (signal?.aborted) reject(signal.reason ?? new DOMException('Request aborted', 'AbortError'));
      else resolve(value as T);
      release();
    }, (cause: unknown) => { reject(cause); release(); });
  });
}
export function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal, options?: ApiRequestOptions): Promise<T> { return apiRequest<T>('POST', path, body, signal, options); }
export async function apiPostEventStream<T, E>(path: string, body: unknown, signal: AbortSignal | undefined, options: ApiRequestOptions, handlers: { onReady?: (value: unknown) => void; onEvent: (event: E) => void; onTerminal?: (value: unknown) => void }): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = Math.max(1000, Math.min(options.timeoutMs ?? 55_000, 60_000));
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (signal?.aborted) abortFromCaller();
  try {
    const response = await fetch(`${apiConfig.baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
      method: 'POST', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', ...(options.requestId ? { 'X-Request-ID': options.requestId } : {}) },
      body: JSON.stringify(body), signal: controller.signal, credentials: 'same-origin', cache: 'no-store',
    });
    if (!response.ok) {
      let payload: unknown;
      try { payload = await response.json(); } catch { payload = undefined; }
      const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
      const requestId = response.headers.get('x-request-id') || options.requestId;
      if (response.status === 401) clearPendingApiGets();
      throw new ApiError(response.status === 401 ? 'Your session has expired. Sign in again.' : response.status === 403 ? 'You do not have permission to complete this request.' : typeof record.message === 'string' ? record.message : `API request failed with status ${response.status}`, 'http', response.status, undefined, typeof record.code === 'string' ? record.code : undefined, requestId, record.diagnostics);
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new ApiError('Live trace stream is unavailable.', 'invalid-response', response.status, undefined, 'PLAYGROUND_STREAM_UNAVAILABLE', options.requestId);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: T | undefined;
    let failure: ApiError | undefined;
    let terminalSeen = false;
    const dispatch = (frame: string) => {
      const lines = frame.split(/\r?\n/);
      const eventName = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
      const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (!eventName || !data) return;
      let payload: unknown;
      try { payload = JSON.parse(data); } catch { return; }
      if (eventName === 'ready') handlers.onReady?.(payload);
      else if (eventName === 'trace') handlers.onEvent(payload as E);
      else if (eventName === 'response') result = payload as T;
      else if (eventName === 'failure') {
        const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {};
        failure = new ApiError(typeof record.message === 'string' ? record.message : 'The Playground request could not be completed.', 'http', response.status, undefined, typeof record.code === 'string' ? record.code : undefined, options.requestId, record.diagnostics);
      } else if (eventName === 'terminal') { terminalSeen = true; handlers.onTerminal?.(payload); }
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        const delimiter = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n';
        buffer = buffer.slice(boundary + delimiter.length);
        dispatch(frame);
        boundary = buffer.search(/\r?\n\r?\n/);
      }
      if (done) break;
    }
    if (failure) throw failure;
    if (!result || !terminalSeen) throw new ApiError('The live trace disconnected before the final response.', 'network', undefined, undefined, 'PLAYGROUND_STREAM_INCOMPLETE', options.requestId);
    return result;
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    if (signal?.aborted) throw cause;
    if (controller.signal.aborted) throw new ApiError('The Playground request timed out or was cancelled.', 'timeout', undefined, { cause }, 'PLAYGROUND_STREAM_TIMEOUT', options.requestId);
    throw new ApiError('The live Playground stream was interrupted.', 'network', undefined, { cause }, 'PLAYGROUND_STREAM_INCOMPLETE', options.requestId);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}
export function apiPatch<T>(path: string, body: unknown, signal?: AbortSignal, options?: ApiRequestOptions): Promise<T> { return apiRequest<T>('PATCH', path, body, signal, options); }
export function apiPut<T>(path: string, body: unknown, signal?: AbortSignal, options?: ApiRequestOptions): Promise<T> { return apiRequest<T>('PUT', path, body, signal, options); }
export function apiDelete<T>(path: string, signal?: AbortSignal, options?: ApiRequestOptions): Promise<T> { return apiRequest<T>('DELETE', path, undefined, signal, options); }
export function apiDeleteWithBody<T>(path: string, body: unknown, signal?: AbortSignal, options?: ApiRequestOptions): Promise<T> { return apiRequest<T>('DELETE', path, body, signal, options); }
