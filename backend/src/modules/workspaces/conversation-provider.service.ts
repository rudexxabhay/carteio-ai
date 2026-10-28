import { BadGatewayException, GatewayTimeoutException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export type ConversationProvider = 'groq' | 'gemini' | 'openai' | 'openrouter';
export type ConversationStage = 'intent_interpretation' | 'query_interpretation' | 'grounded_answer';
export type ConversationProviderMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string; tool_calls?: readonly Readonly<{ id: string; type: 'function'; function: { name: string; arguments: string } }>[] }
  | { role: 'tool'; tool_call_id: string; name: string; content: string };
/** Provider-neutral function tools. Schemas are server-authored and arguments remain untrusted until validated by a handler. */
export type ConversationToolDefinition = Readonly<{ name: string; description: string; parameters: Readonly<Record<string, unknown>> }>;
export type ConversationToolCall = Readonly<{ id: string; name: string; arguments: string }>;
/** Native function calling is supported by the current Gemini GenerateContent and OpenAI-compatible adapters. */
export const supportsProviderToolProtocol = (provider: ConversationProvider, model?: string) => provider === 'gemini'
  ? isSupportedGeminiModel(model?.trim() ?? '')
  : provider === 'openai'
  ? /^gpt-(?:4o|4\.1|5)(?:[-.][A-Za-z0-9]+)*$/i.test(model?.trim() ?? '')
  : provider === 'groq' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(model?.trim() ?? ''); // OpenRouter requires explicit metadata validation.
export type ConversationProviderRequest = {
  provider: ConversationProvider;
  model: string;
  messages: ConversationProviderMessage[];
  maxCompletionTokens: number;
  requestId: string;
  organizationId: string;
  assistantId: string;
  stage: ConversationStage;
  /** 1-based route attempt for this orchestration stage; never content-derived. */
  attemptIndex?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  responseFormat?: 'text' | 'json_object';
  reasoningEffort?: 'low' | 'medium' | 'high';
  tools?: readonly ConversationToolDefinition[];
  /** Internal diagnostic hook; invoked immediately before the outbound fetch. */
  onRequestDispatched?: () => void;
};
export type ConversationProviderUsage = { inputTokens?: number; outputTokens?: number; totalTokens?: number };
export type ConversationProviderResult = { provider: ConversationProvider; model: string; content: string; finishReason: 'stop' | 'tool_calls'; toolCalls?: readonly ConversationToolCall[]; usage?: ConversationProviderUsage };
export type ProviderFailureCategory = 'missing_key' | 'authentication' | 'model_unavailable' | 'rate_limited' | 'invalid_request' | 'temporary_unavailable' | 'timeout' | 'network' | 'invalid_response' | 'incomplete' | 'empty_response' | 'truncated' | 'safety_blocked';
export type ProviderRoute = { provider: ConversationProvider; model: string };

export const SUPPORTED_GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-2.5-flash'] as const;
export const isSupportedGeminiModel = (model: string) => (SUPPORTED_GEMINI_MODELS as readonly string[]).includes(model.trim());
export const isCredentialLikeProviderValue = (value: string) => /(?:gsk_|sk-|sk_|AIza|sess-|Bearer\s)/i.test(value);
const providerModelPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/;
export const isValidProviderModel = (provider: unknown, model: unknown): model is string =>
  (provider === 'groq' || provider === 'gemini' || provider === 'openai' || provider === 'openrouter')
  && typeof model === 'string'
  && model.trim().length > 0
  && providerModelPattern.test(model.trim())
  && !isCredentialLikeProviderValue(model)
  && (provider !== 'openrouter' || /^[A-Za-z0-9._-]{1,64}\/[A-Za-z0-9._:-]{1,96}$/.test(model.trim()))
  && (provider !== 'gemini' || isSupportedGeminiModel(model));
export const isValidProviderRoute = (value: unknown): value is ProviderRoute => {
  if (typeof value !== 'object' || value === null || Array.isArray(value) || !('provider' in value) || !('model' in value)) return false;
  return isValidProviderModel(value.provider, value.model);
};
const isConversationProvider = (value: unknown): value is ConversationProvider => value === 'groq' || value === 'gemini' || value === 'openai' || value === 'openrouter';
export type EffectiveProviderConfiguration = {
  provider: ConversationProvider | null;
  model: string | null;
  configurationStatus: 'READY_FOR_TESTING' | 'MISSING_PROVIDER' | 'INVALID_PROVIDER' | 'MISSING_MODEL' | 'INVALID_MODEL' | 'INVALID_ENDPOINT' | 'MISSING_API_KEY';
  configurationValid: boolean;
  keyConfigured: boolean;
  ready: boolean;
};
type ProviderEnvironment = {
  AI_DEFAULT_PROVIDER?: string;
  GROQ_MODEL?: string;
  GEMINI_MODEL?: string;
  OPENAI_MODEL?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_BASE_URL?: string;
  GROQ_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
};
let effectiveProviderSnapshot: EffectiveProviderConfiguration | undefined;
let providerCredentialSnapshot: Record<ConversationProvider, boolean> | undefined;
const providerCredentialPresence = (env: ProviderEnvironment): Record<ConversationProvider, boolean> => ({
  groq: Boolean(env.GROQ_API_KEY?.trim()),
  gemini: Boolean(env.GEMINI_API_KEY?.trim()),
  openai: Boolean(env.OPENAI_API_KEY?.trim()),
  openrouter: Boolean(env.OPENROUTER_API_KEY?.trim()),
});

export function resolveEffectiveProviderConfiguration(env: ProviderEnvironment): EffectiveProviderConfiguration {
  const rawProvider = env.AI_DEFAULT_PROVIDER?.trim().toLowerCase();
  if (!rawProvider) return { provider: null, model: null, configurationStatus: 'MISSING_PROVIDER', configurationValid: false, keyConfigured: false, ready: false };
  if (!isConversationProvider(rawProvider)) return { provider: null, model: null, configurationStatus: 'INVALID_PROVIDER', configurationValid: false, keyConfigured: false, ready: false };
  const keyName = rawProvider === 'groq' ? 'GROQ_API_KEY' : rawProvider === 'gemini' ? 'GEMINI_API_KEY' : rawProvider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'OPENAI_API_KEY';
  const keyConfigured = Boolean(env[keyName]?.trim());
  const modelValue = rawProvider === 'groq' ? env.GROQ_MODEL : rawProvider === 'gemini' ? env.GEMINI_MODEL : rawProvider === 'openrouter' ? env.OPENROUTER_MODEL : env.OPENAI_MODEL;
  if (!modelValue?.trim()) return { provider: rawProvider, model: null, configurationStatus: 'MISSING_MODEL', configurationValid: false, keyConfigured, ready: false };
  const model = modelValue.trim();
  if (!isValidProviderModel(rawProvider, model)) return { provider: rawProvider, model: null, configurationStatus: 'INVALID_MODEL', configurationValid: false, keyConfigured, ready: false };
  if (rawProvider === 'openrouter' && env.OPENROUTER_BASE_URL && !isSafeOpenRouterBaseUrl(env.OPENROUTER_BASE_URL)) return { provider: rawProvider, model, configurationStatus: 'INVALID_ENDPOINT', configurationValid: false, keyConfigured, ready: false };
  return { provider: rawProvider, model, configurationStatus: keyConfigured ? 'READY_FOR_TESTING' : 'MISSING_API_KEY', configurationValid: true, keyConfigured, ready: keyConfigured };
}

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
function isSafeOpenRouterBaseUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'openrouter.ai' && !url.port && !url.username && !url.password && !url.search && !url.hash && url.pathname.replace(/\/$/, '') === '/api/v1'; }
  catch { return false; }
}

/** Called once after the backend has loaded and validated its environment. */
export function initializeEffectiveProviderConfiguration(env: ProviderEnvironment = process.env): EffectiveProviderConfiguration {
  effectiveProviderSnapshot = resolveEffectiveProviderConfiguration(env);
  providerCredentialSnapshot = providerCredentialPresence(env);
  return effectiveProviderSnapshot;
}

/** Safe process snapshot; never contains credential values. */
export function getEffectiveProviderConfiguration(): EffectiveProviderConfiguration {
  return effectiveProviderSnapshot ?? initializeEffectiveProviderConfiguration();
}
function getProviderCredentialPresence(): Record<ConversationProvider, boolean> {
  if (!providerCredentialSnapshot) initializeEffectiveProviderConfiguration();
  return providerCredentialSnapshot ?? providerCredentialPresence({});
}
export const isTransientProviderFailure = (error: unknown) => {
  if (!(error instanceof HttpException)) return false;
  const response = error.getResponse();
  if (!response || typeof response !== 'object' || !('code' in response)) return false;
  return ['PLAYGROUND_PROVIDER_TIMEOUT', 'PLAYGROUND_PROVIDER_UNAVAILABLE', 'PLAYGROUND_PROVIDER_TEMPORARILY_UNAVAILABLE', 'PLAYGROUND_PROVIDER_RATE_LIMITED'].includes(String(response.code));
};

function boundedRetryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value.trim());
  const seconds = Number.isFinite(numeric) && numeric >= 0 ? Math.ceil(numeric) : Math.ceil((Date.parse(value) - now) / 1000);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : undefined;
}

const isGroqGptOss = (provider: ConversationProvider, model: string) => provider === 'groq' && /^openai\/gpt-oss-(?:20b|120b)$/i.test(model.trim());

type Diagnostic = Pick<ConversationProviderRequest, 'requestId' | 'organizationId' | 'assistantId' | 'stage' | 'attemptIndex'>;
type ProviderAdapter = { readonly provider: ConversationProvider; complete(request: ConversationProviderRequest, apiKey: string): Promise<ConversationProviderResult> };
type NormalizedProviderOutput = { text: string; finishReason: string; responseShape: 'valid' | 'empty' | 'malformed'; toolCalls?: readonly ConversationToolCall[]; usage?: ConversationProviderResult['usage']; safetyBlocked?: boolean };
type UnknownRecord = Record<string, unknown>;
const asRecord = (value: unknown): UnknownRecord | null => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as UnknownRecord : null;
const isTokenCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isTimeoutAbortReason = (reason: unknown): boolean => typeof reason === 'object' && reason !== null && 'name' in reason && reason.name === 'TimeoutError';
const SAFE_GOOGLE_ERROR_STATUSES = new Set(['INVALID_ARGUMENT', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND', 'RESOURCE_EXHAUSTED', 'FAILED_PRECONDITION', 'INTERNAL', 'UNAVAILABLE', 'DEADLINE_EXCEEDED']);

/** Extract only documented enum-like fields; never retain or log Google's free-form error message. */
async function safeGeminiErrorMetadata(response: Response): Promise<{ providerStatus?: string; providerReason?: string }> {
  if (!response.body) return {};
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (bytes < 8192) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = 8192 - bytes;
      const chunk = value.subarray(0, remaining);
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
      if (chunk.byteLength < value.byteLength) break;
    }
    await reader.cancel();
  } catch {
    // Provider diagnostics are optional and must never replace the HTTP failure.
  } finally {
    reader.releaseLock();
  }
  try {
    const payload = asRecord(JSON.parse(text));
    const error = asRecord(payload?.error);
    const providerStatus = typeof error?.status === 'string' && SAFE_GOOGLE_ERROR_STATUSES.has(error.status) ? error.status : undefined;
    const details = Array.isArray(error?.details) ? error.details : [];
    const info = details.map(asRecord).find((detail) => detail?.['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo');
    const reason = typeof info?.reason === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(info.reason) ? info.reason : undefined;
    return { ...(providerStatus ? { providerStatus } : {}), ...(reason ? { providerReason: reason } : {}) };
  } catch {
    return {};
  }
}

/** Inspect only a bounded, known schema rejection signal; never return provider prose. */
async function isStructuredOutputRejected(response: Response): Promise<boolean> {
  if (!response.body) return false;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (bytes < 4096) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const chunk = value.subarray(0, 4096 - bytes);
      bytes += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
      if (chunk.byteLength < value.byteLength) break;
    }
    await reader.cancel();
  } catch { /* A classification hint must not replace the provider error. */ }
  finally { reader.releaseLock(); }
  try {
    const root = asRecord(JSON.parse(text));
    const error = asRecord(root?.error);
    const message = typeof error?.message === 'string' ? error.message.slice(0, 2048) : '';
    return /response[_ -]?format|json[_ -]?object|structured[_ -]?output/iu.test(message)
      && /unsupported|not supported|does not support|unknown parameter|invalid (?:request )?parameter/iu.test(message);
  } catch { return false; }
}

abstract class BaseProviderAdapter implements ProviderAdapter {
  abstract readonly provider: ConversationProvider;
  protected abstract endpoint(model: string): string;
  protected abstract headers(apiKey: string): Record<string, string>;
  protected abstract body(request: ConversationProviderRequest): unknown;
  protected abstract normalize(payload: unknown): NormalizedProviderOutput;
  protected readonly logger = new Logger(ConversationProviderService.name);

  async complete(request: ConversationProviderRequest, apiKey: string): Promise<ConversationProviderResult> {
    const startedAt = Date.now();
    const diagnostic: Diagnostic = { requestId: request.requestId, organizationId: request.organizationId, assistantId: request.assistantId, stage: request.stage, ...(request.attemptIndex ? { attemptIndex: request.attemptIndex } : {}) };
    const diagnosticModel = isValidProviderModel(this.provider, request.model) ? request.model.trim() : 'invalid_model';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DOMException('Provider request timed out', 'TimeoutError')), Math.max(1000, Math.min(request.timeoutMs ?? 25_000, 60_000)));
    const abortFromCaller = () => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) abortFromCaller();
    else request.signal?.addEventListener('abort', abortFromCaller, { once: true });
    try {
    let response: Response;
    try {
      const url = this.endpoint(request.model);
      const headers = this.headers(apiKey);
      const body = JSON.stringify(this.body(request));
      request.onRequestDispatched?.();
      response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    } catch (error) {
      if (request.signal?.aborted) {
        this.logFailure(request, diagnostic, 'PLAYGROUND_REQUEST_CANCELLED', undefined, startedAt);
        throw error;
      }
      const timedOut = isTimeoutAbortReason(controller.signal.reason);
      const knownTransportFailure = error instanceof TypeError;
      const code = timedOut ? 'PLAYGROUND_PROVIDER_TIMEOUT' : knownTransportFailure ? 'PLAYGROUND_PROVIDER_UNAVAILABLE' : 'PLAYGROUND_PROVIDER_REQUEST_FAILED';
      this.logFailure(request, diagnostic, code, undefined, startedAt);
      if (timedOut) throw new GatewayTimeoutException({ code, message: 'The selected AI provider timed out. Try again.' });
      if (knownTransportFailure) throw new ServiceUnavailableException({ code, message: 'The selected AI provider could not be reached. Check the backend network connection and try again.' });
      throw new BadGatewayException({ code, message: 'The selected AI provider request could not be completed.' });
    }
    if (!response.ok) {
      let providerError: { providerStatus?: string; providerReason?: string } = {};
      const structuredOutputRejected = this.provider === 'openrouter' && request.responseFormat === 'json_object'
        && (response.status === 400 || response.status === 422) && await isStructuredOutputRejected(response);
      if (this.provider === 'gemini') providerError = await safeGeminiErrorMetadata(response);
      else if (!structuredOutputRejected && response.body) {
        void response.body.cancel().catch(() => {
          // Keep the classified customer-safe HTTP failure if cleanup races.
        });
      }
      const status = response.status;
      const retryAfterSeconds = status === 429 ? boundedRetryAfterSeconds(response.headers.get('retry-after')) : undefined;
      const category = structuredOutputRejected ? 'PLAYGROUND_PROVIDER_STRUCTURED_OUTPUT_UNSUPPORTED'
        : status === 429 ? 'PLAYGROUND_PROVIDER_RATE_LIMITED'
        : status === 401 || status === 403 ? 'PLAYGROUND_PROVIDER_AUTH_REJECTED'
          : status === 404 ? 'PLAYGROUND_PROVIDER_MODEL_UNAVAILABLE'
          : status === 402 ? 'PLAYGROUND_PROVIDER_PAYMENT_REQUIRED'
            : status === 400 || status === 422 ? 'PLAYGROUND_PROVIDER_REQUEST_INVALID'
              : status >= 500 ? 'PLAYGROUND_PROVIDER_TEMPORARILY_UNAVAILABLE' : 'PLAYGROUND_PROVIDER_REQUEST_FAILED';
      this.logFailure(request, diagnostic, category, status, startedAt, undefined, providerError);
      if (category === 'PLAYGROUND_PROVIDER_STRUCTURED_OUTPUT_UNSUPPORTED') throw new BadGatewayException({ code: category, message: 'The selected OpenRouter model rejected JSON response mode. Retrying this interpretation once with server-validated prompt-only JSON.' });
      if (category === 'PLAYGROUND_PROVIDER_RATE_LIMITED') throw new HttpException({ code: category, message: retryAfterSeconds ? `The selected AI provider is rate limiting requests. Retry after ${retryAfterSeconds} seconds.` : 'The selected AI provider is rate limiting requests. Try again shortly.', ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }, HttpStatus.TOO_MANY_REQUESTS);
      if (category === 'PLAYGROUND_PROVIDER_PAYMENT_REQUIRED') throw new HttpException({ code: category, message: 'The selected AI provider account requires credits or billing attention.' }, HttpStatus.PAYMENT_REQUIRED);
      if (category === 'PLAYGROUND_PROVIDER_AUTH_REJECTED') throw new BadGatewayException({ code: category, message: 'The selected provider rejected its credential or access permissions. Check the backend provider configuration.' });
      if (category === 'PLAYGROUND_PROVIDER_MODEL_UNAVAILABLE') throw new BadGatewayException({ code: category, message: 'The provider returned HTTP 404. Check the provider endpoint, model availability, and project access.' });
      if (category === 'PLAYGROUND_PROVIDER_REQUEST_INVALID') throw new BadGatewayException({ code: category, message: 'The selected provider rejected the chat request. Check the model and supported request settings.' });
      throw new ServiceUnavailableException({ code: category, message: status >= 500 ? 'The selected AI provider is temporarily unavailable. Try again shortly.' : 'The selected AI provider could not complete this turn.' });
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch (error) {
      if (request.signal?.aborted) {
        this.logFailure(request, diagnostic, 'PLAYGROUND_REQUEST_CANCELLED', response.status, startedAt);
        throw error;
      }
      const timedOut = isTimeoutAbortReason(controller.signal.reason);
      if (timedOut) {
        this.logFailure(request, diagnostic, 'PLAYGROUND_PROVIDER_TIMEOUT', response.status, startedAt);
        throw new GatewayTimeoutException({ code: 'PLAYGROUND_PROVIDER_TIMEOUT', message: 'The selected AI provider timed out. Try again.' });
      }
      if (error instanceof TypeError) {
        this.logFailure(request, diagnostic, 'PLAYGROUND_PROVIDER_UNAVAILABLE', response.status, startedAt);
        throw new ServiceUnavailableException({ code: 'PLAYGROUND_PROVIDER_UNAVAILABLE', message: 'The selected AI provider could not complete the response. Try again shortly.' });
      }
      this.logFailure(request, diagnostic, 'PLAYGROUND_PROVIDER_INVALID_RESPONSE', response.status, startedAt, { choicesPresent: false, usableContentPresent: false, finishReasonCategory: 'unknown' });
      throw new BadGatewayException({ code: 'PLAYGROUND_PROVIDER_INVALID_RESPONSE', message: 'The selected AI provider returned an invalid response. Try again.' });
    }
    const normalized = this.normalize(payload);
    if (normalized.safetyBlocked) {
      this.logFailure(request, diagnostic, 'PLAYGROUND_PROVIDER_SAFETY_BLOCKED', response.status, startedAt, { choicesPresent: true, usableContentPresent: false, finishReasonCategory: 'safety_blocked' });
      throw new BadGatewayException({ code: 'PLAYGROUND_PROVIDER_SAFETY_BLOCKED', message: 'The selected provider blocked this response under its safety policy. Review the request and try again.' });
    }
    const hasText = Boolean(normalized.text.trim());
    if (normalized.toolCalls?.length) {
      const allowedNames = new Set((request.tools ?? []).map((tool) => tool.name));
      const ids = new Set<string>();
      const validCalls = request.tools?.length && normalized.toolCalls.every((call) => {
        if (!allowedNames.has(call.name) || ids.has(call.id)) return false;
        ids.add(call.id);
        try {
          const args = JSON.parse(call.arguments) as unknown;
          return typeof args === 'object' && args !== null && !Array.isArray(args);
        } catch { return false; }
      });
      if (!validCalls) {
        this.logFailure(request, diagnostic, 'PLAYGROUND_PROVIDER_INVALID_RESPONSE', undefined, startedAt, { choicesPresent: true, usableContentPresent: false, finishReasonCategory: 'invalid_tool_call' });
        throw new BadGatewayException({ code: 'PLAYGROUND_PROVIDER_INVALID_RESPONSE', message: 'The selected AI provider returned an invalid tool request. Retry the message.' });
      }
    }
    const hasToolCalls = normalized.finishReason === 'tool_calls' && (normalized.toolCalls?.length ?? 0) > 0;
    const code = normalized.finishReason === 'length' ? 'PLAYGROUND_PROVIDER_OUTPUT_TRUNCATED'
      : normalized.responseShape === 'malformed' ? 'PLAYGROUND_PROVIDER_INVALID_RESPONSE'
        : normalized.responseShape === 'empty' && (normalized.finishReason === 'unknown' || normalized.finishReason === 'stop') ? 'PLAYGROUND_PROVIDER_EMPTY_RESPONSE'
      : normalized.finishReason !== 'stop' && normalized.finishReason !== 'tool_calls' ? 'PLAYGROUND_PROVIDER_INCOMPLETE_RESPONSE'
          : !hasText && !hasToolCalls ? 'PLAYGROUND_PROVIDER_EMPTY_RESPONSE'
            : normalized.text.length > 8000 ? 'PLAYGROUND_PROVIDER_OUTPUT_TRUNCATED' : null;
    if (code) {
      this.logFailure(request, diagnostic, code, response.status, startedAt, { ...this.responseShapeDiagnostic(payload, normalized), choicesPresent: this.hasCandidate(payload), usableContentPresent: false, finishReasonCategory: normalized.finishReason });
      const message = code === 'PLAYGROUND_PROVIDER_OUTPUT_TRUNCATED' ? 'The provider response was cut off before completion. Retry the message.'
        : code === 'PLAYGROUND_PROVIDER_EMPTY_RESPONSE' ? 'The selected AI provider returned no usable text. Try again.'
          : code === 'PLAYGROUND_PROVIDER_INCOMPLETE_RESPONSE' ? 'The selected AI provider did not complete its response. Retry the message.'
            : 'The selected AI provider returned an unexpected response. Try again.';
      throw new BadGatewayException({ code, message });
    }
    this.logger.debug(JSON.stringify({ event: 'conversation_provider_completion', requestId: request.requestId, organizationId: request.organizationId, assistantId: request.assistantId, stage: request.stage, ...(request.attemptIndex ? { attemptIndex: request.attemptIndex } : {}), provider: this.provider, model: diagnosticModel, outcome: 'COMPLETED', status: response.status, finishReasonCategory: normalized.finishReason, usableContentPresent: true, ...(normalized.usage ? { usage: normalized.usage } : {}), durationMs: Date.now() - startedAt }));
    return { provider: this.provider, model: request.model, content: normalized.text, finishReason: hasToolCalls ? 'tool_calls' : 'stop', ...(hasToolCalls ? { toolCalls: normalized.toolCalls } : {}), ...(normalized.usage ? { usage: normalized.usage } : {}) };
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', abortFromCaller);
    }
  }

  private responseShapeDiagnostic(payload: unknown, normalized: NormalizedProviderOutput) {
    const root = asRecord(payload);
    const choices = Array.isArray(root?.choices) ? root.choices : Array.isArray(root?.candidates) ? root.candidates : [];
    const first = asRecord(choices[0]);
    const message = asRecord(first?.message);
    const geminiContent = asRecord(first?.content);
    const rawContent = message && 'content' in message ? message.content : geminiContent?.parts;
    const contentType = rawContent === null || rawContent === undefined ? 'nullish'
      : Array.isArray(rawContent) ? 'array'
        : typeof rawContent === 'string' ? 'string'
          : typeof rawContent;
    const geminiParts = Array.isArray(geminiContent?.parts) ? geminiContent.parts : [];
    const responseContentLength = typeof rawContent === 'string' ? rawContent.length : Array.isArray(rawContent) ? rawContent.length : null;
    const toolCallPresent = Boolean(
      Array.isArray(message?.tool_calls) && message.tool_calls.length
      || geminiParts.some((part) => { const item = asRecord(part); return Boolean(asRecord(item?.functionCall)); }),
    );
    return {
      choiceCount: choices.length,
      responseContentType: contentType,
      responseContentLength,
      normalizedTextLength: normalized.text.length,
      toolCallPresent,
      normalizationOutcome: normalized.responseShape,
      ...(normalized.usage ? { usage: normalized.usage } : {}),
    };
  }

  protected logFailure(request: ConversationProviderRequest, diagnostic: Diagnostic, code: string, status: number | undefined, startedAt: number, shape?: { choicesPresent: boolean; usableContentPresent: boolean; finishReasonCategory: string; choiceCount?: number; responseContentType?: string; responseContentLength?: number | null; normalizedTextLength?: number; toolCallPresent?: boolean; normalizationOutcome?: string; usage?: ConversationProviderResult['usage'] }, providerError?: { providerStatus?: string; providerReason?: string }) {
    const model = isValidProviderModel(this.provider, request.model) ? request.model.trim() : 'invalid_model';
    const outcome = code === 'PLAYGROUND_REQUEST_CANCELLED' ? 'CANCELLED' : code === 'PLAYGROUND_PROVIDER_TIMEOUT' ? 'TIMED_OUT' : 'FAILED';
    this.logger.warn(JSON.stringify({ event: 'conversation_provider_failure', ...diagnostic, provider: this.provider, model, outcome, code, ...(status ? { status } : {}), ...(shape ?? {}), ...(providerError ?? {}), durationMs: Date.now() - startedAt }));
  }
  private hasCandidate(payload: unknown) {
    const root = asRecord(payload);
    return Array.isArray(root?.choices) ? root.choices.length > 0 : Array.isArray(root?.candidates) && root.candidates.length > 0;
  }
}

export class OpenAICompatibleAdapter extends BaseProviderAdapter {
  constructor(readonly provider: 'groq' | 'openai' | 'openrouter') { super(); }
  protected endpoint(_model: string) {
    if (this.provider === 'groq') return 'https://api.groq.com/openai/v1/chat/completions';
    if (this.provider === 'openai') return 'https://api.openai.com/v1/chat/completions';
    const base = process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_OPENROUTER_BASE_URL;
    if (!isSafeOpenRouterBaseUrl(base)) throw new ServiceUnavailableException({ code: 'OPENROUTER_BASE_URL_INVALID', message: 'OpenRouter base URL must use the official HTTPS API origin.' });
    return `${base.replace(/\/$/, '')}/chat/completions`;
  }
  protected headers(apiKey: string) { return { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }; }
  protected body(request: ConversationProviderRequest) {
    return { model: request.model, messages: request.messages, ...(this.provider === 'openrouter' ? {} : { temperature: 0.2 }),
      ...(this.provider === 'groq' ? { max_completion_tokens: request.maxCompletionTokens } : { max_tokens: request.maxCompletionTokens }),
      ...(isGroqGptOss(this.provider, request.model) ? { reasoning_effort: 'low', include_reasoning: false } : {}),
      ...(request.responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
      ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters, strict: true } })), tool_choice: 'auto', parallel_tool_calls: false } : {}),
    };
  }
  protected normalize(payload: unknown): NormalizedProviderOutput {
    const value = asRecord(payload);
    if (!value || !Array.isArray(value.choices)) return { text: '', finishReason: 'unknown', responseShape: 'malformed' };
    if (value.choices.length === 0) return { text: '', finishReason: 'unknown', responseShape: 'empty' };
    const choice = asRecord(value.choices[0]);
    const message = asRecord(choice?.message);
    if (!choice || !message) return { text: '', finishReason: 'unknown', responseShape: 'malformed' };
    const content = message.content;
    let text = '';
    if (typeof content === 'string') text = content;
    else if (Array.isArray(content)) {
      const textParts: string[] = [];
      for (const partValue of content) {
        const part = asRecord(partValue);
        if (!part) return { text: '', finishReason: 'unknown', responseShape: 'malformed' };
        if (part.type === 'text' && typeof part.text === 'string') textParts.push(part.text);
      }
      text = textParts.join('');
    } else if (content !== null && content !== undefined) {
      return { text: '', finishReason: 'unknown', responseShape: 'malformed' };
    }
    const reason = choice.finish_reason;
    const finishReason = reason === 'stop' ? 'stop' : reason === 'length' ? 'length' : reason === 'content_filter' ? 'safety_blocked' : typeof reason === 'string' ? 'other' : 'unknown';
    const usage = this.openAIUsage(value.usage);
    const safetyBlocked = finishReason === 'safety_blocked' || (typeof message.refusal === 'string' && message.refusal.length > 0);
    const callsValue = message.tool_calls;
    const toolCalls: ConversationToolCall[] = [];
    if (callsValue !== undefined) {
      if (!Array.isArray(callsValue) || callsValue.length > 4) return { text: '', finishReason: 'unknown', responseShape: 'malformed' };
      for (const callValue of callsValue) {
        const call = asRecord(callValue); const fn = asRecord(call?.function);
        if (!call || typeof call.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(call.id) || call.type !== 'function' || !fn || typeof fn.name !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(fn.name) || typeof fn.arguments !== 'string' || fn.arguments.length > 8192) return { text: '', finishReason: 'unknown', responseShape: 'malformed' };
        toolCalls.push({ id: call.id, name: fn.name, arguments: fn.arguments });
      }
    }
    const normalizedReason = reason === 'tool_calls' && toolCalls.length ? 'tool_calls' : finishReason;
    return { text, finishReason: normalizedReason, responseShape: text.trim() || toolCalls.length ? 'valid' : 'empty', ...(toolCalls.length ? { toolCalls } : {}), ...(usage ? { usage } : {}), safetyBlocked };
  }
  private openAIUsage(value: unknown): ConversationProviderResult['usage'] {
    const usage = asRecord(value);
    const input = usage?.prompt_tokens; const output = usage?.completion_tokens; const total = usage?.total_tokens;
    const normalized = { ...(isTokenCount(input) ? { inputTokens: input } : {}), ...(isTokenCount(output) ? { outputTokens: output } : {}), ...(isTokenCount(total) ? { totalTokens: total } : {}) };
    return Object.keys(normalized).length ? normalized : undefined;
  }
}

export class GeminiProviderAdapter extends BaseProviderAdapter {
  readonly provider = 'gemini' as const;
  protected endpoint(model: string) { return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`; }
  protected headers(apiKey: string) { return { 'x-goog-api-key': apiKey, 'content-type': 'application/json' }; }
  protected body(request: ConversationProviderRequest) {
    const systemInstruction = request.messages.filter((message) => message.role === 'system').map((message) => message.content).join('\n\n');
    const schema = (value: unknown): unknown => {
      const record = asRecord(value);
      if (!record) return value;
      const type = typeof record.type === 'string' ? record.type.toUpperCase() : undefined;
      const properties = asRecord(record.properties);
      return {
        ...(type ? { type } : {}),
        ...(properties ? { properties: Object.fromEntries(Object.entries(properties).map(([key, property]) => [key, schema(property)])) } : {}),
        ...(Array.isArray(record.required) ? { required: record.required.filter((item): item is string => typeof item === 'string') } : {}),
        ...(record.items ? { items: schema(record.items) } : {}),
        ...(typeof record.description === 'string' ? { description: record.description } : {}),
        ...(Array.isArray(record.enum) ? { enum: record.enum } : {}),
      };
    };
    const contents = request.messages.filter((message) => message.role !== 'system').map((message) => {
      if (message.role === 'tool') {
        let response: unknown;
        try { response = JSON.parse(message.content); } catch { response = { error: 'invalid_tool_result' }; }
        return { role: 'user', parts: [{ functionResponse: { name: message.name, id: message.tool_call_id, response: asRecord(response) ?? { result: response } } }] };
      }
      const toolCalls = message.role === 'assistant' ? message.tool_calls ?? [] : [];
      const parts: Array<Record<string, unknown>> = [];
      if (message.content) parts.push({ text: message.content });
      for (const call of toolCalls) {
        let args: unknown;
        try { args = JSON.parse(call.function.arguments); } catch { args = {}; }
        parts.push({ functionCall: { id: call.id, name: call.function.name, args: asRecord(args) ?? {} } });
      }
      return { role: message.role === 'assistant' ? 'model' : 'user', parts };
    });
    return {
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
      contents,
      ...(request.tools?.length ? { tools: [{ functionDeclarations: request.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: schema(tool.parameters) })) }] } : {}),
      generationConfig: {
        maxOutputTokens: request.maxCompletionTokens,
        ...(request.responseFormat === 'json_object' ? { responseMimeType: 'application/json' } : {}),
        ...(/^gemini-3\./i.test(request.model) ? { thinkingConfig: { thinkingLevel: request.reasoningEffort || 'low', includeThoughts: false } } : {}),
      },
    };
  }
  protected normalize(payload: unknown): NormalizedProviderOutput {
    const value = asRecord(payload);
    if (!value) return { text: '', finishReason: 'unknown', responseShape: 'malformed' };
    const feedback = asRecord(value.promptFeedback);
    const blockReason = feedback?.blockReason;
    const candidates = value.candidates;
    const candidateList = Array.isArray(candidates) ? candidates : null;
    const candidate = candidateList?.length ? asRecord(candidateList[0]) : null;
    const content = asRecord(candidate?.content);
    const parts = content?.parts;
    const reason = candidate?.finishReason;
    const safetyBlocked = ['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'RECITATION'].includes(String(reason))
      || (typeof blockReason === 'string' && blockReason !== 'BLOCK_REASON_UNSPECIFIED');
    const finishReason = safetyBlocked ? 'safety_blocked' : reason === 'STOP' ? 'stop' : reason === 'MAX_TOKENS' ? 'length' : typeof reason === 'string' ? 'other' : 'unknown';
    if (candidateList === null) return { text: '', finishReason, responseShape: 'malformed', safetyBlocked };
    if (!candidateList.length) return { text: '', finishReason, responseShape: safetyBlocked ? 'valid' : 'empty', safetyBlocked };
    if (!candidate || !content || !Array.isArray(parts)) return { text: '', finishReason, responseShape: 'malformed', safetyBlocked };
    const textParts: string[] = [];
    const toolCalls: ConversationToolCall[] = [];
    for (const partValue of parts) {
      const part = asRecord(partValue);
      if (!part) return { text: '', finishReason, responseShape: 'malformed', safetyBlocked };
      if (part.thought !== true && typeof part.text === 'string') textParts.push(part.text);
      const functionCall = asRecord(part.functionCall);
      if (functionCall) {
        if (typeof functionCall.name !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(functionCall.name) || (functionCall.id !== undefined && (typeof functionCall.id !== 'string' || functionCall.id.length > 128))) return { text: '', finishReason: 'unknown', responseShape: 'malformed', safetyBlocked };
        const args = asRecord(functionCall.args);
        if (!args) return { text: '', finishReason: 'unknown', responseShape: 'malformed', safetyBlocked };
        toolCalls.push({ id: typeof functionCall.id === 'string' ? functionCall.id : `gemini-call-${toolCalls.length + 1}`, name: functionCall.name, arguments: JSON.stringify(args) });
      }
    }
    const text = textParts.join('');
    const usageValue = asRecord(value.usageMetadata);
    const input = usageValue?.promptTokenCount; const output = usageValue?.candidatesTokenCount; const total = usageValue?.totalTokenCount;
    const normalizedUsage = { ...(isTokenCount(input) ? { inputTokens: input } : {}), ...(isTokenCount(output) ? { outputTokens: output } : {}), ...(isTokenCount(total) ? { totalTokens: total } : {}) };
    const usage = Object.keys(normalizedUsage).length ? normalizedUsage : undefined;
    return { text, finishReason: toolCalls.length ? 'tool_calls' : finishReason, responseShape: text.trim() || toolCalls.length ? 'valid' : 'empty', ...(toolCalls.length ? { toolCalls } : {}), ...(usage ? { usage } : {}), safetyBlocked };
  }
}

/** Server-side provider router. Keys and provider wire formats never leave this boundary. */
@Injectable()
export class ConversationProviderService {
  private readonly adapters: Record<ConversationProvider, ProviderAdapter> = {
    groq: new OpenAICompatibleAdapter('groq'),
    gemini: new GeminiProviderAdapter(),
    openai: new OpenAICompatibleAdapter('openai'),
    openrouter: new OpenAICompatibleAdapter('openrouter'),
  };
  private readonly openRouterModels = new Map<string, { expiresAt: number; metadata: OpenRouterModelMetadata }>();

  supportsToolCalling(provider: ConversationProvider, model: string): boolean {
    if (provider !== 'openrouter') return supportsProviderToolProtocol(provider, model);
    const cached = this.openRouterModels.get(model);
    // Unverified OpenRouter models may still accept the standard tool protocol.
    // Let the request try; the orchestrator already has a single compatibility
    // retry without tools when a route rejects it. A fresh explicit UNSUPPORTED
    // result remains authoritative and avoids sending an unusable tool request.
    if (!cached || cached.expiresAt <= Date.now()) return true;
    return cached.metadata.available && cached.metadata.toolCalling === 'SUPPORTED';
  }

  supportsJsonObjectMode(provider: ConversationProvider, model: string): boolean {
    if (provider === 'gemini') return true;
    if (provider === 'openai') return /^gpt-(?:4o|4\.1|5)(?:[-.][A-Za-z0-9]+)*$/i.test(model.trim());
    if (provider !== 'openrouter') return false;
    const cached = this.openRouterModels.get(model);
    return Boolean(cached && cached.expiresAt > Date.now() && cached.metadata.available && cached.metadata.supportedParameters?.includes('response_format'));
  }

  async complete(request: ConversationProviderRequest): Promise<ConversationProviderResult> {
    if (request.tools?.length && !this.supportsToolCalling(request.provider, request.model)) {
      throw new BadGatewayException({ code: 'PLAYGROUND_PROVIDER_TOOLING_UNSUPPORTED', message: 'The selected AI model route does not support tool calling.' });
    }
    const adapter = this.adapters[request.provider];
    const apiKey = request.provider === 'groq' ? process.env.GROQ_API_KEY?.trim() : request.provider === 'gemini' ? process.env.GEMINI_API_KEY?.trim() : request.provider === 'openrouter' ? process.env.OPENROUTER_API_KEY?.trim() : process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      const code = 'PLAYGROUND_PROVIDER_KEY_MISSING';
      const providerName = request.provider === 'gemini' ? 'Google Gemini' : request.provider === 'groq' ? 'Groq' : request.provider === 'openrouter' ? 'OpenRouter' : 'OpenAI';
      throw new ServiceUnavailableException({ code, message: `${providerName} is not configured. Add its API key to the backend environment and restart the backend.` });
    }
    return adapter.complete(request, apiKey);
  }

  isProviderConfigured(provider: ConversationProvider): boolean {
    return getProviderCredentialPresence()[provider];
  }

  /** Explicit manager-triggered validation. Never invoked in the visitor request path. */
  async validateOpenRouterModel(): Promise<OpenRouterModelMetadata> {
    const effective = getEffectiveProviderConfiguration();
    if (effective.provider !== 'openrouter' || !effective.model || !isValidProviderModel('openrouter', effective.model)) {
      throw new ServiceUnavailableException({ code: 'OPENROUTER_CONFIGURATION_INVALID', message: 'Configure AI_DEFAULT_PROVIDER=OPENROUTER and a valid OPENROUTER_MODEL before validating the model.' });
    }
    const model = effective.model;
    const cached = this.openRouterModels.get(model);
    if (cached && cached.expiresAt > Date.now()) return cached.metadata;
    const key = process.env.OPENROUTER_API_KEY?.trim();
    if (!key) throw new ServiceUnavailableException({ code: 'PLAYGROUND_PROVIDER_KEY_MISSING', message: 'OpenRouter is not configured. Add OPENROUTER_API_KEY to the backend environment.' });
    const base = process.env.OPENROUTER_BASE_URL?.trim() || DEFAULT_OPENROUTER_BASE_URL;
    if (!isSafeOpenRouterBaseUrl(base)) throw new ServiceUnavailableException({ code: 'OPENROUTER_BASE_URL_INVALID', message: 'OpenRouter base URL must use the official HTTPS API origin.' });
    const [author, ...slugParts] = model.split('/');
    const slug = slugParts.join('/');
    if (!author || !slug) throw new ServiceUnavailableException({ code: 'OPENROUTER_CONFIGURATION_INVALID', message: 'The configured OpenRouter model identifier is invalid.' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/model/${author}/${slug}`, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' }, signal: controller.signal });
      if (response.status === 404) throw new HttpException({ code: 'OPENROUTER_MODEL_UNAVAILABLE', message: 'OpenRouter does not currently list the configured model identifier.' }, HttpStatus.NOT_FOUND);
      if (response.status === 401 || response.status === 403) throw new ServiceUnavailableException({ code: 'OPENROUTER_AUTH_REJECTED', message: 'OpenRouter rejected the configured API key or its access permissions.' });
      if (response.status === 402) throw new HttpException({ code: 'OPENROUTER_PAYMENT_REQUIRED', message: 'The OpenRouter account requires credits or billing attention.' }, HttpStatus.PAYMENT_REQUIRED);
      if (response.status === 429) throw new HttpException({ code: 'OPENROUTER_RATE_LIMITED', message: 'OpenRouter model validation is rate limited. Try again later.' }, HttpStatus.TOO_MANY_REQUESTS);
      if (!response.ok) throw new ServiceUnavailableException({ code: `OPENROUTER_METADATA_HTTP_${response.status}`, message: 'OpenRouter model metadata could not be checked. Try again later.' });
      const payload = asRecord(await response.json());
      const data = asRecord(payload?.data);
      if (!data || data.id !== model || !Array.isArray(data.supported_parameters)) throw new BadGatewayException({ code: 'OPENROUTER_METADATA_INVALID', message: 'OpenRouter returned incomplete model metadata.' });
      const supported = data.supported_parameters.filter((item): item is string => typeof item === 'string' && item.length <= 64);
      const toolCalling: OpenRouterModelMetadata['toolCalling'] = supported.includes('tools') && supported.includes('tool_choice') ? 'SUPPORTED' : 'UNSUPPORTED';
      const pricing = asRecord(data.pricing);
      const topProvider = asRecord(data.top_provider);
      const architecture = asRecord(data.architecture);
      const boundedModalities = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length <= 32).slice(0, 16) : undefined;
      const inputModalities = boundedModalities(architecture?.input_modalities);
      const outputModalities = boundedModalities(architecture?.output_modalities);
      const metadata: OpenRouterModelMetadata = {
        model, available: true, checkedAt: new Date().toISOString(), toolCalling,
        supportedParameters: supported.slice(0, 80),
        ...(Number.isSafeInteger(data.context_length) ? { contextLength: Number(data.context_length) } : {}),
        ...(topProvider && Number.isSafeInteger(topProvider.max_completion_tokens) ? { maxCompletionTokens: Number(topProvider.max_completion_tokens) } : {}),
        ...(inputModalities ? { inputModalities } : {}),
        ...(outputModalities ? { outputModalities } : {}),
        ...(pricing && typeof pricing.prompt === 'string' && typeof pricing.completion === 'string' ? { pricing: { prompt: pricing.prompt.slice(0, 32), completion: pricing.completion.slice(0, 32) } } : {}),
      };
      this.openRouterModels.set(model, { metadata, expiresAt: Date.now() + 15 * 60_000 });
      return metadata;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: controller.signal.aborted ? 'OPENROUTER_METADATA_TIMEOUT' : 'OPENROUTER_METADATA_UNAVAILABLE', message: 'OpenRouter model metadata is temporarily unavailable.' });
    } finally { clearTimeout(timeout); }
  }

  getProviderConfigurationStatus() {
    const effective = getEffectiveProviderConfiguration();
    const credentials = getProviderCredentialPresence();
    const publicEffective = {
      provider: effective.provider,
      model: effective.model,
      status: effective.configurationStatus,
      configurationValid: effective.configurationValid,
      keyConfigured: effective.keyConfigured,
      ready: effective.ready,
    };
    return {
      groq: { keyConfigured: credentials.groq, status: credentials.groq ? 'READY_FOR_TESTING' : 'MISSING_API_KEY' },
      gemini: { keyConfigured: credentials.gemini, status: credentials.gemini ? 'READY_FOR_TESTING' : 'MISSING_API_KEY', supportedModels: [...SUPPORTED_GEMINI_MODELS] },
      openai: { keyConfigured: credentials.openai, status: credentials.openai ? 'READY_FOR_TESTING' : 'MISSING_API_KEY' },
      openrouter: { keyConfigured: credentials.openrouter, status: credentials.openrouter ? 'READY_FOR_TESTING' : 'MISSING_API_KEY', modelValidation: effective.provider === 'openrouter' && effective.model ? (() => { const cached = this.openRouterModels.get(effective.model); return cached && cached.expiresAt > Date.now() ? cached.metadata : { model: effective.model, available: null, toolCalling: 'UNVERIFIED' as const }; })() : null },
      effective: publicEffective,
    } as const;
  }
}

export type OpenRouterModelMetadata = Readonly<{
  model: string; available: boolean; checkedAt?: string; toolCalling: 'SUPPORTED' | 'UNSUPPORTED' | 'UNVERIFIED';
  supportedParameters?: readonly string[]; contextLength?: number; maxCompletionTokens?: number;
  inputModalities?: readonly string[]; outputModalities?: readonly string[];
  pricing?: Readonly<{ prompt: string; completion: string }>;
}>;
