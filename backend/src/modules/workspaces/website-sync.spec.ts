import { authoritativeRemovedUrls, canReuseIndexedChunks, prepareWebsiteSyncPages } from './website-sync';
import { contentHash } from './knowledge-indexing';
import type { CrawlPage } from './website-crawler';

const page = (url: string, contentHash: string): CrawlPage => ({ url, title: url, content: `content ${contentHash}`, contentHash, depth: 1 });

describe('website synchronization page retention', () => {
  it('allows page removals only from a complete crawl snapshot', () => {
    expect(authoritativeRemovedUrls({ complete: false, removedUrls: ['https://business.example/old'] })).toEqual([]);
    expect(authoritativeRemovedUrls({ complete: true, removedUrls: ['https://business.example/old', 'https://business.example/old'] })).toEqual(['https://business.example/old']);
  });
  it('reuses embeddings only when chunk content and the configured embedding profile match', () => {
    const parts = ['Returns are accepted within 30 days.'];
    const chunks = [{ contentHash: contentHash(parts[0]!), embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small', embeddingDimensions: 1536, embedding: '[0.1,0.2]' }];
    expect(canReuseIndexedChunks(parts, chunks, { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 })).toBe(true);
    expect(canReuseIndexedChunks(['Returns are accepted within 14 days.'], chunks, { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 })).toBe(false);
    expect(canReuseIndexedChunks(parts, chunks, { provider: 'other', model: 'different', dimensions: 768 })).toBe(false);
  });
  it('retains a prior page omitted by crawl limits until a 404/410 confirms removal', () => {
    const old = page('https://business.example/old', 'oldhash');
    const fetched = page('https://business.example/home', 'samehash');
    const retained = prepareWebsiteSyncPages([fetched], [old, fetched], []);
    expect(retained.pages.map((item) => item.url).sort()).toEqual([old.url, fetched.url].sort());
    expect(retained.removedPages).toBe(0);
    const removed = prepareWebsiteSyncPages([fetched], [old, fetched], [old.url]);
    expect(removed.pages.map((item) => item.url)).toEqual([fetched.url]);
    expect(removed.removedPages).toBe(1);
  });

  it('counts changed and unchanged fetched pages from content fingerprints', () => {
    const prior = [page('https://business.example/unchanged', 'a'), page('https://business.example/changed', 'before')];
    const result = prepareWebsiteSyncPages([page(prior[0]!.url, 'a'), page(prior[1]!.url, 'after')], prior, []);
    expect(result.changedPages).toBe(1);
    expect(result.unchangedPages).toBe(1);
  });

  it('treats a page classification or language change as an update even when body text is unchanged', () => {
    const prior = { ...page('https://business.example/pages/help', 'same'), pageCategory: 'GENERAL' as const, language: 'en' };
    const next = { ...prior, pageCategory: 'FAQ' as const, language: 'en-GB' };
    const result = prepareWebsiteSyncPages([next], [prior], []);
    expect(result.changedPages).toBe(1);
    expect(result.unchangedPages).toBe(0);
  });
});
