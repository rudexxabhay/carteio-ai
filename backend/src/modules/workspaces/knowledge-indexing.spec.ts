import { chunkKnowledgeText, contentHash, deduplicateKnowledgeChunks, normalizeKnowledgeText, stableKnowledgeChunkId } from './knowledge-indexing';

describe('knowledge indexing contract', () => {
  it('normalizes line endings and whitespace deterministically while retaining Unicode facts', () => {
    expect(normalizeKnowledgeText('  Returns\r\n\r\n  सात दिन  ')).toBe('Returns\n\nसात दिन');
  });

  it('keeps a heading attached to its section and preserves FAQ question-answer pairs', () => {
    const chunks = chunkKnowledgeText('## Shipping\n\nWe deliver within three days.\n\nQuestion: Can I return this?\nAnswer: Yes, within seven days.');
    expect(chunks[0]).toContain('## Shipping');
    expect(chunks[0]).toContain('We deliver within three days.');
    expect(chunks.at(-1)).toContain('Question: Can I return this?');
    expect(chunks.at(-1)).toContain('Answer: Yes, within seven days.');
  });

  it('deduplicates normalized chunk bodies while keeping their first source-order occurrence', () => {
    expect(deduplicateKnowledgeChunks(['Same  fact.', 'Same fact.', 'Different fact.'])).toEqual(['Same  fact.', 'Different fact.']);
  });

  it('keeps chunks bounded for long content and produces stable identities for the same source version', () => {
    const content = `## Details\n\n${'Merchant fact '.repeat(1000)}`;
    const first = chunkKnowledgeText(content, 800, 100);
    const second = chunkKnowledgeText(content, 800, 100);
    expect(first.length).toBeGreaterThan(1);
    expect(first.every((chunk) => chunk.length <= 800)).toBe(true);
    expect(first).toEqual(second);
    const firstChunk = first[0];
    if (firstChunk === undefined) throw new Error('Expected chunkKnowledgeText to return a chunk.');
    const identity = { sourceId: 'source-a', sourceVersion: 3, generation: 2, sequence: 0, contentHash: contentHash(firstChunk) };
    expect(stableKnowledgeChunkId(identity)).toBe(stableKnowledgeChunkId(identity));
    expect(stableKnowledgeChunkId(identity)).not.toBe(stableKnowledgeChunkId({ ...identity, sourceVersion: 4 }));
    expect(stableKnowledgeChunkId(identity)).not.toBe(stableKnowledgeChunkId({ ...identity, generation: 3 }));
  });
});
