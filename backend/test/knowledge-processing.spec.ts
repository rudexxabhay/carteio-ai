import { Logger } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import { KnowledgeProcessingService } from '../src/modules/workspaces/knowledge-processing.service';

const vector = Array.from({ length: 1536 }, (_, index) => index === 0 ? 1 : 0);
const pdfDocument = { filename: 'fixture.pdf', bytes: 1000, hash: 'a'.repeat(64), contentHash: 'b'.repeat(64), sourceLanguage: 'en', extracted: true, pageCount: 1, pages: [{ page: 1, start: 0, end: 30, contentHash: 'c'.repeat(64), wordCount: 5 }] };
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((part: unknown) => typeof part === 'string');
const rawQuerySql = (call: unknown): string => {
  if (!Array.isArray(call)) return '';
  const template = call[0];
  return isStringArray(template) ? template.join('') : '';
};

function setup(source: any, embed = jest.fn().mockImplementation((queries: readonly string[]) => Promise.resolve(queries.map(() => vector)))) {
  const tx: any = {
    knowledgeSource: { findFirst: jest.fn().mockResolvedValue({ id: source.id }), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    // process() is only valid for a job currently leased by this worker. The
    // fixture models that database state; the separate lost-lease test below
    // verifies that publication is rejected when ownership is absent.
    knowledgeProcessingJob: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }), findFirst: jest.fn(({ where }: { where: { status?: unknown } }) => Promise.resolve(where.status === 'PROCESSING' ? { id: 'job-a' } : null)), create: jest.fn().mockResolvedValue({ id: 'job-new' }) },
    knowledgeSyncRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    knowledgeChunk: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), findFirst: jest.fn().mockResolvedValue(null) },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const db: any = {
    knowledgeSyncRun: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    connectorInstance: { findMany: jest.fn().mockResolvedValue([]) },
    knowledgeSource: { findFirst: jest.fn().mockResolvedValue(source), findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    knowledgeProcessingJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findMany: jest.fn().mockResolvedValue([]) },
    knowledgeChunk: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue(null), groupBy: jest.fn().mockResolvedValue([]), findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _max: { indexedAt: null } }) },
    chatbot: { findFirst: jest.fn().mockResolvedValue({ id: 'assistant-a' }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(async (callback: (value: any) => unknown) => callback(tx)),
  };
  const workspace: any = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-a', role: 'OWNER' }) };
  const bases: any = { resolveEffectiveSources: jest.fn().mockResolvedValue({ sources: [{ id: source.id, type: source.type, visibility: 'INTERNAL_RESTRICTED' }] }) };
  const service: any = new KnowledgeProcessingService(db, workspace, bases, { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536, embed });
  return { service, db, tx, workspace, bases, embed };
}

const source = (type: 'FAQ' | 'TEXT' | 'WEBSITE' = 'FAQ', overrides = {}) => ({ id: 'source-a', organizationId: 'org-a', sourceVersion: 2, activeIndexGeneration: null, status: 'REGISTERED', processingStatus: 'READY', type, name: 'Return policy?', contentBody: 'Return in सात days.', ...overrides });
const job = { id: 'job-a', organizationId: 'org-a', sourceId: 'source-a', sourceVersion: 2, attempts: 1 };

describe('KnowledgeProcessingService', () => {
  it('returns current-version, tenant-scoped PDF processing progress from persisted records', async () => {
    const test = setup(source('TEXT', { sourceVersion: 3, document: { extracted: true, pageCount: 2, pages: [{ page: 1 }, { page: 2 }] }, processingStatus: 'PROCESSING' }));
    const updatedAt = new Date('2026-01-02T03:04:05.000Z');
    test.db.knowledgeProcessingJob.findMany.mockResolvedValueOnce([{ id: 'job-current', kind: 'INDEX', status: 'PROCESSING', stage: 'INDEXING', attempts: 1, errorCode: null, createdAt: updatedAt, updatedAt }]);
    test.db.knowledgeChunk.count.mockResolvedValueOnce(0);
    const result = await test.service.status('user-a', 'alpha', 'source-a');
    expect(test.db.knowledgeSource.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'source-a', organizationId: 'org-a' }, select: expect.objectContaining({ document: true, sourceVersion: true }) }));
    expect(test.db.knowledgeProcessingJob.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a', sourceId: 'source-a', sourceVersion: 3 }, take: 5 }));
    expect(result.documentProgress).toEqual(expect.objectContaining({ processingId: 'job-current', stage: 'INDEXING', totalPages: 2, pagesExtracted: 2, pagesPersisted: 2, chunksIndexed: 0, lastUpdatedAt: updatedAt.toISOString() }));
  });

  it('reports configured semantic indexing as pending until current-generation vectors are persisted', async () => {
    const keys = ['KNOWLEDGE_SEMANTIC_ENABLED', 'KNOWLEDGE_EMBEDDING_PROVIDER', 'KNOWLEDGE_EMBEDDING_MODEL', 'KNOWLEDGE_EMBEDDING_BASE_URL', 'OPENROUTER_API_KEY'];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      Object.assign(process.env, { KNOWLEDGE_SEMANTIC_ENABLED: 'true', KNOWLEDGE_EMBEDDING_PROVIDER: 'openrouter', KNOWLEDGE_EMBEDDING_MODEL: 'openai/text-embedding-3-small', KNOWLEDGE_EMBEDDING_BASE_URL: 'https://openrouter.ai/api/v1', OPENROUTER_API_KEY: 'offline-placeholder' });
      const test = setup(source('TEXT', { sourceVersion: 3, activeIndexGeneration: 4, processingStatus: 'READY', semanticIndexStatus: 'NOT_CONFIGURED' }));
      test.service.embeddings = { provider: 'openrouter', model: 'openai/text-embedding-3-small', dimensions: 1536, embed: jest.fn() };
      test.db.knowledgeChunk.count.mockResolvedValueOnce(2);
      test.db.$queryRaw.mockResolvedValueOnce([]);
      const result = await test.service.status('user-a', 'alpha', 'source-a');
      expect(result).toMatchObject({ semanticIndexStatus: 'PENDING', semanticIndexErrorCode: null, semanticVectorCount: 0, sourceVersion: 3, activeIndexGeneration: 4, chunkCount: 2 });
    } finally {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  it('reports semantic READY only when every current chunk has the configured persisted vector profile', async () => {
    const keys = ['KNOWLEDGE_SEMANTIC_ENABLED', 'KNOWLEDGE_EMBEDDING_PROVIDER', 'KNOWLEDGE_EMBEDDING_MODEL', 'KNOWLEDGE_EMBEDDING_BASE_URL', 'OPENROUTER_API_KEY'];
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      Object.assign(process.env, { KNOWLEDGE_SEMANTIC_ENABLED: 'true', KNOWLEDGE_EMBEDDING_PROVIDER: 'openrouter', KNOWLEDGE_EMBEDDING_MODEL: 'openai/text-embedding-3-small', KNOWLEDGE_EMBEDDING_BASE_URL: 'https://openrouter.ai/api/v1', OPENROUTER_API_KEY: 'offline-placeholder' });
      const test = setup(source('TEXT', { sourceVersion: 3, activeIndexGeneration: 4, processingStatus: 'READY' }));
      test.service.embeddings = { provider: 'openrouter', model: 'openai/text-embedding-3-small', dimensions: 1536, embed: jest.fn() };
      test.db.knowledgeChunk.count.mockResolvedValueOnce(2);
      test.db.$queryRaw.mockResolvedValueOnce([{ embeddingProvider: 'openrouter', embeddingModel: 'openai/text-embedding-3-small', embeddingDimensions: 1536, vectorCount: 2 }]);
      const result = await test.service.status('user-a', 'alpha', 'source-a');
      expect(result).toMatchObject({ semanticIndexStatus: 'READY', semanticVectorCount: 2, semanticEmbeddingProvider: 'openrouter', semanticEmbeddingModel: 'openai/text-embedding-3-small', semanticEmbeddingDimensions: 1536, sourceVersion: 3, activeIndexGeneration: 4 });
    } finally {
      for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  it('does not query progress records for a source outside the authorized workspace', async () => {
    const test = setup(source('TEXT', { document: { extracted: true, pageCount: 1 } }));
    test.db.knowledgeSource.findFirst.mockResolvedValueOnce(null);
    await expect(test.service.status('user-a', 'alpha', 'source-org-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(test.db.knowledgeProcessingJob.findMany).not.toHaveBeenCalled();
    expect(test.db.knowledgeChunk.count).not.toHaveBeenCalled();
  });

  it('returns bounded tenant-scoped chunk previews and marks active versus stale generations', async () => {
    const test = setup(source('WEBSITE', { sourceVersion: 3, activeIndexGeneration: 7, processingStatus: 'READY' }));
    const active = { id: 'chunk-active', pageId: 'page-a', sourceVersion: 3, generation: 7, sequence: 0, content: 'Shipping details '.repeat(100), locator: 'https://example.test/policy', indexedAt: new Date(), page: { title: 'Shipping', canonicalUrl: 'https://example.test/policy', status: 'READY' } };
    const stale = { ...active, id: 'chunk-stale', sourceVersion: 2, generation: 6 };
    test.db.knowledgeChunk.findMany.mockResolvedValueOnce([active, stale]);
    test.db.knowledgeChunk.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    const result = await test.service.listSourceChunks('user-a', 'alpha', 'source-a', { page: 1, pageSize: 2, search: 'shipping' });
    expect(test.db.knowledgeChunk.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a', sourceId: 'source-a', content: { contains: 'shipping', mode: 'insensitive' } }, take: 2 }));
    expect(result).toMatchObject({ sourceVersion: 3, activeGeneration: 7, activeChunkCount: 1, chunks: [{ id: 'chunk-active', active: true, contentPreview: active.content.slice(0, 800) }, { id: 'chunk-stale', active: false }] });
    expect(result.chunks[0]).not.toHaveProperty('content');
  });

  it('does not reveal chunk state for a source outside the authorized workspace', async () => {
    const test = setup(source());
    test.db.knowledgeSource.findFirst.mockResolvedValueOnce(null);
    await expect(test.service.listSourceChunks('user-a', 'alpha', 'source-org-b', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(test.db.knowledgeChunk.findMany).not.toHaveBeenCalled();
  });

  it.each(['FAQ', 'TEXT'] as const)('indexes %s sources into an unpublished generation before setting READY', async (type) => {
    const test = setup(source(type));
    await test.service.process(job);
    expect(test.embed).toHaveBeenCalledWith([type === 'FAQ' ? 'Question: Return policy?\nAnswer: Return in सात days.' : 'Return policy?\n\nReturn in सात days.']);
    expect(test.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(test.tx.knowledgeSource.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ activeIndexGeneration: 1, processingStatus: 'READY' }) }));
    expect(test.tx.knowledgeProcessingJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: job.id, status: 'PROCESSING', leaseOwner: expect.any(String) }), data: expect.objectContaining({ status: 'SUCCEEDED', stage: 'INDEX_PUBLISHED', leaseOwner: null }) }));
  });

  it('sends persisted PDF page text through the existing chunk index and publishes READY only after the index transaction', async () => {
    const pageText = 'Dispatch within 2 business days.';
    const test = setup(source('TEXT', { name: 'shipping.pdf', contentBody: pageText, document: { extracted: true, pageCount: 1, pages: [{ page: 1, start: 0, end: pageText.length, heading: null, contentHash: 'a'.repeat(64), wordCount: 5 }] } }));
    test.service.embeddings = null;
    await test.service.process(job);
    const insert = test.tx.$executeRaw.mock.calls[0] as unknown[];
    expect(insert).toContain(pageText);
    expect(insert).toContain('shipping.pdf · page 1');
    expect(test.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(test.tx.knowledgeSource.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ processingStatus: 'READY', activeIndexGeneration: 1 }) }));
    expect(test.tx.knowledgeProcessingJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED', stage: 'INDEX_PUBLISHED' }) }));
  });

  it('indexes a FAQ lexically without embedding credentials or outbound model calls', async () => {
    const test = setup(source());
    test.service.embeddings = null;
    await test.service.process(job);
    expect(test.embed).not.toHaveBeenCalled();
    expect(test.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(test.tx.$executeRaw.mock.calls[0]).toContain('postgres');
    expect(test.tx.$executeRaw.mock.calls[0]).toContain('fts-simple');
    expect(test.tx.knowledgeSource.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ processingStatus: 'READY', semanticIndexStatus: 'NOT_CONFIGURED' }) }));
  });

  it('rejects incompatible semantic dimensions while still publishing the lexical generation', async () => {
    const test = setup(source(), jest.fn().mockResolvedValue([[1, 2, 3]]));
    await test.service.process(job);
    expect(test.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(test.tx.$executeRaw.mock.calls[0]).toContain('postgres');
    expect(test.tx.knowledgeSource.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ processingStatus: 'READY', semanticIndexStatus: 'FAILED', semanticIndexErrorCode: 'EMBEDDING_DIMENSION_MISMATCH' }) }));
    expect(test.tx.knowledgeProcessingJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: job.id, status: 'PROCESSING', leaseOwner: expect.any(String) }), data: expect.objectContaining({ status: 'SUCCEEDED', stage: 'INDEX_PUBLISHED', leaseOwner: null }) }));
  });

  it('publishes lexical readiness without semantic vectors after an embedding outage', async () => {
    const error = Object.assign(new Error('temporary'), { response: { code: 'EMBEDDING_PROVIDER_RETRYABLE' } });
    const test = setup(source('TEXT', { activeIndexGeneration: 4 }), jest.fn().mockRejectedValue(error));
    await test.service.process(job);
    expect(test.tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(rawQuerySql(test.tx.$executeRaw.mock.calls[0])).toContain('embeddingDimensions');
    expect(test.tx.$executeRaw.mock.calls[0]).toContain('postgres');
    expect(test.tx.knowledgeSource.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ activeIndexGeneration: 5, processingStatus: 'READY', semanticIndexStatus: 'FAILED' }) }));
    expect(test.tx.knowledgeProcessingJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: job.id, status: 'PROCESSING', leaseOwner: expect.any(String) }), data: expect.objectContaining({ status: 'SUCCEEDED', stage: 'INDEX_PUBLISHED', leaseOwner: null }) }));
  });

  it('keeps Knowledge text and exception-supplied values out of processing failure logs and stored diagnostics', async () => {
    const knowledgeMarker = 'private-knowledge-body-marker';
    const failureMarker = 'provider-error-secret-marker';
    const test = setup(source('TEXT', { name: 'Private source title', contentBody: knowledgeMarker }));
    test.tx.$executeRaw.mockRejectedValue(Object.assign(new Error(failureMarker), { code: failureMarker }));
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    try {
      await test.service.process(job);
      const output = JSON.stringify({ warnings: warning.mock.calls, updates: test.tx.knowledgeProcessingJob.updateMany.mock.calls });
      expect(output).not.toContain(knowledgeMarker);
      expect(output).not.toContain('Private source title');
      expect(output).not.toContain(failureMarker);
      expect(output).toContain('PROCESSING_FAILED');
      const diagnostic = JSON.parse(String(warning.mock.calls[0]?.[0]));
      expect(diagnostic).toMatchObject({ event: 'knowledge_processing_job_failed', operation: 'knowledge_chunk_insert', jobStage: 'UNKNOWN', retryability: 'TERMINAL_OR_EXHAUSTED' });
      expect(diagnostic.jobFingerprint).toMatch(/^[a-f0-9]{12}$/);
      expect(diagnostic.elapsedMs).toEqual(expect.any(Number));
    } finally {
      warning.mockRestore();
    }
  });

  it('records only safe P2028 subtype and timing metadata', async () => {
    const test = setup(source('TEXT'));
    const error = Object.assign(new Error('Transaction API error: Transaction already closed after timeout'), {
      code: 'P2028',
      meta: { timeout: 5000, timeTaken: 5012, error: 'Transaction already closed after timeout' },
    });
    test.tx.$executeRaw.mockRejectedValue(error);
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    try {
      await test.service.process(job);
      const diagnostic = JSON.parse(String(warning.mock.calls[0]?.[0]));
      expect(diagnostic).toMatchObject({
        event: 'knowledge_processing_job_failed',
        prismaCode: 'P2028',
        prismaCategory: 'TRANSACTION_API_ERROR',
        transactionMessageClass: 'TRANSACTION_TIMEOUT',
        transactionTimeoutMs: 5000,
        transactionTimeTakenMs: 5012,
      });
      expect(JSON.stringify(warning.mock.calls)).not.toContain('Transaction API error');
      expect(JSON.stringify(warning.mock.calls)).not.toContain('Transaction already closed after timeout');
    } finally {
      warning.mockRestore();
    }
  });

  it('does not publish a generation after the worker loses its lease', async () => {
    const test = setup(source());
    test.tx.knowledgeProcessingJob.findFirst.mockResolvedValue(null);
    test.tx.knowledgeProcessingJob.updateMany.mockResolvedValue({ count: 0 });
    await test.service.process(job);
    expect(test.tx.$executeRaw).not.toHaveBeenCalled();
    expect(test.tx.knowledgeSource.update).not.toHaveBeenCalled();
    expect(test.tx.knowledgeSource.updateMany).not.toHaveBeenCalled();
    expect(test.tx.knowledgeProcessingJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: job.id, status: 'PROCESSING' }),
    }));
  });

  it('claims a durable job with a lock-safe query and moves the source to PROCESSING', async () => {
    const test = setup(source());
    test.db.$queryRaw.mockResolvedValue([job]);
    const claimed = await test.service.claim();
    expect(claimed).toEqual(job);
    expect(rawQuerySql(test.db.$queryRaw.mock.calls[0])).toContain('FOR UPDATE OF o, j SKIP LOCKED');
    expect(rawQuerySql(test.db.$queryRaw.mock.calls[0])).toContain('pg_advisory_xact_lock');
    expect(rawQuerySql(test.db.$queryRaw.mock.calls[0])).toContain("j.kind='INDEX'");
    expect(rawQuerySql(test.db.$queryRaw.mock.calls[0])).toContain("s.type IN ('FAQ','TEXT')");
    expect(rawQuerySql(test.db.$queryRaw.mock.calls[0])).toContain("global_active.status='PROCESSING') < 2");
    expect(test.db.knowledgeSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ processingStatus: 'PROCESSING', semanticIndexStatus: 'PROCESSING' }) }));
  });

  it('rejects website processing requests while allowing FAQ/Text indexing jobs', async () => {
    const test = setup(source());
    test.db.knowledgeSource.findFirst.mockResolvedValueOnce(null);
    await expect(test.service.enqueueWebsite('user-a', 'alpha', 'website-a')).rejects.toBeInstanceOf(NotFoundException);
    expect(test.db.$transaction).not.toHaveBeenCalled();
  });

  it('auto-enqueues imported FAQ/text rows discovered by the worker poller', async () => {
    const test = setup(source('FAQ'));
    test.db.knowledgeSource.findMany.mockResolvedValue([source('FAQ')]);
    await test.service.tick();
    expect(test.db.knowledgeSource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: { id: true, organizationId: true, sourceVersion: true, type: true, activeIndexGeneration: true },
    }));
    expect(test.db.$transaction).toHaveBeenCalled();
    expect(test.tx.knowledgeProcessingJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', sourceId: 'source-a', sourceVersion: 2, kind: 'INDEX' }) }));
  });

  it('reports the safe missing KnowledgeSource column and exact worker operation for P2022', async () => {
    const test = setup(source('FAQ'));
    test.db.knowledgeSource.findMany.mockRejectedValue(Object.assign(new Error('private database detail'), { code: 'P2022', meta: { column: 'KnowledgeSource.document' } }));
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      await test.service.tick();
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('"operation":"pending_source_recovery_query"'));
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('"databaseColumn":"KnowledgeSource.document"'));
      expect(JSON.stringify(warning.mock.calls)).not.toContain('private database detail');
    } finally { warning.mockRestore(); }
  });

  it('moves a crashed job at its retry ceiling to FAILED instead of leaving it leased forever', async () => {
    const test = setup(source());
    test.db.knowledgeProcessingJob.findMany.mockResolvedValue([{ ...job, attempts: 5 }]);
    await test.service.requeueExpiredLeases();
    expect(test.tx.knowledgeProcessingJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', errorCode: 'WORKER_RETRIES_EXHAUSTED' }) }));
    expect(test.tx.knowledgeSource.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ processingStatus: 'FAILED' }) }));
  });

  it('bounds search to session workspace and resolver-provided source IDs', async () => {
    const test = setup(source());
    test.db.$queryRaw.mockResolvedValue([]);
    await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'refund?', 5);
    expect(test.workspace.requireAccess).toHaveBeenCalledWith('user-a', 'alpha', ['OWNER', 'ADMIN']);
    const call = test.db.$queryRaw.mock.calls[0]!;
    const sql = test.db.$queryRaw.mock.calls.map(rawQuerySql).join('\n');
    expect(sql).toContain('ANY(');
    expect(sql).toContain('websearch_to_tsquery');
    expect(sql).toContain('phraseto_tsquery');
    expect(sql).toContain('eligible_sources');
    expect(sql).not.toContain('"AssistantKnowledgeSource"');
    expect(sql).not.toContain('"AssistantKnowledgeBase"');
    expect(sql).toContain('"embeddingProvider"');
    expect(sql).toContain('"embeddingDimensions"');
    expect(call).toContain('org-a');
    expect(call).toContainEqual(['source-a']);
  });

  it('searches a small set of English paraphrases in one tenant-scoped lexical query', async () => {
    const test = setup(source());
    test.db.$queryRaw.mockResolvedValue([]);
    await test.service.searchPreview('user-a', 'alpha', 'assistant-a', ['return policy', 'refund conditions', 'returns'], 5);
    const lexicalCall = test.db.$queryRaw.mock.calls[0]!;
    expect(rawQuerySql(lexicalCall)).toContain('unnest(');
    expect(lexicalCall).toContainEqual(['return policy', 'refund conditions', 'returns']);
    expect(lexicalCall).toContain('org-a');
    expect(rawQuerySql(lexicalCall)).toContain('c."organizationId"=');
    expect(lexicalCall).toContainEqual(['source-a']);
    expect(test.db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(test.embed).toHaveBeenCalledWith(['return policy', 'refund conditions', 'returns']);
  });

  it('deduplicates hybrid candidates and labels reciprocal-rank fusion honestly', async () => {
    const test = setup(source());
    const lexicalHit = { chunkId: 'chunk-shared', content: 'Refunds take five days.', locator: null, sourceVersion: 2, contentHash: 'a'.repeat(64), indexedAt: new Date(), sourceId: 'source-a', sourceTitle: 'Refund policy', sourceType: 'FAQ', visibility: 'PUBLIC_REFERENCE', pageUrl: null, pageTitle: null, score: 0.8, method: 'lexical' };
    const semanticHit = { ...lexicalHit, score: 0.91, method: 'semantic' };
    test.db.$queryRaw.mockResolvedValueOnce([lexicalHit]).mockResolvedValueOnce([semanticHit]);
    const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', ['Refund policy', 'refund timeline'], 5);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.chunkId).toBe('chunk-shared');
    expect(result.results[0]?.methods).toEqual(['lexical', 'semantic']);
    expect(result.results[0]?.method).toBe('hybrid_rrf');
    expect(result.results[0]?.score).toBeCloseTo(2 / 61);
  });

  it('reports eligible source records separately from an empty active index', async () => {
    const test = setup(source('TEXT', { activeIndexGeneration: 4 }));
    test.bases.resolveEffectiveSources.mockResolvedValue({ sources: [{ id: 'source-a', type: 'TEXT', visibility: 'PUBLIC_REFERENCE' }] });
    test.db.knowledgeSource.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'source-a', type: 'TEXT', document: pdfDocument, status: 'REGISTERED', processingStatus: 'READY', sourceVersion: 2, activeIndexGeneration: 4, visibility: 'PUBLIC_REFERENCE', deletedAt: null }]);
    test.db.knowledgeChunk.count.mockResolvedValue(0);
    test.db.$queryRaw.mockResolvedValue([]);
    const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'shipping policy', 5, 'PUBLIC_VISITOR');
    expect(result.eligibleSourceCount).toBe(1);
    expect(result.results).toEqual([]);
    expect(result.diagnostics).toMatchObject({ indexReadySourceCount: 1, activeIndexChunkCount: 0, retrievalReason: 'EMPTY_INDEX' });
  });

  it('reports a lexical miss distinctly when semantic retrieval is not configured', async () => {
    const test = setup(source('TEXT', { activeIndexGeneration: 4 }));
    test.service.embeddings = null;
    test.bases.resolveEffectiveSources.mockResolvedValue({ sources: [{ id: 'source-a', type: 'TEXT', visibility: 'PUBLIC_REFERENCE' }] });
    test.db.knowledgeSource.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'source-a', type: 'TEXT', document: pdfDocument, status: 'REGISTERED', processingStatus: 'READY', sourceVersion: 2, activeIndexGeneration: 4, visibility: 'PUBLIC_REFERENCE', deletedAt: null }]);
    test.db.knowledgeChunk.count.mockResolvedValue(7);
    test.db.$queryRaw.mockResolvedValue([]);

    const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'shipping policy', 5, 'PUBLIC_VISITOR');

    expect(result.diagnostics).toMatchObject({ retrievalReason: 'NO_LEXICAL_MATCH', methodsAttempted: ['lexical'], lexicalCandidateCount: 0 });
    expect(result.semanticUnavailableCode).toBe('SEMANTIC_NOT_CONFIGURED');
  });

  it('does not search when the effective resolver returns no eligible sources', async () => {
    const test = setup(source());
    test.bases.resolveEffectiveSources.mockResolvedValue({ sources: [] });
    const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'private?', 5);
    expect(result.results).toEqual([]);
    expect(test.db.$queryRaw).not.toHaveBeenCalled();
    expect(test.embed).not.toHaveBeenCalled();
  });

  it('returns the same authorized public knowledge scope for the assistant availability read model', async () => {
    const test = setup(source());
    test.bases.resolveEffectiveSources.mockResolvedValue({
      organizationId: 'org-a', assistantId: 'assistant-a', resolution: 'SINGLE_ACTIVE_BASE_DEFAULT', defaultKnowledgeBaseId: 'base-a',
      knowledgeBases: [{ id: 'base-a', name: 'Company Information', status: 'active', assignment: 'WORKSPACE_DEFAULT', eligibleSourceCount: 1, retrievalEnabled: true }],
      sources: [
        { id: 'public-pdf', type: 'TEXT', visibility: 'PUBLIC_REFERENCE', sourceVersion: 2, activeIndexGeneration: 4, semanticIndexStatus: 'READY', sourceOrigin: 'WORKSPACE_AUTHORED', knowledgeBaseIds: ['base-a'] },
        { id: 'restricted-text', type: 'TEXT', visibility: 'INTERNAL_RESTRICTED', sourceVersion: 1, semanticIndexStatus: 'NOT_CONFIGURED', sourceOrigin: 'WORKSPACE_AUTHORED', knowledgeBaseIds: ['base-a'] },
      ],
    });
    test.db.knowledgeSource.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'public-pdf', type: 'TEXT', document: pdfDocument }]);
    test.db.knowledgeChunk.groupBy.mockResolvedValueOnce([{ sourceId: 'public-pdf', sourceVersion: 2, generation: 4, _count: { _all: 3 } }]);
    const result = await test.service.effectivePublicKnowledge('user-a', 'alpha', 'assistant-a');
    expect(test.bases.resolveEffectiveSources).toHaveBeenCalledWith('org-a', 'assistant-a', { publicOnly: true, includeDiagnostics: true });
    expect(result).toMatchObject({ defaultKnowledgeBaseId: 'base-a', searchableSourceCount: 1, retrievalEnabled: true, knowledgeBases: [{ id: 'base-a', eligibleSourceCount: 1, retrievalEnabled: true }] });
    expect(result.sources[0]).toMatchObject({ activeChunkCount: 3, activeIndexGeneration: 4 });
    expect(result.sources.map((item: any) => item.id)).toEqual(['public-pdf']);
    expect(result.sources[0]).toMatchObject({ semanticIndexStatus: 'READY', sourceOrigin: 'WORKSPACE_AUTHORED' });
  });

  it('constrains public retrieval to resolver-authorized tenant sources without coupling website hostname to widget domain', async () => {
    const test = setup(source('TEXT', { document: pdfDocument }));
    test.bases.resolveEffectiveSources.mockResolvedValue({ sources: [
      { id: 'public-source', type: 'TEXT', visibility: 'PUBLIC_REFERENCE' },
      { id: 'private-source', type: 'FAQ', visibility: 'INTERNAL_RESTRICTED' },
    ] });
    test.db.knowledgeSource.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'public-source', type: 'TEXT', document: pdfDocument, status: 'REGISTERED', processingStatus: 'READY', sourceVersion: 2, activeIndexGeneration: 4, visibility: 'PUBLIC_REFERENCE', deletedAt: null }]);
    test.db.$queryRaw.mockResolvedValue([]);
    const retrieval = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'delivery?', 5, 'PUBLIC_VISITOR');
    expect(retrieval.audience).toBe('PUBLIC_VISITOR');
    expect(test.bases.resolveEffectiveSources).toHaveBeenCalledWith('org-a', 'assistant-a', { publicOnly: true, includeDiagnostics: true });
    const sql = test.db.$queryRaw.mock.calls.map(rawQuerySql).join('\n');
    expect(sql).toContain('c."organizationId"=');
    expect(sql).toContain('s."organizationId"=');
    expect(sql).toContain("s.visibility='PUBLIC_REFERENCE'");
    expect(sql).toContain('s."deletedAt" IS NULL');
    expect(sql).toContain("s.status='REGISTERED'");
    expect(sql).toContain('s."processingStatus"=\'READY\'');
    expect(sql).not.toContain('"AssistantKnowledgeBase"');
    expect(sql).not.toContain('"KnowledgeBaseSource"');
    expect(sql).not.toContain('JOIN "Website"');
    expect(sql).toContain('NOT ');
    expect(test.db.$queryRaw.mock.calls[0]).toContain(true);
    expect(test.db.$queryRaw.mock.calls[0]).toContainEqual(['public-source']);
    expect(test.db.$queryRaw.mock.calls[0]).not.toContainEqual(['private-source']);
  });

  it.each([
    ['legacy FAQ', 'FAQ'],
    ['legacy manual text', 'TEXT'],
    ['legacy website', 'WEBSITE'],
  ] as const)('fails closed for %s in customer retrieval', async (_label, type) => {
    const test = setup(source(type as 'FAQ' | 'TEXT' | 'WEBSITE', { document: null }));
    test.bases.resolveEffectiveSources.mockResolvedValue({ sources: [{ id: 'legacy-source', type, visibility: 'PUBLIC_REFERENCE' }] });
    test.db.knowledgeSource.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'legacy-source', type, document: null, status: 'REGISTERED', processingStatus: 'READY', sourceVersion: 8, activeIndexGeneration: 9, visibility: 'PUBLIC_REFERENCE', deletedAt: null }]);

    const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'English legacy fact', 5, 'PUBLIC_VISITOR');

    expect(result.results).toEqual([]);
    expect(result.eligibleSourceCount).toBe(0);
    expect(result.diagnostics.rejectionReasons).toContainEqual({ reason: 'PDF_DOCUMENT_PROVENANCE_REQUIRED', count: 1 });
    expect(test.db.$queryRaw).not.toHaveBeenCalled();
    expect(test.embed).not.toHaveBeenCalled();
  });

  it('retrieves only a current, public PDF-derived TEXT chunk through lexical search', async () => {
    const currentPdf = source('TEXT', { visibility: 'PUBLIC_REFERENCE', sourceVersion: 3, activeIndexGeneration: 7, document: pdfDocument });
    const test = setup(currentPdf);
    test.service.embeddings = null;
    test.bases.resolveEffectiveSources.mockResolvedValue({ sources: [{ id: currentPdf.id, type: 'TEXT', visibility: 'PUBLIC_REFERENCE' }] });
    test.db.knowledgeSource.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: currentPdf.id, type: 'TEXT', document: pdfDocument, status: 'REGISTERED', processingStatus: 'READY', sourceVersion: 3, activeIndexGeneration: 7, visibility: 'PUBLIC_REFERENCE', deletedAt: null }]);
    test.db.knowledgeChunk.count.mockResolvedValue(3);
    const hit = { chunkId: 'pdf-chunk-current', pageId: null, generation: 7, content: 'Fixture English PDF fact.', locator: 'fixture.pdf · page 1', sourceVersion: 3, contentHash: 'd'.repeat(64), indexedAt: new Date(), sourceId: currentPdf.id, sourceTitle: currentPdf.name, sourceType: 'TEXT', visibility: 'PUBLIC_REFERENCE', pageUrl: null, pageTitle: null, sourceAuthority: 'MERCHANT_KNOWLEDGE', score: 0.7, method: 'lexical', dataCompleteness: 'COMPLETE' };
    test.db.$queryRaw.mockResolvedValue([hit]);

    const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'fixture English fact', 5, 'PUBLIC_VISITOR');

    expect(result).toMatchObject({ eligibleSourceCount: 1, mode: 'lexical_only', results: [{ chunkId: 'pdf-chunk-current', sourceId: currentPdf.id, sourceVersion: 3, generation: 7, content: hit.content, method: 'lexical' }] });
    expect(rawQuerySql(test.db.$queryRaw.mock.calls[0])).toContain("s.document->>'extracted'='true'");
    expect(test.db.$queryRaw.mock.calls[0]).toContainEqual(['source-a']);
  });

  it('excludes legacy public website chunks from customer static Knowledge retrieval', async () => {
    const test = setup(source('FAQ'));
    test.db.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a', website: { domain: 'widget.example', status: 'ACTIVE', verificationStatus: 'VERIFIED' } });
    test.bases.resolveEffectiveSources.mockResolvedValue({ sources: [{ id: 'public-site', type: 'WEBSITE', visibility: 'PUBLIC_REFERENCE' }] });
    test.db.knowledgeSource.findMany
      .mockResolvedValueOnce([{ id: 'public-site', type: 'WEBSITE', sourceUrl: 'https://carteio.in', category: null, description: null, verificationStatus: 'UNVERIFIED', verifiedAt: null, status: 'REGISTERED', processingStatus: 'READY', visibility: 'PUBLIC_REFERENCE', deletedAt: null }])
      .mockResolvedValueOnce([]);
    test.db.$queryRaw.mockResolvedValue([]);
    const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'shipping policy', 5, 'PUBLIC_VISITOR');
    expect(result.results).toEqual([]);
    expect(result.eligibleSourceCount).toBe(0);
    expect(test.db.$queryRaw).not.toHaveBeenCalled();
  });

  it('keeps Shopify-discovered storefront ownership verification for public website knowledge', async () => {
    const test = setup(source('FAQ'));
    test.bases.resolveEffectiveSources.mockResolvedValue({ sources: [{ id: 'shopify-storefront', type: 'WEBSITE', visibility: 'PUBLIC_REFERENCE' }] });
    test.db.knowledgeSource.findMany.mockResolvedValueOnce([{ id: 'shopify-storefront', type: 'WEBSITE', category: 'SHOPIFY_STOREFRONT', description: null, verificationStatus: 'UNVERIFIED', verifiedAt: null, status: 'REGISTERED', processingStatus: 'READY', visibility: 'PUBLIC_REFERENCE', deletedAt: null }]);
    const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'shipping policy', 5, 'PUBLIC_VISITOR');
    expect(result.eligibleSourceCount).toBe(0);
    expect(test.db.$queryRaw).not.toHaveBeenCalled();
  });

  it('batch revalidates chunk tenant, public visibility, lifecycle, generation, and assistant authorization', async () => {
    const test = setup(source('TEXT', { visibility: 'PUBLIC_REFERENCE', document: pdfDocument }));
    test.bases.resolveEffectiveSources.mockResolvedValue({ sources: [{ id: 'source-a', type: 'TEXT', visibility: 'PUBLIC_REFERENCE' }] });
    test.db.knowledgeSource.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'source-a', type: 'TEXT', document: pdfDocument }]);
    test.db.$queryRaw.mockResolvedValue([]);
    await test.service.revalidatePublicEvidence('user-a', 'alpha', 'assistant-a', ['chunk-a', 'chunk-b']);
    expect(test.workspace.requireAccess).toHaveBeenCalledWith('user-a', 'alpha', ['OWNER', 'ADMIN']);
    expect(test.db.chatbot.findFirst).toHaveBeenCalledWith({ where: { id: 'assistant-a', organizationId: 'org-a', status: 'ACTIVE' }, select: { id: true } });
    const sql = rawQuerySql(test.db.$queryRaw.mock.calls[0]);
    expect(sql).toContain('c."organizationId"=');
    expect(sql).toContain('c.id=ANY(');
    expect(sql).toContain('c."sourceVersion"=s."sourceVersion"');
    expect(sql).toContain('c.generation=s."activeIndexGeneration"');
    expect(sql).toContain("s.visibility='PUBLIC_REFERENCE'");
    expect(sql).toContain('s."deletedAt" IS NULL');
    expect(sql).not.toContain('"AssistantKnowledgeBase"');
    expect(sql).toContain('s.id=ANY(');
    expect(sql).toContain("s.document->>'extracted'='true'");
    expect(sql).not.toContain('"AssistantKnowledgeSource"');
  });

  it('does not revalidate previously selected legacy chunks after current source authorization', async () => {
    const test = setup(source('FAQ', { document: null }));
    test.bases.resolveEffectiveSources.mockResolvedValue({ sources: [{ id: 'legacy-faq', type: 'FAQ', visibility: 'PUBLIC_REFERENCE' }] });
    test.db.knowledgeSource.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'legacy-faq', type: 'FAQ', document: null }]);

    await expect(test.service.revalidatePublicEvidence('user-a', 'alpha', 'assistant-a', ['legacy-chunk'])).resolves.toEqual([]);
    expect(test.db.$queryRaw).not.toHaveBeenCalled();
  });

  it('shares only public eligible source language hints with query interpretation', async () => {
    const test = setup(source());
    test.bases.resolveEffectiveSources.mockResolvedValue({ sources: [
      { id: 'public-fr', type: 'FAQ', visibility: 'PUBLIC_REFERENCE', languageHint: 'fr' },
      { id: 'public-ar', type: 'TEXT', visibility: 'PUBLIC_REFERENCE', languageHint: 'ar' },
      { id: 'restricted-de', type: 'FAQ', visibility: 'INTERNAL_RESTRICTED', languageHint: 'de' },
      { id: 'other-type', type: 'WEBSITE', visibility: 'PUBLIC_REFERENCE', languageHint: 'es' },
    ] });
    test.db.knowledgeSource.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([
      { id: 'public-fr', type: 'FAQ', document: null }, { id: 'public-ar', type: 'TEXT', document: null },
    ]);
    await expect(test.service.publicSourceLanguageHints('user-a', 'alpha', 'assistant-a')).resolves.toEqual([]);
    expect(test.workspace.requireAccess).toHaveBeenCalledWith('user-a', 'alpha', ['OWNER', 'ADMIN']);
  });

  it('uses language hints from current authorized website pages when the source-level hint is empty', async () => {
    const test = setup(source('WEBSITE'));
    test.db.knowledgePage = { findMany: jest.fn() };
    test.bases.resolveEffectiveSources.mockResolvedValue({ sources: [{ id: 'website-a', type: 'WEBSITE', visibility: 'PUBLIC_REFERENCE' }] });
    test.db.knowledgeSource.findMany.mockResolvedValueOnce([{ id: 'website-a', type: 'WEBSITE', category: null, description: null, verificationStatus: 'UNVERIFIED', verifiedAt: null, status: 'REGISTERED', processingStatus: 'READY', visibility: 'PUBLIC_REFERENCE', deletedAt: null }]);

    await expect(test.service.publicSourceLanguageHints('user-a', 'alpha', 'assistant-a')).resolves.toEqual([]);
    expect(test.db.knowledgePage.findMany).not.toHaveBeenCalled();
  });

  it('performs lexical preview without an embedding provider or embedding query', async () => {
    const test = setup(source());
    test.service.embeddings = null;
    test.db.$queryRaw.mockResolvedValue([]);
    const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'रिफंड status', 5);
    expect(result.mode).toBe('lexical_only');
    expect(result.context).toBe('authenticated_workspace_preview');
    expect(test.db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(test.embed).not.toHaveBeenCalled();
  });

  it('uses English stemming and stop-word handling for natural-language lexical policy questions', async () => {
    const test = setup(source('FAQ'));
    test.service.embeddings = null;
    const policyChunk = { chunkId: 'shipping-chunk', content: 'Shipping policy: orders over ₹1,000 ship free.', locator: null, sourceVersion: 2, contentHash: 'f'.repeat(64), indexedAt: new Date(), sourceId: 'source-a', sourceTitle: 'Shipping Policy', sourceType: 'FAQ', visibility: 'PUBLIC_REFERENCE', pageUrl: null, pageTitle: 'Shipping Policy', pageCategory: 'POLICY', languageHint: 'en', pageFetchedAt: new Date(), sourceDataAt: null, sourceAuthority: 'MERCHANT_KNOWLEDGE', score: 0.2, method: 'lexical', dataCompleteness: 'COMPLETE' };
    test.db.$queryRaw.mockResolvedValue([policyChunk]);

    const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'What is your shipping policy?');

    const sql = rawQuerySql(test.db.$queryRaw.mock.calls[0]);
    expect(sql).toContain("websearch_to_tsquery('english'");
    expect(sql).toContain("to_tsvector('english', c.content)");
    expect(sql).toContain("to_tsvector('english', s.name)");
    expect(sql).toContain("websearch_to_tsquery('simple'");
    expect(result).toMatchObject({ mode: 'lexical_only', results: [{ chunkId: 'shipping-chunk', content: policyChunk.content, sourceTitle: 'Shipping Policy' }] });
    expect(test.embed).not.toHaveBeenCalled();
  });

  it('limits the server-side public retrieval scope to active verified origin and public sources', async () => {
    const test = setup(source());
    test.db.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a', organizationId: 'org-a', website: { domain: 'example.com', status: 'ACTIVE', verificationStatus: 'VERIFIED' } });
    test.bases.resolveEffectiveSources.mockResolvedValue({ sources: [
      { id: 'public', type: 'TEXT', visibility: 'PUBLIC_REFERENCE' },
      { id: 'internal', visibility: 'INTERNAL_RESTRICTED' },
    ] });
    test.db.knowledgeSource.findMany.mockResolvedValueOnce([{ id: 'public', type: 'TEXT', document: pdfDocument }]);
    const result = await test.service.resolvePublicVisitorSources('org-a', 'assistant-a', 'https://www.example.com/');
    expect(result.sources.map((item: any) => item.id)).toEqual(['public']);
    await expect(test.service.resolvePublicVisitorSources('org-a', 'assistant-a', 'https://attacker.example/')).rejects.toThrow();
  });

  it('rejects a MEMBER from the search preview before querying embeddings or chunks', async () => {
    const test = setup(source());
    test.workspace.requireAccess.mockRejectedValue(new Error('forbidden'));
    await expect(test.service.searchPreview('user-member', 'alpha', 'assistant-a', 'policy?', 5)).rejects.toThrow('forbidden');
    expect(test.db.$queryRaw).not.toHaveBeenCalled();
    expect(test.embed).not.toHaveBeenCalled();
  });

  describe('Phase 04 retrieval boundaries (offline fixtures)', () => {
    const hit = (chunkId: string, score = 0.8, overrides = {}) => ({
      chunkId, pageId: null, generation: 4, content: 'Synthetic shipping policy fixture: options depend on the delivery region.',
      locator: null, sourceVersion: 2, contentHash: chunkId.padEnd(64, 'a'), indexedAt: new Date('2026-10-26T00:00:00Z'),
      sourceId: 'source-a', sourceTitle: 'Shipping Policy', sourceType: 'FAQ', visibility: 'PUBLIC_REFERENCE',
      pageUrl: null, pageTitle: null, score, method: 'lexical', dataCompleteness: 'COMPLETE', ...overrides,
    });
    const withActiveIndex = () => {
      const test = setup(source('TEXT', { activeIndexGeneration: 4 }));
      test.db.knowledgeSource.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
        { id: 'source-a', status: 'REGISTERED', processingStatus: 'READY', sourceVersion: 2, activeIndexGeneration: 4, visibility: 'PUBLIC_REFERENCE', deletedAt: null },
      ]);
      test.db.knowledgeChunk.count.mockResolvedValue(3);
      return test;
    };

    it('normalizes Unicode and whitespace and deduplicates query variants before embedding', async () => {
      const test = setup(source());
      await test.service.searchPreview('user-a', 'alpha', 'assistant-a', [' Ｓｈｉｐｐｉｎｇ\u0000 policy ', 'shipping  policy', 'डिलीवरी नीति']);
      expect(test.embed).toHaveBeenCalledWith(['Shipping policy', 'डिलीवरी नीति']);
      expect(test.db.$queryRaw.mock.calls[0]).toContainEqual(['Shipping policy', 'डिलीवरी नीति']);
    });

    it.each([
      ['English', 'What are the shipping options?'],
      ['Hindi', 'डिलीवरी के क्या विकल्प हैं?'],
      ['Hinglish', 'Carteio ki shipping kitne din mein hoti hai?'],
      ['mixed', 'Shipping की जानकारी बताइए'],
    ])('passes %s questions and validated English variants through semantic retrieval with source attribution', async (_language, question) => {
      // The adapter and vector search are fixtures; this checks service wiring, not a real model's language quality.
      const test = setup(source('WEBSITE', { activeIndexGeneration: 4 }));
      const page = hit('page-chunk', 0.83, { method: 'semantic', sourceType: 'WEBSITE', pageId: 'page-a', pageUrl: 'https://carteio.in/pages/shipping-policy' });
      test.db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([page]);
      const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', [question, 'shipping policy delivery options'], 3);
      expect(test.embed).toHaveBeenCalledWith([question, 'shipping policy delivery options']);
      expect(result.results).toEqual([expect.objectContaining({ chunkId: 'page-chunk', sourceId: 'source-a', pageId: 'page-a', pageUrl: page.pageUrl, content: page.content, method: 'semantic' })]);
    });

    it('fuses candidates below each first result before enforcing the final limit', async () => {
      const test = setup(source());
      test.db.$queryRaw.mockResolvedValueOnce([hit('lexical-first'), hit('shared')])
        .mockResolvedValueOnce([hit('semantic-first', 0.91), hit('shared', 0.88)]);
      const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'shipping policy', 1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({ chunkId: 'shared', methods: ['lexical', 'semantic'], method: 'hybrid_rrf' });
      expect(result.results[0].score).toBeCloseTo(2 / 62);
      expect(result.diagnostics).toMatchObject({ rankedCandidateCount: 3, selectedEvidenceCount: 1 });
      expect(test.db.$queryRaw.mock.calls[0]).toContain(40);
      expect(test.db.$queryRaw.mock.calls[1]).toContain(40);
    });

    it('preserves bounded lexical evidence and redacts vector query errors', async () => {
      const test = setup(source());
      test.db.$queryRaw.mockResolvedValueOnce([hit('first'), hit('second')])
        .mockRejectedValueOnce(new Error('private SQL parameters must not escape'));
      const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'shipping policy', 1);
      expect(result).toMatchObject({ mode: 'lexical_only', semanticUnavailableCode: 'SEMANTIC_QUERY_FAILED', results: [{ chunkId: 'first' }] });
      expect(result.diagnostics).toMatchObject({ methodsAttempted: ['lexical', 'semantic'], selectedEvidenceCount: 1, rankedCandidateCount: 2 });
      expect(JSON.stringify(result)).not.toContain('private SQL');
    });

    it('reports incompatible query dimensions and retains lexical results', async () => {
      const test = setup(source(), jest.fn().mockResolvedValue([[0.1, 0.2]]));
      test.db.$queryRaw.mockResolvedValue([hit('lexical')]);
      const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'shipping policy', 1);
      expect(result).toMatchObject({ mode: 'lexical_only', semanticUnavailableCode: 'EMBEDDING_DIMENSION_MISMATCH', results: [{ chunkId: 'lexical' }] });
      expect(test.db.$queryRaw).toHaveBeenCalledTimes(1);
    });

    it('rejects weak or non-finite semantic candidates instead of promoting unrelated evidence', async () => {
      const test = setup(source());
      test.db.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([hit('weak', 0.01), hit('negative', -0.4), hit('invalid', Number.NaN)]);
      const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'shipping policy', 5);
      expect(result.results).toEqual([]);
      expect(rawQuerySql(test.db.$queryRaw.mock.calls[1])).toContain('HAVING max(1 - (c.embedding <=> q.vector)) >=');
    });

    it.each<[string, { embeddingProvider: string; embeddingModel: string; embeddingDimensions: number }]>([
      ['SEMANTIC_INDEX_NOT_READY', { embeddingProvider: 'postgres', embeddingModel: 'fts-simple', embeddingDimensions: 0 }],
      ['EMBEDDING_INDEX_PROFILE_MISMATCH', { embeddingProvider: 'other', embeddingModel: 'other', embeddingDimensions: 1536 }],
      ['EMBEDDING_INDEX_DIMENSION_MISMATCH', { embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small', embeddingDimensions: 768 }],
    ])('distinguishes %s from an ordinary relevance miss using current authorized generations', async (code, profile) => {
      const test = withActiveIndex();
      test.db.knowledgeChunk.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([profile]);
      const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'shipping policy');
      expect(result).toMatchObject({ results: [], semanticUnavailableCode: code, diagnostics: { retrievalReason: 'SEMANTIC_RETRIEVAL_UNAVAILABLE' } });
      expect(test.db.knowledgeChunk.groupBy.mock.calls[1][0].where).toEqual({ organizationId: 'org-a', OR: [{ sourceId: 'source-a', sourceVersion: 2, generation: 4 }] });
    });

    it('reports a real semantic miss when compatible vectors exist', async () => {
      const test = withActiveIndex();
      test.db.knowledgeChunk.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([{ embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small', embeddingDimensions: 1536 }]);
      const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'an unrelated question');
      expect(result.results).toEqual([]);
      expect(result.semanticUnavailableCode).toBeUndefined();
      expect(result.diagnostics.retrievalReason).toBe('NO_SEMANTIC_MATCH');
    });

    it('retains a policy URL FAQ as link text without inventing page content or a page identity', async () => {
      const test = setup(source());
      test.service.embeddings = null;
      const link = hit('faq-link', 0.8, { content: 'Shipping Policy: https://carteio.in/pages/shipping-policy' });
      test.db.$queryRaw.mockResolvedValueOnce([link]);
      const result = await test.service.searchPreview('user-a', 'alpha', 'assistant-a', 'shipping policy');
      expect(result.results[0]).toMatchObject({ content: link.content, pageId: null, pageUrl: null, sourceType: 'FAQ' });
      expect(result.results[0].content).not.toContain('days');
    });

    it('denies an assistant outside the active workspace before retrieval', async () => {
      const test = setup(source());
      test.db.chatbot.findFirst.mockResolvedValue(null);
      await expect(test.service.searchPreview('user-a', 'alpha', 'foreign-assistant', 'shipping')).rejects.toBeInstanceOf(NotFoundException);
      expect(test.embed).not.toHaveBeenCalled();
      expect(test.db.$queryRaw).not.toHaveBeenCalled();
    });
  });

});
