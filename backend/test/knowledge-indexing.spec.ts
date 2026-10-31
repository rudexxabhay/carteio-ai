import { chunkKnowledgeText, contentHash, OpenAiEmbeddingProvider, OpenRouterEmbeddingProvider, createEmbeddingProvider, semanticIndexEnabled } from '../src/modules/workspaces/knowledge-indexing';

describe('knowledge indexing primitives', () => {
  it('keeps short FAQ question and answer together with authored Unicode', () => {
    const chunks = chunkKnowledgeText('Question: Return policy?\nAnswer: डिलीवरी के 7 दिनों के भीतर।');
    expect(chunks).toEqual(['Question: Return policy?\nAnswer: डिलीवरी के 7 दिनों के भीतर।']);
  });

  it('bounds long text chunks and overlaps adjacent chunks', () => {
    const content = `${'policy '.repeat(180)}\n\n${'नियम '.repeat(180)}`;
    const chunks = chunkKnowledgeText(content, 800, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 800)).toBe(true);
    expect(chunks.join(' ')).toContain('नियम');
  });

  it('fingerprints exact source text deterministically', () => {
    expect(contentHash('हिंदी')).toBe(contentHash('हिंदी'));
    expect(contentHash('हिंदी')).not.toBe(contentHash('Hindi'));
  });

  it('validates provider vector dimensions and sends bounded multilingual input', async () => {
    const provider = new OpenAiEmbeddingProvider('test-key');
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: Array(provider.dimensions).fill(0.01) }] }), { status: 200 }));
    try {
      const result = await provider.embed(['Return within 7 days.\n\n7 din me return.']);
      expect(result[0]).toHaveLength(provider.dimensions);
      const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
      expect(body.model).toBe(provider.model);
      expect(body.dimensions).toBe(provider.dimensions);
    } finally { fetch.mockRestore(); }
  });

  it('uses the configured OpenRouter embeddings endpoint and OpenRouter model profile', async () => {
    const provider = new OpenRouterEmbeddingProvider('test-openrouter-key');
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: Array(provider.dimensions).fill(0.01) }] }), { status: 200 }));
    try {
      const vectors = await provider.embed(['English PDF business fact']);
      expect(vectors[0]).toHaveLength(1536);
      expect(fetch.mock.calls[0]?.[0]).toBe('https://openrouter.ai/api/v1/embeddings');
      expect((fetch.mock.calls[0]?.[1]?.headers as Record<string, string>).authorization).toBe('Bearer test-openrouter-key');
      const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
      expect(body).toMatchObject({ model: 'openai/text-embedding-3-small', dimensions: 1536, input: ['English PDF business fact'] });
    } finally { fetch.mockRestore(); }
  });

  it('selects OpenRouter embeddings only from its independent Knowledge profile', () => {
    const keys = ['KNOWLEDGE_SEMANTIC_ENABLED', 'KNOWLEDGE_EMBEDDING_PROVIDER', 'KNOWLEDGE_EMBEDDING_MODEL', 'KNOWLEDGE_EMBEDDING_BASE_URL', 'OPENROUTER_API_KEY'];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      Object.assign(process.env, { KNOWLEDGE_SEMANTIC_ENABLED: 'true', KNOWLEDGE_EMBEDDING_PROVIDER: 'openrouter', KNOWLEDGE_EMBEDDING_MODEL: 'openai/text-embedding-3-small', KNOWLEDGE_EMBEDDING_BASE_URL: 'https://openrouter.ai/api/v1', OPENROUTER_API_KEY: 'offline-placeholder' });
      jest.isolateModules(() => {
        const indexing = require('../src/modules/workspaces/knowledge-indexing');
        expect(indexing.semanticConfigurationError()).toBeUndefined();
        expect(indexing.createEmbeddingProvider()).toMatchObject({ provider: 'openrouter', model: 'openai/text-embedding-3-small', dimensions: 1536 });
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  it('honors Knowledge ENV loaded after the module was imported', () => {
    const keys = ['KNOWLEDGE_SEMANTIC_ENABLED', 'KNOWLEDGE_EMBEDDING_PROVIDER', 'KNOWLEDGE_EMBEDDING_MODEL', 'KNOWLEDGE_EMBEDDING_BASE_URL', 'OPENROUTER_API_KEY'];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      Object.assign(process.env, { KNOWLEDGE_SEMANTIC_ENABLED: 'true', KNOWLEDGE_EMBEDDING_PROVIDER: 'openrouter', KNOWLEDGE_EMBEDDING_MODEL: 'openai/text-embedding-3-small', KNOWLEDGE_EMBEDDING_BASE_URL: 'https://openrouter.ai/api/v1', OPENROUTER_API_KEY: 'offline-placeholder' });
      expect(semanticIndexEnabled()).toBe(true);
      expect(createEmbeddingProvider()).toMatchObject({ provider: 'openrouter', model: 'openai/text-embedding-3-small', dimensions: 1536 });
    } finally {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  it('rejects an incompatible provider vector instead of persisting it', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2] }] }), { status: 200 }));
    try {
      const request = new OpenAiEmbeddingProvider('test-key').embed(['text']);
      await expect(request).rejects.toThrow('incompatible vector dimensions');
      await expect(request).rejects.toMatchObject({ code: 'EMBEDDING_DIMENSION_MISMATCH' });
    }
    finally { fetch.mockRestore(); }
  });

  it('does not initialize embeddings by default, keeping lexical indexing provider-free', () => {
    const prior = process.env.KNOWLEDGE_SEMANTIC_ENABLED;
    process.env.KNOWLEDGE_SEMANTIC_ENABLED = 'false';
    try { expect(createEmbeddingProvider()).toBeNull(); }
    finally { if (prior === undefined) delete process.env.KNOWLEDGE_SEMANTIC_ENABLED; else process.env.KNOWLEDGE_SEMANTIC_ENABLED = prior; }
  });

  it.each<[string, Record<string, string>, string]>([
    ['missing credentials', { KNOWLEDGE_EMBEDDING_PROVIDER: 'openai', KNOWLEDGE_EMBEDDING_MODEL: 'text-embedding-3-small', OPENAI_API_KEY: '', KNOWLEDGE_SEMANTIC_MIN_SIMILARITY: '0.3' }, 'EMBEDDING_PROVIDER_NOT_CONFIGURED'],
    ['missing OpenRouter credential', { KNOWLEDGE_EMBEDDING_PROVIDER: 'openrouter', KNOWLEDGE_EMBEDDING_MODEL: 'openai/text-embedding-3-small', OPENROUTER_API_KEY: '', KNOWLEDGE_SEMANTIC_MIN_SIMILARITY: '0.3' }, 'EMBEDDING_PROVIDER_NOT_CONFIGURED'],
    ['unsupported model', { KNOWLEDGE_EMBEDDING_PROVIDER: 'openai', KNOWLEDGE_EMBEDDING_MODEL: 'incompatible', OPENAI_API_KEY: 'offline-placeholder', KNOWLEDGE_SEMANTIC_MIN_SIMILARITY: '0.3' }, 'EMBEDDING_PROFILE_UNSUPPORTED'],
    ['unapproved OpenRouter base URL', { KNOWLEDGE_EMBEDDING_PROVIDER: 'openrouter', KNOWLEDGE_EMBEDDING_MODEL: 'openai/text-embedding-3-small', KNOWLEDGE_EMBEDDING_BASE_URL: 'https://example.invalid/v1', OPENROUTER_API_KEY: 'offline-placeholder', KNOWLEDGE_SEMANTIC_MIN_SIMILARITY: '0.3' }, 'EMBEDDING_PROVIDER_BASE_URL_INVALID'],
    ['invalid similarity floor', { KNOWLEDGE_EMBEDDING_PROVIDER: 'openai', KNOWLEDGE_EMBEDDING_MODEL: 'text-embedding-3-small', OPENAI_API_KEY: 'offline-placeholder', KNOWLEDGE_SEMANTIC_MIN_SIMILARITY: 'NaN' }, 'SEMANTIC_SIMILARITY_CONFIGURATION_INVALID'],
  ])('exposes %s without initializing a provider', (_description, settings, code) => {
    const changes: Record<string, string> = { ...settings, KNOWLEDGE_SEMANTIC_ENABLED: 'true' };
    const previous = Object.fromEntries(Object.keys(changes).map((key) => [key, process.env[key]]));
    try {
      Object.assign(process.env, changes);
      jest.isolateModules(() => {
        const indexing = require('../src/modules/workspaces/knowledge-indexing');
        expect(indexing.semanticConfigurationError()).toBe(code);
        expect(indexing.createEmbeddingProvider()).toBeNull();
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

});
