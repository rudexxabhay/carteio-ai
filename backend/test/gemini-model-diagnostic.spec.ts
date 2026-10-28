import { listConfiguredGeminiModel } from '../src/modules/workspaces/gemini-model-diagnostic';
import { runGeminiModelDiagnostic } from '../scripts/diagnose-gemini-models';

describe('manual Gemini ListModels diagnostic', () => {
  it('requires an explicit live-request flag before it can call Google', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    await expect(runGeminiModelDiagnostic([], { AI_DEFAULT_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-2.5-flash', GEMINI_API_KEY: 'test-key' }, fetchMock))
      .rejects.toThrow('No request sent');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the configured project credential and returns only the configured model name and methods', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(new Response(JSON.stringify({
      models: [
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens', 'bad method', 42], displayName: 'must not be returned' },
        { name: 'models/another-model', supportedGenerationMethods: ['generateContent'] },
      ],
    }), { status: 200 }));
    const result = await runGeminiModelDiagnostic(['--confirm-live'], { AI_DEFAULT_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-2.5-flash', GEMINI_API_KEY: 'test-key' }, fetchMock);
    expect(result).toEqual([{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] }]);
    expect(Object.keys(result[0]!)).toEqual(['name', 'supportedGenerationMethods']);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('x-goog-api-key')).toBe('test-key');
    expect(url.toString()).not.toContain('test-key');
  });

  it('paginates without exposing pagination tokens and finds the configured model on later pages', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [], nextPageToken: 'next-page-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] }), { status: 200 }));
    const result = await listConfiguredGeminiModel('test-key', 'gemini-2.5-flash', fetchMock);
    expect(result).toEqual([{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }]);
    expect((fetchMock.mock.calls[1]?.[0] as URL).searchParams.get('pageToken')).toBe('next-page-token');
  });

  it('suppresses Google error bodies and reports only safe HTTP status metadata', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(new Response(JSON.stringify({ error: {
      code: 404, status: 'NOT_FOUND', message: 'must-not-be-returned-or-logged',
    } }), { status: 404 }));
    const error = await listConfiguredGeminiModel('test-key', 'gemini-2.5-flash', fetchMock).catch((failure: unknown) => failure);
    expect(String(error)).toContain('HTTP 404');
    expect(String(error)).not.toContain('must-not-be-returned-or-logged');
    expect(String(error)).not.toContain('test-key');
  });

  it('returns model metadata so the caller can see when generateContent is unsupported', async () => {
    const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue(new Response(JSON.stringify({
      models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['countTokens'] }],
    }), { status: 200 }));
    await expect(listConfiguredGeminiModel('test-key', 'gemini-2.5-flash', fetchMock)).resolves.toEqual([
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['countTokens'] },
    ]);
  });
});
