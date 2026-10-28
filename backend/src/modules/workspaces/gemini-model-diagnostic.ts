export type GeminiModelDiagnosticEntry = Readonly<{
  name: string;
  supportedGenerationMethods: readonly string[];
}>;

const LIST_MODELS_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const METHOD_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

/**
 * Read the configured model's ListModels metadata for the project behind an
 * existing Gemini key. This never generates content and only returns the two
 * fields needed to inspect model availability/capabilities.
 */
export async function listConfiguredGeminiModel(
  apiKey: string,
  configuredModel: string,
  fetcher: typeof fetch = fetch,
): Promise<GeminiModelDiagnosticEntry[]> {
  const modelId = configuredModel.trim().replace(/^models\//, '');
  if (!apiKey.trim() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(modelId)) {
    throw new Error('Gemini diagnostic configuration is incomplete or invalid.');
  }
  const targetName = `models/${modelId}`;
  const entries: GeminiModelDiagnosticEntry[] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(LIST_MODELS_ENDPOINT);
    url.searchParams.set('pageSize', String(PAGE_SIZE));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'GET',
        headers: { 'x-goog-api-key': apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('Gemini ListModels request failed; transport details suppressed.');
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error(`Gemini ListModels request failed (HTTP ${response.status}); provider details suppressed.`);
    }
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new Error('Gemini ListModels returned an invalid response; provider details suppressed.'); }
    const record = asRecord(payload);
    if (!record || (record.models !== undefined && !Array.isArray(record.models))) {
      throw new Error('Gemini ListModels returned an invalid response; provider details suppressed.');
    }
    for (const candidate of (record.models ?? []) as unknown[]) {
      const model = asRecord(candidate);
      if (model?.name !== targetName) continue;
      const methods = Array.isArray(model.supportedGenerationMethods)
        ? [...new Set(model.supportedGenerationMethods.filter((item): item is string => typeof item === 'string' && METHOD_NAME_PATTERN.test(item)))]
        : [];
      entries.push(Object.freeze({ name: targetName, supportedGenerationMethods: Object.freeze(methods) }));
    }
    const next = record.nextPageToken;
    if (typeof next !== 'string' || !next) return entries;
    if (next.length > 512 || seenTokens.has(next)) throw new Error('Gemini ListModels pagination was invalid; provider details suppressed.');
    seenTokens.add(next);
    pageToken = next;
  }
  throw new Error('Gemini ListModels exceeded the diagnostic page limit; no partial results returned.');
}
