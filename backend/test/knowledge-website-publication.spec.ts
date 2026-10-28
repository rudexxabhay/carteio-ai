import { KnowledgeProcessingService } from '../src/modules/workspaces/knowledge-processing.service';
import { contentHash } from '../src/modules/workspaces/knowledge-indexing';

const websiteSource = {
  id: 'source-a', organizationId: 'tenant-a', sourceVersion: 3, activeIndexGeneration: null,
  status: 'REGISTERED', type: 'WEBSITE', sourceUrl: 'https://merchant.example/',
  syncPolicy: 'MANUAL', crawlMaxPages: 50, crawlMaxDepth: 3, crawlPathPrefix: '/',
};
const crawlJob = { id: 'job-a', organizationId: 'tenant-a', sourceId: 'source-a', sourceVersion: 3, kind: 'CRAWL', attempts: 1 };
const verifiedGate = { category: null, description: null, verificationStatus: 'PENDING', verifiedAt: null };

function makePages(contents: string[]) {
  return contents.map((content, index) => ({
    url: `https://merchant.example/page-${index + 1}`,
    title: `Page ${index + 1}`,
    content,
    contentHash: contentHash(content),
    depth: 1,
    extractionMethod: 'HTML' as const,
  }));
}

function fixture(pages: ReturnType<typeof makePages>, crawlOverrides: Record<string, unknown> = {}) {
  let pageId = 0;
  const tx: any = {
    knowledgeProcessingJob: {
      findFirst: jest.fn().mockResolvedValue({ id: crawlJob.id }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    knowledgeSource: {
      findFirst: jest.fn().mockResolvedValue(verifiedGate),
      update: jest.fn().mockResolvedValue({}),
    },
    knowledgePage: {
      upsert: jest.fn().mockImplementation(() => Promise.resolve({ id: `page-${++pageId}` })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    knowledgeSyncRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    knowledgeBase: { findMany: jest.fn().mockResolvedValue([]) },
    knowledgeBaseSource: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    knowledgeChunk: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const db: any = {
    knowledgeProcessingJob: { findFirst: jest.fn().mockResolvedValue({ id: crawlJob.id }) },
    knowledgeSource: { findFirst: jest.fn().mockResolvedValue(verifiedGate) },
    knowledgePage: { findMany: jest.fn().mockResolvedValue([]) },
    connectorInstance: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (callback: (client: any) => unknown, _options?: unknown) => callback(tx)),
  };
  const service: any = new KnowledgeProcessingService(db, {} as any, {} as any);
  service.embeddings = null;
  service.crawler.crawl = jest.fn().mockResolvedValue({
    pages, removedUrls: [], notModifiedUrls: [], discovered: pages.length,
    complete: true, skippedRobots: 0, failed: 0, retryableFailures: 0,
    unsupportedPages: 0, totalBytes: pages.reduce((sum, page) => sum + Buffer.byteLength(page.content), 0),
    ...crawlOverrides,
  });
  return { service, db, tx };
}

describe('website index publication transaction', () => {
  it('uses a bounded transaction and publishes multiple tenant-scoped pages and chunks atomically', async () => {
    const test = fixture(makePages(['Shipping details and delivery times.', 'Returns are accepted within 14 days.', 'Contact the support team for help.']));

    await test.service.processWebsite(crawlJob, websiteSource);

    expect(test.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 30_000, maxWait: 5_000 });
    expect(test.tx.knowledgePage.upsert).toHaveBeenCalledTimes(3);
    expect(test.tx.$executeRaw).toHaveBeenCalledTimes(3);
    expect(test.tx.knowledgePage.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sourceId_canonicalUrl_sourceVersion: { sourceId: 'source-a', canonicalUrl: 'https://merchant.example/page-1', sourceVersion: 3 } },
      create: expect.objectContaining({ organizationId: 'tenant-a', sourceId: 'source-a' }),
    }));
    expect(test.tx.knowledgeSource.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id_organizationId: { id: 'source-a', organizationId: 'tenant-a' } },
      data: expect.objectContaining({ activeIndexGeneration: 1, processingStatus: 'READY' }),
    }));
    expect(test.tx.knowledgeProcessingJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED', stage: 'INDEX_PUBLISHED' }) }));
  });

  it('auto-links an opted-in website source only after a complete active index is published', async () => {
    const test = fixture(makePages(['Shipping details and delivery times.']));
    test.tx.knowledgeBase.findMany.mockResolvedValue([{ id: 'base-opted-in' }]);

    await test.service.processWebsite(crawlJob, websiteSource);

    expect(test.tx.knowledgeBaseSource.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: 'tenant-a', knowledgeBaseId: 'base-opted-in', sourceId: 'source-a' }],
      skipDuplicates: true,
    });
  });

  it('persists a large page as bounded chunks within the publication transaction', async () => {
    const largeContent = 'Merchant policy content. '.repeat(700);
    const test = fixture(makePages([largeContent]));

    await test.service.processWebsite(crawlJob, websiteSource);

    expect(test.tx.knowledgePage.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ content: largeContent }) }));
    expect(test.tx.$executeRaw.mock.calls.length).toBeGreaterThan(1);
    expect(test.db.$transaction.mock.calls[0]?.[1]).toEqual({ timeout: 30_000, maxWait: 5_000 });
  });

  it('does not publish the active generation or complete the job when transaction persistence fails', async () => {
    const test = fixture(makePages(['A page that will fail during chunk persistence.']));
    const transactionError = Object.assign(new Error('Transaction already closed'), { code: 'P2028' });
    test.tx.$executeRaw.mockRejectedValue(transactionError);
    test.db.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(test.tx));

    await expect(test.service.processWebsite(crawlJob, websiteSource)).rejects.toBe(transactionError);

    expect(test.tx.knowledgePage.upsert).toHaveBeenCalledTimes(1);
    expect(test.tx.knowledgeSource.update).not.toHaveBeenCalled();
    expect(test.tx.knowledgeProcessingJob.updateMany).not.toHaveBeenCalled();
    expect(test.tx.knowledgeSyncRun.updateMany).not.toHaveBeenCalled();
  });

  it('keeps partial crawl results visible as warnings instead of reporting a complete sync', async () => {
    const test = fixture(makePages(['One successfully extracted page.']), { complete: false, failed: 2, retryableFailures: 1, errorCode: 'CRAWL_PARTIAL' });

    await test.service.processWebsite(crawlJob, websiteSource);

    expect(test.tx.knowledgeSyncRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SUCCEEDED_WITH_WARNINGS', failedPages: 2, errorCode: 'CRAWL_PARTIAL' }),
    }));
    expect(test.tx.knowledgeSource.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastSyncErrorCode: 'CRAWL_PARTIAL' }) }));
    expect(test.tx.knowledgeSource.update.mock.calls[0]?.[0].data).not.toHaveProperty('lastSuccessfulSyncAt');
    expect(test.tx.knowledgeBaseSource.createMany).not.toHaveBeenCalled();
  });

  it('reuses deterministic chunk identifiers for a retry of the same unpublished generation', async () => {
    const pages = makePages(['Retry-safe page content.']);
    const first = fixture(pages);
    const retry = fixture(pages);

    await first.service.processWebsite(crawlJob, websiteSource);
    await retry.service.processWebsite(crawlJob, websiteSource);

    expect(first.tx.$executeRaw.mock.calls[0]?.[1]).toBe(retry.tx.$executeRaw.mock.calls[0]?.[1]);
    expect(first.tx.knowledgeSource.update.mock.calls[0]?.[0].where).toEqual({ id_organizationId: { id: 'source-a', organizationId: 'tenant-a' } });
  });
});
