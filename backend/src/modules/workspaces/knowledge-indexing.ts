import { createHash } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

export const EMBEDDING_DIMENSIONS = 1536;
const OPENAI_EMBEDDING_BASE_URL = 'https://api.openai.com/v1';
const OPENROUTER_EMBEDDING_BASE_URL = 'https://openrouter.ai/api/v1';

/** Resolve at use time: the API entry point loads .env after its static imports. */
export function semanticIndexEnabled(): boolean {
  return process.env.KNOWLEDGE_SEMANTIC_ENABLED === 'true';
}

/** Cosine similarity is a relevance gate, applied before reciprocal-rank fusion. */
export function semanticMinimumSimilarity(): number {
  return Number(process.env.KNOWLEDGE_SEMANTIC_MIN_SIMILARITY ?? '0.3');
}

export interface EmbeddingProvider {
  readonly provider: 'openai' | 'openrouter';
  readonly model: 'text-embedding-3-small' | 'openai/text-embedding-3-small';
  readonly dimensions: 1536;
  embed(inputs: string[]): Promise<number[][]>;
}

type EmbeddingConfiguration = { provider: 'openai' | 'openrouter'; model: EmbeddingProvider['model']; baseUrl: string; apiKey: string };

function embeddingConfiguration(): EmbeddingConfiguration | null {
  if (!semanticIndexEnabled() || semanticConfigurationError()) return null;
  const provider = process.env.KNOWLEDGE_EMBEDDING_PROVIDER as EmbeddingConfiguration['provider'];
  const model = (process.env.KNOWLEDGE_EMBEDDING_MODEL || (provider === 'openai' ? 'text-embedding-3-small' : 'openai/text-embedding-3-small')) as EmbeddingConfiguration['model'];
  const baseUrl = process.env.KNOWLEDGE_EMBEDDING_BASE_URL || (provider === 'openai' ? OPENAI_EMBEDDING_BASE_URL : OPENROUTER_EMBEDDING_BASE_URL);
  const apiKey = provider === 'openrouter' ? process.env.OPENROUTER_API_KEY! : process.env.OPENAI_API_KEY!;
  return { provider, model, baseUrl, apiKey };
}

/** Embeddings are opt-in and use a Knowledge-only provider profile, independent of chat routing. */
export function createEmbeddingProvider(): EmbeddingProvider | null {
  if (!semanticIndexEnabled()) return null;
  if (semanticConfigurationError()) return null;
  const config = embeddingConfiguration();
  return config?.provider === 'openrouter' ? new OpenRouterEmbeddingProvider(config.apiKey, config.baseUrl) : config ? new OpenAiEmbeddingProvider(config.apiKey, config.baseUrl) : null;
}

export function semanticConfigurationError(): string | undefined {
  if (!semanticIndexEnabled()) return undefined;
  const minimumSimilarity = semanticMinimumSimilarity();
  if (!Number.isFinite(minimumSimilarity) || minimumSimilarity < 0 || minimumSimilarity > 1) return 'SEMANTIC_SIMILARITY_CONFIGURATION_INVALID';
  const provider = process.env.KNOWLEDGE_EMBEDDING_PROVIDER;
  if (provider !== 'openai' && provider !== 'openrouter') return 'EMBEDDING_PROFILE_UNSUPPORTED';
  const model = process.env.KNOWLEDGE_EMBEDDING_MODEL || (provider === 'openai' ? 'text-embedding-3-small' : 'openai/text-embedding-3-small');
  if ((provider === 'openai' && model !== 'text-embedding-3-small') || (provider === 'openrouter' && model !== 'openai/text-embedding-3-small')) return 'EMBEDDING_PROFILE_UNSUPPORTED';
  const expectedBaseUrl = provider === 'openai' ? OPENAI_EMBEDDING_BASE_URL : OPENROUTER_EMBEDDING_BASE_URL;
  const baseUrl = process.env.KNOWLEDGE_EMBEDDING_BASE_URL || expectedBaseUrl;
  if (baseUrl !== expectedBaseUrl) return 'EMBEDDING_PROVIDER_BASE_URL_INVALID';
  if (!(provider === 'openrouter' ? process.env.OPENROUTER_API_KEY : process.env.OPENAI_API_KEY)) return 'EMBEDDING_PROVIDER_NOT_CONFIGURED';
  return undefined;
}

/** Deterministic UUID for a logical chunk; retries cannot create duplicate identities. */
export function stableKnowledgeChunkId(input: { sourceId: string; sourceVersion: number; generation: number; sequence: number; contentHash: string }): string {
  const digest = createHash('sha256').update(`${input.sourceId}:${input.sourceVersion}:${input.generation}:${input.sequence}:${input.contentHash}`).digest();
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x80;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Deterministic whitespace normalization without stripping merchant facts or Unicode. */
export function normalizeKnowledgeText(text: string): string {
  return text.normalize('NFKC').replace(/\r\n?/g, '\n').replace(/[\t\f\v ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Heading-aware Unicode-preserving chunking. FAQ question-answer pairs stay together. */
export function chunkKnowledgeText(text: string, maxChars = 2800, overlapChars = 240): string[] {
  if (!Number.isInteger(maxChars) || maxChars < 500 || maxChars > 8000 || overlapChars < 0 || overlapChars >= maxChars / 2) throw new Error('Invalid bounded chunk configuration');
  const paragraphs = normalizeKnowledgeText(text).split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  let heading = '';
  for (const paragraph of paragraphs) {
    const isHeading = /^#{1,6}\s+\S/.test(paragraph) || (paragraph.length <= 140 && !/[.!?。！？]$/.test(paragraph) && paragraph.split(/\s+/).length <= 14);
    if (isHeading) heading = paragraph;
    const unit = isHeading ? paragraph : heading && !paragraph.startsWith(`${heading}\n`) ? `${heading}\n${paragraph}` : paragraph;
    if (unit.length > maxChars) {
      if (current) { chunks.push(current); current = ''; }
      let start = 0;
      while (start < unit.length) {
        const end = Math.min(unit.length, start + maxChars);
        const boundary = end < unit.length ? unit.lastIndexOf(' ', end) : end;
        const safeEnd = boundary > start + Math.floor(maxChars * 0.6) ? boundary : end;
        chunks.push(unit.slice(start, safeEnd).trim());
        if (safeEnd >= unit.length) break;
        start = Math.max(start + 1, safeEnd - overlapChars);
      }
      continue;
    }
    if (!current) current = unit;
    else if (current.length + unit.length + 2 <= maxChars) current += `\n\n${unit}`;
    else { chunks.push(current); current = `${current.slice(-overlapChars)}\n\n${unit}`.trim(); }
  }
  if (current) chunks.push(current);
  return chunks;
}

export const contentHash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

/** Keeps the first source-order occurrence of each normalized chunk body. */
export function deduplicateKnowledgeChunks(parts: readonly string[]): string[] {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const hash = contentHash(normalizeKnowledgeText(part));
    if (!hash || seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
}

function validateBatch(inputs: string[]) {
  if (!inputs.length || inputs.length > 64 || inputs.some((item) => item.length > 8000)) throw new Error('Embedding batch exceeds configured bounds');
}

/** Shared OpenAI-compatible wire client; provider/model identity remains explicit in persisted chunks. */
class OpenAiCompatibleEmbeddingClient {
  readonly dimensions = EMBEDDING_DIMENSIONS as 1536;
  constructor(readonly provider: EmbeddingProvider['provider'], readonly model: EmbeddingProvider['model'], private readonly apiKey: string | undefined, private readonly baseUrl: string) {}
  async embed(inputs: string[]): Promise<number[][]> {
    validateBatch(inputs);
    if (!this.apiKey) throw new ServiceUnavailableException({ code: 'EMBEDDING_PROVIDER_NOT_CONFIGURED', message: 'Configure the selected Knowledge embedding provider and explicitly enable semantic indexing.' });
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, dimensions: this.dimensions, input: inputs, encoding_format: 'float' }),
        signal: AbortSignal.timeout(30_000), redirect: 'error',
      });
    } catch { throw new ServiceUnavailableException({ code: 'EMBEDDING_PROVIDER_UNAVAILABLE', message: 'The configured embedding service could not be reached.' }); }
    if (response.status === 429 || response.status >= 500) throw new ServiceUnavailableException({ code: 'EMBEDDING_PROVIDER_RETRYABLE', message: 'The configured embedding service is temporarily unavailable.' });
    if (response.status === 401) throw new ServiceUnavailableException({ code: 'EMBEDDING_PROVIDER_AUTH_FAILED', message: 'The configured embedding credential was rejected.' });
    if (response.status === 403) throw new ServiceUnavailableException({ code: 'EMBEDDING_PROVIDER_FORBIDDEN', message: 'The configured embedding account is not permitted to use this model.' });
    if (response.status === 402) throw new ServiceUnavailableException({ code: 'EMBEDDING_PROVIDER_PAYMENT_REQUIRED', message: 'The embedding provider requires an active account or available credits.' });
    if (response.status === 404) throw new ServiceUnavailableException({ code: 'EMBEDDING_PROVIDER_MODEL_OR_ENDPOINT_NOT_FOUND', message: 'The configured embedding model or endpoint was not found.' });
    if (!response.ok) throw new ServiceUnavailableException({ code: 'EMBEDDING_PROVIDER_REQUEST_FAILED', message: 'The configured embedding service rejected the request.' });
    let payload: { data?: Array<{ index: number; embedding: unknown }> };
    try { payload = await response.json() as typeof payload; }
    catch { throw Object.assign(new Error('Embedding provider returned invalid JSON'), { code: 'EMBEDDING_PROVIDER_INVALID_RESPONSE' }); }
    if (!Array.isArray(payload.data) || payload.data.length !== inputs.length || payload.data.some((item) => !Number.isInteger(item?.index) || item.index < 0 || item.index >= inputs.length || !Array.isArray(item.embedding))) {
      throw Object.assign(new Error('Embedding provider returned an invalid response shape'), { code: 'EMBEDDING_PROVIDER_INVALID_RESPONSE' });
    }
    const ordered = [...payload.data].sort((a, b) => a.index - b.index);
    if (ordered.some((item, index) => item.index !== index)) throw Object.assign(new Error('Embedding provider returned invalid result indices'), { code: 'EMBEDDING_PROVIDER_INVALID_RESPONSE' });
    const vectors = ordered.map((item) => item.embedding as number[]);
    if (vectors.some((vector) => vector.length !== this.dimensions || vector.some((n) => !Number.isFinite(n)))) throw Object.assign(new Error('Embedding provider returned incompatible vector dimensions'), { code: 'EMBEDDING_DIMENSION_MISMATCH' });
    return vectors;
  }
}

/** Direct OpenAI embeddings remain supported for existing explicitly configured deployments. */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'openai' as const;
  readonly model = 'text-embedding-3-small' as const;
  readonly dimensions = EMBEDDING_DIMENSIONS as 1536;
  private readonly client: OpenAiCompatibleEmbeddingClient;
  constructor(apiKey = process.env.OPENAI_API_KEY, baseUrl = OPENAI_EMBEDDING_BASE_URL) { this.client = new OpenAiCompatibleEmbeddingClient(this.provider, this.model, apiKey, baseUrl); }
  embed(inputs: string[]) { return this.client.embed(inputs); }
}

/** OpenRouter embedding profile; it reuses only the existing OpenRouter backend credential. */
export class OpenRouterEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'openrouter' as const;
  readonly model = 'openai/text-embedding-3-small' as const;
  readonly dimensions = EMBEDDING_DIMENSIONS as 1536;
  private readonly client: OpenAiCompatibleEmbeddingClient;
  constructor(apiKey = process.env.OPENROUTER_API_KEY, baseUrl = OPENROUTER_EMBEDDING_BASE_URL) { this.client = new OpenAiCompatibleEmbeddingClient(this.provider, this.model, apiKey, baseUrl); }
  embed(inputs: string[]) { return this.client.embed(inputs); }
}
