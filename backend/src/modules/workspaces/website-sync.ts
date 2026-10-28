import type { CrawlPage } from './website-crawler';
import { contentHash } from './knowledge-indexing';

export type StoredWebsitePage = Pick<CrawlPage, 'url' | 'title' | 'content' | 'contentHash' | 'extractionMethod' | 'pageCategory' | 'language'> & { fetchedAt?: Date };

export type ReusableIndexedChunk = { contentHash: string; embeddingProvider: string; embeddingModel: string; embeddingDimensions: number; embedding: string | null };

export function canReuseIndexedChunks(parts: readonly string[], chunks: readonly ReusableIndexedChunk[], profile?: { provider: string; model: string; dimensions: number }): boolean {
  if (parts.length === 0 || chunks.length !== parts.length) return false;
  return chunks.every((chunk, index) => chunk.contentHash === contentHash(parts[index]!) && (!profile || (
    chunk.embedding !== null && chunk.embeddingProvider === profile.provider && chunk.embeddingModel === profile.model && chunk.embeddingDimensions === profile.dimensions
  )));
}

export function authoritativeRemovedUrls(crawl: { complete: boolean; removedUrls: string[] }): string[] {
  return crawl.complete ? [...new Set(crawl.removedUrls)] : [];
}

/** Keep unobserved prior pages; only explicit 404/410 evidence can retire them. */
export function prepareWebsiteSyncPages(fetched: CrawlPage[], previous: StoredWebsitePage[], removedUrls: string[]) {
  const fetchedByUrl = new Map(fetched.map((page) => [page.url, page]));
  const removed = new Set(removedUrls);
  const previousByUrl = new Map(previous.map((page) => [page.url, page]));
  const changedPages = fetched.filter((page) => previousByUrl.get(page.url)?.contentHash !== page.contentHash
    || (previousByUrl.get(page.url)?.extractionMethod ?? 'HTML') !== (page.extractionMethod ?? 'HTML')
    || previousByUrl.get(page.url)?.pageCategory !== page.pageCategory
    || previousByUrl.get(page.url)?.language !== page.language).length;
  const unchangedPages = fetched.length - changedPages;
  const removedPages = previous.filter((page) => removed.has(page.url)).length;
  const pages = [
    ...fetched,
    ...previous.filter((page) => !fetchedByUrl.has(page.url) && !removed.has(page.url)).map((page) => ({ ...page, depth: 0 })),
  ].sort((left, right) => left.url.localeCompare(right.url));
  return { pages, changedPages, unchangedPages, removedPages };
}
