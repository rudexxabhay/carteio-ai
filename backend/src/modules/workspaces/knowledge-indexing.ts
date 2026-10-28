import { createHash } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

export const EMBEDDING_DIMENSIONS = 1536;
export const SEMANTIC_INDEX_ENABLED = process.env.KNOWLEDGE_SEMANTIC_ENABLED === 'true';

/** Cosine similarity is a relevance gate, applied before reciprocal-rank fusion. */
export function semanticMinimumSimilarity(): number {
  return Number(process.env.KNOWLEDGE_SEMANTIC_MIN_SIMILARITY ?? '0.3');
}

export interface EmbeddingProvider {
  readonly provider: 'openai';
  readonly model: 'text-embedding-3-small';
  readonly dimensions: 1536;
  embed(inputs: string[]): Promise<number[][]>;
}

/** Embeddings are opt-in. Groq credentials are not an embeddings capability. */
export function createEmbeddingProvider(): EmbeddingProvider | null {
  if (!SEMANTIC_INDEX_ENABLED) return null;
  if (semanticConfigurationError()) return null;
  return new OpenAiEmbeddingProvider();
}

export function semanticConfigurationError(): string | undefined {
  if (!SEMANTIC_INDEX_ENABLED) return undefined;
  const minimumSimilarity = semanticMinimumSimilarity();
  if (!Number.isFinite(minimumSimilarity) || minimumSimilarity < 0 || minimumSimilarity > 1) return 'SEMANTIC_SIMILARITY_CONFIGURATION_INVALID';
  if (process.env.KNOWLEDGE_EMBEDDING_PROVIDER !== 'openai') return 'EMBEDDING_PROFILE_UNSUPPORTED';
  const model = process.env.KNOWLEDGE_EMBEDDING_MODEL ?? 'text-embedding-3-small';
  if (model !== 'text-embedding-3-small') return 'EMBEDDING_PROFILE_UNSUPPORTED';
  if (!process.env.OPENAI_API_KEY) return 'EMBEDDING_PROVIDER_NOT_CONFIGURED';
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

/** Optional semantic adapter. It is never created or called without explicit opt-in. */
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly provider = 'openai' as const;
  readonly model = 'text-embedding-3-small' as const;
  readonly dimensions = 1536 as const;
  constructor(private readonly apiKey = process.env.OPENAI_API_KEY) {}
  async embed(inputs: string[]): Promise<number[][]> {
    validateBatch(inputs);
    if (!this.apiKey) throw new ServiceUnavailableException({ code: 'EMBEDDING_PROVIDER_NOT_CONFIGURED', message: 'Configure an OpenAI API key and explicitly enable semantic indexing.' });
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST', headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, dimensions: this.dimensions, input: inputs, encoding_format: 'float' }),
        signal: AbortSignal.timeout(30_000), redirect: 'error',
      });
    } catch { throw new ServiceUnavailableException({ code: 'EMBEDDING_PROVIDER_UNAVAILABLE', message: 'The configured embedding service could not be reached.' }); }
    if (response.status === 429 || response.status >= 500) throw new ServiceUnavailableException({ code: 'EMBEDDING_PROVIDER_RETRYABLE', message: 'The configured embedding service is temporarily unavailable.' });
    if (!response.ok) throw new ServiceUnavailableException({ code: response.status === 401 ? 'EMBEDDING_PROVIDER_AUTH_FAILED' : 'EMBEDDING_PROVIDER_REQUEST_FAILED', message: 'The configured embedding service rejected the request.' });
    const payload = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
    const vectors = (payload.data ?? []).sort((a, b) => a.index - b.index).map((item) => item.embedding);
    if (vectors.length !== inputs.length || vectors.some((vector) => vector.length !== this.dimensions || vector.some((n) => !Number.isFinite(n)))) throw Object.assign(new Error('Embedding provider returned incompatible vector dimensions'), { code: 'EMBEDDING_DIMENSION_MISMATCH' });
    return vectors;
  }
}
