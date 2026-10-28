import { BadGatewayException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConversationProviderService, initializeEffectiveProviderConfiguration, isTransientProviderFailure, resolveEffectiveProviderConfiguration } from '../src/modules/workspaces/conversation-provider.service';

describe('effective provider environment configuration', () => {
  it('resolves Gemini, Groq and OpenAI models from the provider-specific environment variables', () => {
    expect(resolveEffectiveProviderConfiguration({ AI_DEFAULT_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-2.5-flash', GEMINI_API_KEY: 'test-only' })).toMatchObject({ provider: 'gemini', model: 'gemini-2.5-flash', configurationValid: true, ready: true });
    expect(resolveEffectiveProviderConfiguration({ AI_DEFAULT_PROVIDER: 'groq', GROQ_MODEL: 'openai/gpt-oss-20b', GROQ_API_KEY: 'test-only', GEMINI_MODEL: 'gemini-2.5-flash' })).toMatchObject({ provider: 'groq', model: 'openai/gpt-oss-20b', configurationValid: true, ready: true });
    expect(resolveEffectiveProviderConfiguration({ AI_DEFAULT_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-4o-mini', OPENAI_API_KEY: 'test-only' })).toMatchObject({ provider: 'openai', model: 'gpt-4o-mini', configurationValid: true, ready: true });
  });

  it('routes the exact centrally configured OpenRouter model without a model catalogue allow-list', () => {
    expect(resolveEffectiveProviderConfiguration({ AI_DEFAULT_PROVIDER: 'OPENROUTER', OPENROUTER_MODEL: 'vendor/new-compatible-model', OPENROUTER_API_KEY: 'router-only-key' }))
      .toMatchObject({ provider: 'openrouter', model: 'vendor/new-compatible-model', configurationValid: true, ready: true });
    expect(resolveEffectiveProviderConfiguration({ AI_DEFAULT_PROVIDER: 'openrouter', OPENROUTER_MODEL: 'vendor/new-compatible-model' }))
      .toMatchObject({ provider: 'openrouter', model: 'vendor/new-compatible-model', configurationValid: true, configurationStatus: 'MISSING_API_KEY', ready: false });
  });

  it('reports invalid, incomplete and missing-key states without selecting another provider', () => {
    expect(resolveEffectiveProviderConfiguration({ AI_DEFAULT_PROVIDER: 'unlisted', GROQ_API_KEY: 'test-only' })).toMatchObject({ provider: null, model: null, configurationStatus: 'INVALID_PROVIDER', ready: false });
    expect(resolveEffectiveProviderConfiguration({ AI_DEFAULT_PROVIDER: 'openai', OPENAI_API_KEY: 'test-only' })).toMatchObject({ provider: 'openai', model: null, configurationStatus: 'MISSING_MODEL', ready: false });
    expect(resolveEffectiveProviderConfiguration({ AI_DEFAULT_PROVIDER: 'gemini', GEMINI_MODEL: 'unlisted-model', GEMINI_API_KEY: 'test-only' })).toMatchObject({ provider: 'gemini', model: null, configurationStatus: 'INVALID_MODEL', ready: false });
    expect(resolveEffectiveProviderConfiguration({ AI_DEFAULT_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-2.5-flash', GROQ_API_KEY: 'test-only' })).toMatchObject({ provider: 'gemini', model: 'gemini-2.5-flash', configurationStatus: 'MISSING_API_KEY', ready: false });
  });

  it('exposes only safe provider readiness metadata', () => {
    const status = new ConversationProviderService().getProviderConfigurationStatus();
    expect(JSON.stringify(status)).not.toContain('test-only');
    expect(status.effective).toHaveProperty('provider');
    expect(status.effective).not.toHaveProperty('apiKey');
  });
});

describe('ConversationProviderService', () => {
  const oldGroqKey = process.env.GROQ_API_KEY;
  const oldGeminiKey = process.env.GEMINI_API_KEY;
  const oldOpenAiKey = process.env.OPENAI_API_KEY;
  const oldOpenRouterKey = process.env.OPENROUTER_API_KEY;
  const oldOpenRouterModel = process.env.OPENROUTER_MODEL;
  const oldOpenRouterBase = process.env.OPENROUTER_BASE_URL;
  const adapter = new ConversationProviderService();
  let fetchMock: jest.SpyInstance;
  const request = { provider: 'groq' as const, model: 'openai/gpt-oss-20b', messages: [{ role: 'user' as const, content: 'synthetic' }], maxCompletionTokens: 1024, requestId: 'request-test', organizationId: 'org-test', assistantId: 'assistant-test', stage: 'query_interpretation' as const };

  beforeEach(() => {
    process.env.GROQ_API_KEY = 'test-only';
    process.env.GEMINI_API_KEY = 'test-only';
    process.env.OPENAI_API_KEY = 'test-only';
    process.env.OPENROUTER_API_KEY = 'router-test-key';
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (oldGroqKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldGroqKey;
    if (oldGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldGeminiKey;
    if (oldOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = oldOpenAiKey;
    if (oldOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldOpenRouterKey;
    if (oldOpenRouterModel === undefined) delete process.env.OPENROUTER_MODEL;
    else process.env.OPENROUTER_MODEL = oldOpenRouterModel;
    if (oldOpenRouterBase === undefined) delete process.env.OPENROUTER_BASE_URL;
    else process.env.OPENROUTER_BASE_URL = oldOpenRouterBase;
    initializeEffectiveProviderConfiguration(process.env);
  });

  it('uses bounded GPT-OSS Groq parameters and returns only final assistant content', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'normalized query', reasoning: 'must not be returned' }, finish_reason: 'stop' }], usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 } }), { status: 200 }));
    const result = await adapter.complete(request);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(body).toMatchObject({ model: request.model, max_completion_tokens: 1024, reasoning_effort: 'low', include_reasoning: false });
    expect(result).toEqual({ provider: 'groq', model: request.model, content: 'normalized query', finishReason: 'stop', usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } });
  });

  it('normalizes successful OpenAI Chat Completions without fabricating absent usage metadata', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OpenAI answer' }, finish_reason: 'stop' }] }), { status: 200 }));
    const result = await adapter.complete({ ...request, provider: 'openai', model: 'gpt-4o-mini' });
    expect(result).toEqual({ provider: 'openai', model: 'gpt-4o-mini', content: 'OpenAI answer', finishReason: 'stop' });
  });

  it('sends OpenRouter requests to its trusted endpoint using only its key and exact model ID', async () => {
    process.env.OPENAI_API_KEY = 'openai-must-not-be-used';
    process.env.GROQ_API_KEY = 'groq-must-not-be-used';
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } }), { status: 200 }));
    const result = await adapter.complete({ ...request, provider: 'openrouter', model: 'vendor/model-v7' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer router-test-key');
    expect(new Headers(init.headers).get('x-goog-api-key')).toBeNull();
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'vendor/model-v7', max_tokens: request.maxCompletionTokens });
    expect(result).toMatchObject({ provider: 'openrouter', model: 'vendor/model-v7', content: 'answer', usage: { inputTokens: 5, outputTokens: 2 } });
  });

  it('keeps Gemini 2.5 Flash Lite on OpenRouter with JSON mode and the requested output budget', async () => {
    const model = 'google/gemini-2.5-flash-lite';
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }] }), { status: 200 }));
    const result = await adapter.complete({ ...request, provider: 'openrouter', model, maxCompletionTokens: 768, responseFormat: 'json_object' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(JSON.parse(String(init.body))).toMatchObject({ model, max_tokens: 768, response_format: { type: 'json_object' } });
    expect(result).toMatchObject({ provider: 'openrouter', model, content: '{"ok":true}', finishReason: 'stop' });
  });

  it('uses OpenRouter JSON mode only after cached model metadata declares response_format support', async () => {
    const model = 'google/gemini-2.5-flash-lite';
    initializeEffectiveProviderConfiguration({ AI_DEFAULT_PROVIDER: 'openrouter', OPENROUTER_MODEL: model, OPENROUTER_API_KEY: 'router-test-key' });
    expect(adapter.supportsJsonObjectMode('openrouter', model)).toBe(false);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: model, supported_parameters: ['response_format'] } }), { status: 200 }));
    await adapter.validateOpenRouterModel();
    expect(adapter.supportsJsonObjectMode('openrouter', model)).toBe(true);
    expect(adapter.supportsJsonObjectMode('openrouter', 'google/unverified-model')).toBe(false);
  });

  it('classifies only an explicit OpenRouter JSON-mode rejection for prompt-only compatibility', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'response_format json_object is not supported by this route' } }), { status: 400 }));
    await expect(adapter.complete({ ...request, provider: 'openrouter', model: 'google/gemini-2.5-flash-lite', responseFormat: 'json_object' }))
      .rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_STRUCTURED_OUTPUT_UNSUPPORTED' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('attempts OpenRouter tools for an unverified route and honors an explicit unsupported result', async () => {
    const model = 'vendor/agent-model';
    const tools = [{ name: 'search_store_products', description: 'Search authorized products', parameters: { type: 'object', properties: {}, additionalProperties: false } }];
    initializeEffectiveProviderConfiguration({ AI_DEFAULT_PROVIDER: 'openrouter', OPENROUTER_MODEL: model, OPENROUTER_API_KEY: 'router-test-key' });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'router_call_1', type: 'function', function: { name: 'search_store_products', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }), { status: 200 }));
    expect(adapter.supportsToolCalling('openrouter', model)).toBe(true);
    const unverifiedResult = await adapter.complete({ ...request, provider: 'openrouter', model, tools });
    expect(unverifiedResult).toMatchObject({ finishReason: 'tool_calls', toolCalls: [{ name: 'search_store_products' }] });
    const [, unverifiedInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(unverifiedInit.body))).toMatchObject({ tool_choice: 'auto', parallel_tool_calls: false });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: model, supported_parameters: [], context_length: 32768, top_provider: { max_completion_tokens: 4096 }, pricing: { prompt: '0.1', completion: '0.2' } } }), { status: 200 }));
    const metadata = await adapter.validateOpenRouterModel();
    expect(metadata).toMatchObject({ available: true, toolCalling: 'UNSUPPORTED', contextLength: 32768 });
    expect(adapter.supportsToolCalling('openrouter', model)).toBe(false);
    await expect(adapter.complete({ ...request, provider: 'openrouter', model, tools })).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_TOOLING_UNSUPPORTED' } });
  });

  it.each(['groq', 'openai'] as const)('%s serializes bounded function tools and validates model-issued tool calls', async (provider) => {
    const model = provider === 'groq' ? 'openai/gpt-oss-20b' : 'gpt-4o-mini';
    const tools = [{ name: 'search_store_products', description: 'Search authorized products', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }];
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_123', type: 'function', function: { name: 'search_store_products', arguments: '{"query":"shoes"}' } }] }, finish_reason: 'tool_calls' }] }), { status: 200 }));
    const result = await adapter.complete({ ...request, provider, model, tools });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ tools: [{ type: 'function', function: { name: 'search_store_products', strict: true } }], tool_choice: 'auto', parallel_tool_calls: false });
    expect(result).toMatchObject({ finishReason: 'tool_calls', toolCalls: [{ id: 'call_123', name: 'search_store_products', arguments: '{"query":"shoes"}' }] });
  });

  it('rejects malformed provider tool calls before returning them to orchestration', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_store_products', arguments: '{bad' } }] }, finish_reason: 'tool_calls' }] }), { status: 200 }));
    await expect(adapter.complete({ ...request, provider: 'openai', model: 'gpt-4o-mini' })).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_INVALID_RESPONSE' } });
  });

  it('preserves only token usage fields actually supplied by a provider', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OpenAI answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 7 } }), { status: 200 }));
    const result = await adapter.complete({ ...request, provider: 'openai', model: 'gpt-4o-mini' });
    expect(result.usage).toEqual({ inputTokens: 7 });
  });

  it('excludes negative and fractional token values while retaining independently valid fields', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'OpenAI answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: -1, completion_tokens: 2.5, total_tokens: 4 } }), { status: 200 }));
    const result = await adapter.complete({ ...request, provider: 'openai', model: 'gpt-4o-mini' });
    expect(result.usage).toEqual({ totalTokens: 4 });
  });

  it('rejects a successful HTTP response whose body is malformed JSON', async () => {
    fetchMock.mockResolvedValue(new Response('{not-json', { status: 200 }));
    await expect(adapter.complete(request)).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_INVALID_RESPONSE' } });
  });

  it.each(['groq', 'openai'] as const)('%s rejects empty, malformed, and non-complete provider choices', async (provider) => {
    const model = provider === 'groq' ? 'openai/gpt-oss-20b' : 'gpt-4o-mini';
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    await expect(adapter.complete({ ...request, provider, model })).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_EMPTY_RESPONSE' } });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: null, finish_reason: 'stop' }] }), { status: 200 }));
    await expect(adapter.complete({ ...request, provider, model })).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_INVALID_RESPONSE' } });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'tool_calls' }] }), { status: 200 }));
    await expect(adapter.complete({ ...request, provider, model })).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_INCOMPLETE_RESPONSE' } });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }), { status: 200 }));
    await expect(adapter.complete({ ...request, provider, model })).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_OUTPUT_TRUNCATED' } });
  });

  it('logs safe response-shape metadata when OpenRouter returns a completed choice without usable content', async () => {
    const log = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 0, total_tokens: 12 } }), { status: 200 }));

    await expect(adapter.complete({ ...request, provider: 'openrouter', model: 'google/gemini-2.5-flash-lite', stage: 'grounded_answer' }))
      .rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_EMPTY_RESPONSE' } });

    const logged = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('"status":200');
    expect(logged).toContain('"choiceCount":1');
    expect(logged).toContain('"responseContentType":"nullish"');
    expect(logged).toContain('"responseContentLength":null');
    expect(logged).toContain('"normalizedTextLength":0');
    expect(logged).toContain('"toolCallPresent":false');
    expect(logged).toContain('"normalizationOutcome":"empty"');
    expect(logged).toContain('"outputTokens":0');
    expect(logged).not.toContain('router-test-key');
  });

  it('classifies truncated output separately from malformed output', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'partial' }, finish_reason: 'length' }] }), { status: 200 }));
    await expect(adapter.complete(request)).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_OUTPUT_TRUNCATED' } });
  });

  it('does not disguise provider authentication failures', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'invalid_api_key' } }), { status: 401 }));
    await expect(adapter.complete(request)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('reports OpenRouter credit failures without retrying or falling back silently', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'private provider response' } }), { status: 402 }));
    await expect(adapter.complete({ ...request, provider: 'openrouter', model: 'vendor/model-x' })).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_PAYMENT_REQUIRED' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves a bounded Retry-After value on provider 429 and classifies it as eligible only for approved route fallback', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'private provider body' } }), { status: 429, headers: { 'retry-after': '17' } }));
    const error = await adapter.complete({ ...request, provider: 'openrouter', model: 'vendor/model-x' }).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ status: 429, response: { code: 'PLAYGROUND_PROVIDER_RATE_LIMITED', retryAfterSeconds: 17 } });
    expect(isTransientProviderFailure(error)).toBe(true);
    expect(JSON.stringify(error)).not.toContain('private provider body');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not classify an unexpected transport exception as a retryable outage', async () => {
    fetchMock.mockRejectedValue(new Error('internal transport marker'));
    await expect(adapter.complete(request)).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_REQUEST_FAILED' } });
  });

  it('cancels non-success provider response bodies without exposing their contents', async () => {
    const response = new Response(JSON.stringify({ error: { detail: 'private provider payload' } }), { status: 503 });
    const responseBody = response.body;
    if (!responseBody) throw new Error('Expected an HTTP response body for this fixture.');
    const cancelBody = jest.spyOn(responseBody, 'cancel');
    fetchMock.mockResolvedValue(response);
    await expect(adapter.complete(request)).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_TEMPORARILY_UNAVAILABLE' } });
    expect(cancelBody).toHaveBeenCalledTimes(1);
  });

  it('keeps customer prompts, provider bodies and credentials out of failure logs and public errors', async () => {
    const promptMarker = 'private-customer-message-marker';
    const knowledgeMarker = 'private-knowledge-excerpt-marker';
    const instructionMarker = 'private-system-prompt-marker';
    const providerMarker = 'provider-body-secret-marker';
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: providerMarker, detail: promptMarker } }), { status: 503 }));
    try {
      const failure = await adapter.complete({ ...request, attemptIndex: 2, messages: [{ role: 'system', content: instructionMarker }, { role: 'user', content: `${promptMarker} ${knowledgeMarker}` }] }).catch((error: unknown) => error);
      const output = JSON.stringify({ warning: warning.mock.calls, failure });
      expect(output).not.toContain(promptMarker);
      expect(output).not.toContain(knowledgeMarker);
      expect(output).not.toContain(instructionMarker);
      expect(output).not.toContain(providerMarker);
      expect(output).not.toContain('test-only');
      expect(warning.mock.calls[0]?.[0]).toContain('"attemptIndex":2');
      expect(failure).toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_TEMPORARILY_UNAVAILABLE' } });
    } finally {
      warning.mockRestore();
    }
  });

  it('fails clearly when the selected provider key is missing', async () => {
    delete process.env.GROQ_API_KEY;
    await expect(adapter.complete(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { provider: 'groq' as const, model: 'openai/gpt-oss-20b', url: 'https://api.groq.com/openai/v1/chat/completions', header: 'authorization', expectedHeader: 'Bearer groq-test-key' },
    { provider: 'gemini' as const, model: 'gemini-2.5-flash', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', header: 'x-goog-api-key', expectedHeader: 'gemini-test-key' },
    { provider: 'openai' as const, model: 'gpt-4o-mini', url: 'https://api.openai.com/v1/chat/completions', header: 'authorization', expectedHeader: 'Bearer openai-test-key' },
  ])('uses only the configured $provider credential and trusted endpoint', async ({ provider, model, url, header, expectedHeader }) => {
    process.env.GROQ_API_KEY = 'groq-test-key';
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    process.env.OPENAI_API_KEY = 'openai-test-key';
    fetchMock.mockResolvedValue(new Response(JSON.stringify(provider === 'gemini'
      ? { candidates: [{ content: { parts: [{ text: 'answer' }] }, finishReason: 'STOP' }] }
      : { choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }] }), { status: 200 }));

    await adapter.complete({ ...request, provider, model });

    const [actualUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(actualUrl).toBe(url);
    expect(headers.get(header)).toBe(expectedHeader);
    expect(headers.get(provider === 'gemini' ? 'authorization' : 'x-goog-api-key')).toBeNull();
  });

  it('fails safely when Gemini credentials are absent without attempting a request', async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(adapter.complete({ ...request, provider: 'gemini', model: 'gemini-3.8-flash' }))
      .rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_KEY_MISSING' } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes provider credential presence without returning credential values', () => {
    process.env.GROQ_API_KEY = 'groq-status-test-key';
    process.env.GEMINI_API_KEY = 'gemini-status-test-key';
    process.env.OPENAI_API_KEY = 'openai-status-test-key';
    initializeEffectiveProviderConfiguration(process.env);

    const status = adapter.getProviderConfigurationStatus();
    expect(status).toMatchObject({
      groq: { keyConfigured: true, status: 'READY_FOR_TESTING' },
      gemini: { keyConfigured: true, status: 'READY_FOR_TESTING' },
      openai: { keyConfigured: true, status: 'READY_FOR_TESTING' },
    });
    expect(JSON.stringify(status)).not.toContain('test-key');
  });

  it('maps canonical history and output into Gemini generateContent and normalizes text and usage', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'private reasoning', thought: true }, { text: 'grounded ' }, { text: 'response' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 5, totalTokenCount: 14 } }), { status: 200 }));
    const result = await adapter.complete({ ...request, provider: 'gemini', model: 'gemini-3.8-flash', messages: [{ role: 'system', content: 'trusted instruction' }, { role: 'user', content: 'first' }, { role: 'assistant', content: 'second' }, { role: 'user', content: 'last' }], responseFormat: 'json_object' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('test-only');
    expect(body).toMatchObject({ systemInstruction: { parts: [{ text: 'trusted instruction' }] }, contents: [{ role: 'user' }, { role: 'model' }, { role: 'user' }], generationConfig: { maxOutputTokens: request.maxCompletionTokens, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } } });
    expect(body.generationConfig).not.toHaveProperty('temperature');
    expect(result).toEqual({ provider: 'gemini', model: 'gemini-3.8-flash', content: 'grounded response', finishReason: 'stop', usage: { inputTokens: 9, outputTokens: 5, totalTokens: 14 } });
  });

  it('exposes Gemini function declarations and round-trips validated function calls and results', async () => {
    const tools = [{ name: 'search_store_products', description: 'Search the authorized catalog', parameters: { type: 'object', properties: { query: { type: 'string' }, browse: { type: 'boolean' } }, required: ['query', 'browse'], additionalProperties: false } }];
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'gemini-call-1', name: 'search_store_products', args: { query: 'Ocean bracelet', browse: false } } }] }, finishReason: 'STOP' }] }), { status: 200 }));
    const first = await adapter.complete({ ...request, provider: 'gemini', model: 'gemini-3.8-flash', tools });
    expect(first).toMatchObject({ finishReason: 'tool_calls', toolCalls: [{ id: 'gemini-call-1', name: 'search_store_products', arguments: '{"query":"Ocean bracelet","browse":false}' }] });
    const [, firstInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(firstInit.body))).toMatchObject({ tools: [{ functionDeclarations: [{ name: 'search_store_products', parameters: { type: 'OBJECT', properties: { query: { type: 'STRING' }, browse: { type: 'BOOLEAN' } } } }] }] });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'The Ocean Bracelet is available. [C1]' }] }, finishReason: 'STOP' }] }), { status: 200 }));
    await adapter.complete({ ...request, provider: 'gemini', model: 'gemini-3.8-flash', tools, messages: [
      { role: 'user', content: 'Is the Ocean Bracelet available?' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'gemini-call-1', type: 'function', function: { name: 'search_store_products', arguments: '{"query":"Ocean bracelet","browse":false}' } }] },
      { role: 'tool', tool_call_id: 'gemini-call-1', name: 'search_store_products', content: '{"ok":true,"sources":[{"reference":"C1","title":"Ocean Bracelet"}]}' },
    ] });
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(secondInit.body)).contents).toEqual([
      { role: 'user', parts: [{ text: 'Is the Ocean Bracelet available?' }] },
      { role: 'model', parts: [{ functionCall: { id: 'gemini-call-1', name: 'search_store_products', args: { query: 'Ocean bracelet', browse: false } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'search_store_products', id: 'gemini-call-1', response: { ok: true, sources: [{ reference: 'C1', title: 'Ocean Bracelet' }] } } }] },
    ]);
  });

  it('classifies Gemini HTTP 404 from sanitized Google status without logging its free-form error message', async () => {
    const log = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'models/gemini-2.5-flash not found; diagnostic-secret-must-not-be-logged' } }), { status: 404, headers: { 'content-type': 'application/json' } }));
    await expect(adapter.complete({ ...request, provider: 'gemini', model: 'gemini-2.5-flash' })).rejects.toMatchObject({
      response: { code: 'PLAYGROUND_PROVIDER_MODEL_UNAVAILABLE', message: expect.stringContaining('HTTP 404') },
    });
    const logged = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('"status":404');
    expect(logged).toContain('"providerStatus":"NOT_FOUND"');
    expect(logged).not.toContain('diagnostic-secret-must-not-be-logged');
    expect(logged).not.toContain('test-only');
  });

  it('preserves provider permission status for Gemini access failures without exposing provider text', async () => {
    const log = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'project access diagnostic-secret-must-not-be-logged' } }), { status: 403, headers: { 'content-type': 'application/json' } }));
    await expect(adapter.complete({ ...request, provider: 'gemini', model: 'gemini-2.5-flash' })).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_AUTH_REJECTED' } });
    const logged = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('"status":403');
    expect(logged).toContain('"providerStatus":"PERMISSION_DENIED"');
    expect(logged).not.toContain('diagnostic-secret-must-not-be-logged');
  });

  it('rejects a Gemini response with no candidates or usable text', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    await expect(adapter.complete({ ...request, provider: 'gemini', model: 'gemini-3.8-flash' }))
      .rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_EMPTY_RESPONSE' } });
  });

  it('rejects Gemini MAX_TOKENS and unknown finish reasons even when partial text exists', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'partial answer' }] }, finishReason: 'MAX_TOKENS' }] }), { status: 200 }));
    await expect(adapter.complete({ ...request, provider: 'gemini', model: 'gemini-3.8-flash' })).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_OUTPUT_TRUNCATED' } });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'unconfirmed answer' }] }, finishReason: 'OTHER' }] }), { status: 200 }));
    await expect(adapter.complete({ ...request, provider: 'gemini', model: 'gemini-3.8-flash' })).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_INCOMPLETE_RESPONSE' } });
  });

  it('accepts complete Gemini text when optional usage metadata is absent', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'complete answer' }] }, finishReason: 'STOP' }] }), { status: 200 }));
    await expect(adapter.complete({ ...request, provider: 'gemini', model: 'gemini-3.8-flash' })).resolves.toEqual({ provider: 'gemini', model: 'gemini-3.8-flash', content: 'complete answer', finishReason: 'stop' });
  });

  it('normalizes a Gemini safety block without exposing provider text', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }), { status: 200 }));
    await expect(adapter.complete({ ...request, provider: 'gemini', model: 'gemini-3.8-flash' }))
      .rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_SAFETY_BLOCKED' } });
  });

  it('rejects oversized normalized text instead of silently slicing a successful response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(8001) }, finish_reason: 'stop' }] }), { status: 200 }));
    await expect(adapter.complete(request)).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_OUTPUT_TRUNCATED' } });
  });

  it('keeps the provider timeout active while a Gemini response body is being read', async () => {
    const response = new Response('{}', { status: 200 });
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = init?.signal;
      jest.spyOn(response, 'json').mockImplementation(() => new Promise((_resolve, reject) => {
        if (signal instanceof AbortSignal) signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));
      return response;
    });

    await expect(adapter.complete({ ...request, provider: 'gemini', model: 'gemini-3.8-flash', timeoutMs: 1000 }))
      .rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_TIMEOUT' } });
  });

  it('keeps caller cancellation connected until Gemini response parsing completes', async () => {
    const response = new Response('{}', { status: 200 });
    const controller = new AbortController();
    let bodyReadStarted: () => void = () => undefined;
    const bodyRead = new Promise<void>((resolve) => { bodyReadStarted = resolve; });
    fetchMock.mockImplementation(async (_url, init) => {
      const signal = init?.signal;
      jest.spyOn(response, 'json').mockImplementation(() => new Promise((_resolve, reject) => {
        bodyReadStarted();
        if (signal instanceof AbortSignal) signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));
      return response;
    });
    const pending = adapter.complete({ ...request, provider: 'gemini', model: 'gemini-3.8-flash', signal: controller.signal });
    await bodyRead;
    controller.abort(new DOMException('Cancelled', 'AbortError'));

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('classifies a Gemini safety block separately from missing knowledge', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] }), { status: 200 }));
    await expect(adapter.complete({ ...request, provider: 'gemini', model: 'gemini-3.8-flash' })).rejects.toMatchObject({ response: { code: 'PLAYGROUND_PROVIDER_SAFETY_BLOCKED' } });
  });
});
