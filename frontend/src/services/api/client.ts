import { apiConfig } from '../../config';

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'invalid-response';
export class ApiError extends Error {
  constructor(message: string, readonly kind: ApiErrorKind, readonly status?: number, options?: ErrorOptions, readonly code?: string) {
    super(message, options);
    this.name = 'ApiError';
  }
}

async function apiRequest<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), apiConfig.timeoutMs);
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  if (signal?.aborted) abortFromCaller();
  try {
    const response = await fetch(`${apiConfig.baseUrl}${path.startsWith('/') ? path : `/${path}`}`, {
      method, headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal, credentials: 'same-origin',
    });
    const contentType = response.headers.get('content-type') || '';
    let responseBody: unknown;
    if (contentType.includes('application/json')) {
      try { responseBody = await response.json(); } catch (cause) {
        throw new ApiError('The API returned invalid JSON', 'invalid-response', response.status, { cause });
      }
    }
    if (!response.ok) {
      const message = typeof responseBody === 'object' && responseBody !== null && 'message' in responseBody && typeof responseBody.message === 'string'
        ? responseBody.message : `API request failed with status ${response.status}`;
      const code = typeof responseBody === 'object' && responseBody !== null && 'code' in responseBody && typeof responseBody.code === 'string' ? responseBody.code : undefined;
      throw new ApiError(message, 'http', response.status, undefined, code);
    }
    if (!contentType.includes('application/json') || responseBody === undefined) {
      throw new ApiError('The API returned an unexpected response', 'invalid-response', response.status);
    }
    return responseBody as T;
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    if (signal?.aborted) throw cause;
    if (controller.signal.aborted) throw new ApiError('The request timed out', 'timeout', undefined, { cause });
    throw new ApiError('The API could not be reached', 'network', undefined, { cause });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> { return apiRequest<T>('GET', path, undefined, signal); }
export function apiPost<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> { return apiRequest<T>('POST', path, body, signal); }
export function apiPatch<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> { return apiRequest<T>('PATCH', path, body, signal); }
