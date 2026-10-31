import { PrivateKnowledgeStorage } from './private-knowledge-storage';
import { extractPdf, pdfChunks, type PdfExtraction } from './pdf-extraction';
import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkspaceService } from './workspace.service';
import { KnowledgeBaseService } from './knowledge-base.service';
import { createEmbeddingProvider, semanticConfigurationError, semanticIndexEnabled, semanticMinimumSimilarity, chunkKnowledgeText, contentHash, deduplicateKnowledgeChunks, stableKnowledgeChunkId, type EmbeddingProvider } from './knowledge-indexing';
import { originMatchesVerifiedDomain, sourcesForAudience } from './knowledge-retrieval-policy';
import { isVerifiedPdfDocumentSource } from './knowledge-document-eligibility';
import { WebsiteCrawler, type CrawlPage, type WebsitePageCategory } from './website-crawler';
import { authoritativeRemovedUrls, canReuseIndexedChunks, prepareWebsiteSyncPages } from './website-sync';
import { SHOPIFY_CONTENT_SCOPE_REQUIREMENTS, isShopifyScopeSnapshotFresh, shopifyContentCategoryAllowed } from './connectors/shopify-granted-scope-discovery.service';

export type KnowledgePreviewResult = {
  chunkId: string;
  pageId: string | null;
  generation: number;
  rankingPosition?: number;
  content: string;
  locator: string | null;
  sourceVersion: number;
  contentHash: string;
  indexedAt: Date;
  sourceId: string;
  sourceTitle: string;
  sourceType: string;
  visibility: string;
  pageUrl: string | null;
  pageTitle: string | null;
  pageCategory?: string | null;
  languageHint?: string | null;
  sourceAuthority?: 'SHOPIFY_API_POLICY' | 'SHOPIFY_API_POLICY_STALE' | 'PUBLIC_WEBSITE' | 'MERCHANT_KNOWLEDGE';
  sourceDataAt?: Date | string | null;
  pageFetchedAt?: Date | string | null;
  dataCompleteness: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';
  score: number;
  method: string;
  methods?: string[];
};

export type KnowledgePreviewResponse = {
  results: KnowledgePreviewResult[];
  mode: 'hybrid' | 'lexical_only';
  context: string;
  audience: 'INTERNAL_MANAGER_PREVIEW' | 'PUBLIC_VISITOR';
  eligibleSourceCount: number;
  semanticUnavailableCode?: string;
  diagnostics: {
    assignedSourceCount: number;
    rejectedSourceCount: number;
    indexReadySourceCount: number;
    activeIndexChunkCount: number;
    indexReadinessDurationMs: number;
    queryVariantCount: number;
    lexicalCandidateCount: number;
    semanticCandidateCount: number;
    rankedCandidateCount: number;
    selectedEvidenceCount: number;
    lexicalDurationMs: number;
    semanticDurationMs: number;
    rankingDurationMs: number;
    methodsAttempted: string[];
    rejectionReasons: Array<{ reason: string; count: number }>;
    sourceIndexStates: Array<{ sourceId: string; sourceVersion: number; activeGeneration: number | null; processingStatus: string; ready: boolean; activeChunkCount: number }>;
    retrievalReason?: string;
  };
};

const managers = ['OWNER', 'ADMIN'] as const;
type WebsiteVerificationGate = { category: string | null; description: string | null; verificationStatus: string; verifiedAt: Date | null };
const requiresVerifiedWebsiteDomain = (source: WebsiteVerificationGate) => source.category === 'SHOPIFY_STOREFRONT'
  || Boolean(source.description?.startsWith('Public storefront discovered from the connected Shopify shop.'));
const websiteDomainIsVerified = (source: WebsiteVerificationGate) => source.verificationStatus === 'VERIFIED' && source.verifiedAt !== null;
type WebsitePageSnapshot = {
  id: string;
  canonicalUrl: string;
  title: string;
  content: string;
  contentHash: string;
  extractionMethod: 'HTML' | 'BROWSER_RENDERED' | null;
  pageCategory: WebsitePageCategory | null;
  languageHint: string | null;
  fetchedAt: Date;
  etag: string | null;
  lastModified: string | null;
};
type IndexedWebsitePage = { page: CrawlPage; parts: string[] };
type StoredWebsiteChunk = { pageId: string; content: string; contentHash: string; locator: string | null; embeddingProvider: string; embeddingModel: string; embeddingDimensions: number; embedding: string | null };
const SAFE_PROCESSING_ERROR_CODES = new Set([
  'PDF_PAGE_LIMIT', 'PDF_TEXT_LIMIT', 'PDF_OCR_REQUIRED', 'PDF_PARTIAL_OCR_REQUIRED', 'PDF_ENCRYPTED',
  'PDF_INVALID', 'PDF_EXTRACTION_TIMEOUT', 'PDF_EXTRACTION_FAILED', 'PDF_IDENTITY_MISMATCH', 'PDF_CLEANUP_FAILED', 'PRIVATE_STORAGE_UNAVAILABLE',
  'EMBEDDING_PROVIDER_RETRYABLE', 'EMBEDDING_PROVIDER_UNAVAILABLE', 'EMBEDDING_PROVIDER_AUTH_FAILED',
  'EMBEDDING_PROVIDER_NOT_CONFIGURED', 'EMBEDDING_PROVIDER_PAYMENT_REQUIRED', 'EMBEDDING_PROVIDER_FORBIDDEN', 'EMBEDDING_PROVIDER_MODEL_OR_ENDPOINT_NOT_FOUND', 'EMBEDDING_PROVIDER_REQUEST_FAILED', 'EMBEDDING_PROVIDER_BASE_URL_INVALID', 'EMBEDDING_PROVIDER_INVALID_RESPONSE', 'EMBEDDING_DIMENSION_MISMATCH', 'EMBEDDING_INDEX_PROFILE_MISMATCH', 'EMBEDDING_INDEX_VECTOR_COUNT_MISMATCH', 'SOURCE_TYPE_NOT_SUPPORTED',
  'EMPTY_SOURCE', 'STALE_SOURCE_VERSION', 'WORKER_LEASE_LOST', 'WEBSITE_NO_INDEXABLE_CONTENT',
  'WEBSITE_SOURCE_NOT_VERIFIED', 'CRAWL_DESTINATION_BLOCKED', 'CRAWL_URL_BLOCKED', 'CRAWL_REDIRECT_OUT_OF_SCOPE',
  'SHOPIFY_STOREFRONT_DOMAIN_NOT_VERIFIED',
  'CRAWL_REDIRECT_LIMIT', 'CRAWL_PAGE_SIZE_LIMIT', 'CRAWL_TOTAL_SIZE_LIMIT', 'CRAWL_TIME_BUDGET',
  'CRAWL_REQUEST_TIMEOUT', 'DNS_RESOLUTION_FAILED', 'ROBOTS_FETCH_FAILED', 'ROBOTS_TEMPORARILY_UNAVAILABLE',
  'ROBOTS_DISALLOWS_CRAWLING', 'BROWSER_RUNTIME_UNAVAILABLE', 'BROWSER_ISOLATION_REQUIRED',
  'BROWSER_RENDERING_NOT_CONFIGURED', 'WEBSITE_CRAWL_FAILED',
  'WEBSITE_CRAWL_NOT_AUTHORIZED', 'WEBSITE_SOURCE_NOT_SYNCABLE', 'CRAWL_PARTIAL_FAILURE',
]);
const errorRecord = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
function safeProcessingErrorCode(error: unknown): string {
  const record = errorRecord(error);
  const response = errorRecord(record?.response);
  const codes = [response?.code, record?.code];
  for (const code of codes) if (typeof code === 'string' && SAFE_PROCESSING_ERROR_CODES.has(code)) return code;
  for (const code of codes) if (typeof code === 'string' && /^P\d{4}$/.test(code)) return 'DATABASE_ERROR';
  return 'PROCESSING_FAILED';
}
function safeDiagnosticErrorName(error: unknown): string {
  const name = error instanceof Error ? error.name
    : typeof error === 'object' && error !== null ? Object.getPrototypeOf(error)?.constructor?.name : '';
  return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) ? name : 'unknown';
}
function safeWorkerDatabaseDiagnostic(error: unknown) {
  const record = errorRecord(error);
  const meta = errorRecord(record?.meta);
  const adapterError = errorRecord(meta?.driverAdapterError);
  const response = errorRecord(record?.response);
  const rawPrismaCode = [record?.code, response?.code].find((code) => typeof code === 'string' && /^P\d{4}$/.test(code));
  const prismaCode = typeof rawPrismaCode === 'string' ? rawPrismaCode : undefined;
  const prismaCategory = prismaCode === 'P1001' || prismaCode === 'P1002' || prismaCode === 'P2024' ? 'CONNECTION_OR_POOL'
    : prismaCode === 'P2002' || prismaCode === 'P2003' ? 'CONSTRAINT'
      : prismaCode === 'P2010' ? 'RAW_QUERY'
        : prismaCode === 'P2021' ? 'MISSING_TABLE'
          : prismaCode === 'P2022' ? 'MISSING_COLUMN'
            : prismaCode === 'P2034' ? 'TRANSACTION_CONFLICT'
              : prismaCode === 'P2028' ? 'TRANSACTION_API_ERROR'
              : prismaCode ? 'OTHER_PRISMA_ERROR' : undefined;
  const transactionText = `${typeof record?.message === 'string' ? record.message : ''} ${typeof meta?.error === 'string' ? meta.error : ''}`;
  const transactionMessageClass = prismaCode === 'P2028'
    ? /timeout|expired/i.test(transactionText) ? 'TRANSACTION_TIMEOUT'
      : /closed/i.test(transactionText) ? 'TRANSACTION_CLOSED' : 'TRANSACTION_API_ERROR'
    : undefined;
  const safeTransactionNumber = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 300_000 ? value : undefined;
  const transactionTimeoutMs = prismaCode === 'P2028' ? safeTransactionNumber(meta?.timeout) : undefined;
  const transactionTimeTakenMs = prismaCode === 'P2028' ? safeTransactionNumber(meta?.timeTaken) : undefined;
  const rawDatabaseCode = meta?.code ?? meta?.sqlstate ?? meta?.sqlState ?? adapterError?.code ?? adapterError?.sqlstate ?? adapterError?.sqlState;
  const databaseCode = typeof rawDatabaseCode === 'string' && /^[0-9A-Z]{5}$/.test(rawDatabaseCode) ? rawDatabaseCode : undefined;
  const databaseCategory = databaseCode?.startsWith('08') ? 'DATABASE_CONNECTION'
    : databaseCode?.startsWith('22') ? 'DATABASE_DATA'
      : databaseCode?.startsWith('23') ? 'DATABASE_CONSTRAINT'
        : databaseCode?.startsWith('40') ? 'DATABASE_TRANSACTION'
          : databaseCode?.startsWith('42') ? (databaseCode === '42601' ? 'DATABASE_SQL_SYNTAX' : 'DATABASE_SCHEMA_OR_PERMISSION')
            : databaseCode ? 'DATABASE_ERROR' : undefined;
  const rawMessage = typeof meta?.message === 'string' ? meta.message : typeof meta?.database_error === 'string' ? meta.database_error
    : typeof adapterError?.message === 'string' ? adapterError.message : typeof adapterError?.database_error === 'string' ? adapterError.database_error : '';
  // Emit only recognized diagnostic categories; raw database text can echo SQL or parameter values.
  const databaseMessage = /^syntax error\b/i.test(rawMessage) ? 'syntax error'
    : /^relation .* does not exist\b/i.test(rawMessage) ? 'relation missing'
      : /^column .* does not exist\b/i.test(rawMessage) ? 'column missing'
        : /^function .* does not exist\b/i.test(rawMessage) ? 'function missing'
          : /^operator does not exist\b/i.test(rawMessage) ? 'operator missing'
            : /^invalid input syntax\b/i.test(rawMessage) ? 'invalid input syntax'
              : /^permission denied\b/i.test(rawMessage) ? 'permission denied'
                : /^canceling statement due to statement timeout\b/i.test(rawMessage) ? 'statement timeout'
                  : /^deadlock detected\b/i.test(rawMessage) ? 'deadlock detected' : undefined;
  const rawColumn = meta?.column ?? adapterError?.column;
  const databaseColumn = typeof rawColumn === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}(?:\.[A-Za-z_][A-Za-z0-9_]{0,63})?$/.test(rawColumn) ? rawColumn : undefined;
  return { errorType: safeDiagnosticErrorName(error), ...(prismaCode ? { prismaCode } : {}), ...(prismaCategory ? { prismaCategory } : {}), ...(databaseColumn ? { databaseColumn } : {}), ...(transactionMessageClass ? { transactionMessageClass } : {}), ...(transactionTimeoutMs !== undefined ? { transactionTimeoutMs } : {}), ...(transactionTimeTakenMs !== undefined ? { transactionTimeTakenMs } : {}), ...(databaseCode ? { databaseCode } : {}), ...(databaseCategory ? { databaseCategory } : {}), ...(databaseMessage ? { databaseMessage } : {}) };
}
function safeJobFingerprint(jobId: unknown): string {
  return typeof jobId === 'string' ? createHash('sha256').update(jobId, 'utf8').digest('hex').slice(0, 12) : 'unknown';
}

/** Durable PostgreSQL job consumer. Leases expire after crashes; work is idempotent by source version/generation. */
@Injectable()
export class KnowledgeProcessingService implements OnModuleInit, OnModuleDestroy {
  private readonly db: any;
  private readonly logger = new Logger(KnowledgeProcessingService.name);
  private timer?: NodeJS.Timeout;
  private inFlight: Promise<void> | null = null;
  private readonly workerId = `${process.env.HOSTNAME ?? 'carteio'}:${randomUUID()}`;
  private readonly embeddings: EmbeddingProvider | null;
  private readonly crawler: WebsiteCrawler;
  constructor(prisma: PrismaService, private readonly workspaces: WorkspaceService, private readonly bases: KnowledgeBaseService, @Optional() embeddings?: EmbeddingProvider, @Optional() private readonly documentStorage?: PrivateKnowledgeStorage) {
    this.db = prisma as any;
    this.embeddings = embeddings ?? createEmbeddingProvider();
    this.crawler = new WebsiteCrawler(this.db);
  }

  onModuleInit() {
    const semanticEnabled = semanticIndexEnabled();
    this.logger.log(JSON.stringify({
      event: 'knowledge_embedding_configuration_loaded',
      workerMode: process.env.VERCEL === '1' ? 'SERVERLESS_EXTERNAL_WORKER_REQUIRED' : process.env.KNOWLEDGE_WORKER_STANDALONE === 'true' ? 'STANDALONE' : process.env.KNOWLEDGE_WORKER_ENABLED === 'true' ? 'IN_PROCESS' : 'DISABLED',
      workerEnabled: process.env.KNOWLEDGE_WORKER_ENABLED === 'true',
      semanticIndexEnabled: semanticEnabled,
      provider: this.embeddings?.provider ?? null,
      model: this.embeddings?.model ?? null,
      dimensions: this.embeddings?.dimensions ?? null,
      configurationError: semanticEnabled ? semanticConfigurationError() ?? (this.embeddings ? null : 'EMBEDDING_PROVIDER_NOT_CONFIGURED') : 'SEMANTIC_INDEX_DISABLED',
    }));
    if (process.env.KNOWLEDGE_WORKER_DIAGNOSTIC_ONLY === 'true') {
      this.logger.log(JSON.stringify({ event: 'knowledge_worker_diagnostic_mode_polling_skipped' }));
      return;
    }
    if (process.env.VERCEL === '1') {
      if (process.env.KNOWLEDGE_WORKER_ENABLED === 'true') {
        this.logger.warn(JSON.stringify({ event: 'knowledge_worker_start_blocked', reason: 'SERVERLESS_RUNTIME' }));
      }
      return;
    }
    if (process.env.KNOWLEDGE_WORKER_ENABLED !== 'true' || this.timer) return;
    this.timer = setInterval(() => {
      if (!this.inFlight) this.inFlight = this.tick().finally(() => { this.inFlight = null; });
    }, 1500);
    // A standalone worker has no HTTP server to keep Node alive. Keep its
    // polling timer referenced; API processes retain the unref'ed behavior.
    if (process.env.KNOWLEDGE_WORKER_STANDALONE !== 'true') this.timer.unref();
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }
  async onModuleDestroy() { await this.stop(); }

  async enqueue(userId: string, slug: string, sourceId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const source = await this.db.knowledgeSource.findFirst({ where: { id: sourceId, organizationId: member.organizationId, status: 'REGISTERED' } });
    if (!source) throw this.sourceNotFound();
    if (source.type === 'WEBSITE') return this.enqueueWebsite(userId, slug, sourceId);
    if (!['FAQ', 'TEXT', 'WEBSITE'].includes(source.type)) throw new ServiceUnavailableException({ code: 'SOURCE_TYPE_NOT_SUPPORTED', message: 'This source type does not yet have a configured processor.' });
    await this.enqueueRecord(source);
    await this.db.auditEvent.create({ data: { organizationId: member.organizationId, actorUserId: userId, action: 'knowledge.processing_enqueued', entityType: 'knowledge_source', entityId: source.id, metadata: { sourceVersion: source.sourceVersion } } });
    return { sourceId, status: 'queued', sourceVersion: source.sourceVersion };
  }

  async status(userId: string, slug: string, sourceId: string) {
    const member = await this.workspaces.requireAccess(userId, slug);
    const source = await this.db.knowledgeSource.findFirst({ where: { id: sourceId, organizationId: member.organizationId }, select: { id: true, type: true, status: true, processingStatus: true, processingErrorCode: true, semanticIndexStatus: true, semanticIndexErrorCode: true, sourceVersion: true, activeIndexGeneration: true, document: true, updatedAt: true } });
    if (!source) throw this.sourceNotFound();
    const [jobs, chunks, latestIndexed, vectorProfiles] = await Promise.all([
      this.db.knowledgeProcessingJob.findMany({ where: { organizationId: member.organizationId, sourceId, sourceVersion: source.sourceVersion }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, kind: true, status: true, stage: true, attempts: true, errorCode: true, createdAt: true, updatedAt: true } }),
      this.db.knowledgeChunk.count({ where: { organizationId: member.organizationId, sourceId, sourceVersion: source.sourceVersion, generation: source.activeIndexGeneration ?? -1 } }),
      this.db.knowledgeChunk.aggregate({ where: { organizationId: member.organizationId, sourceId, sourceVersion: source.sourceVersion, generation: source.activeIndexGeneration ?? -1 }, _max: { indexedAt: true } }),
      source.activeIndexGeneration == null ? Promise.resolve([]) : this.db.$queryRaw`SELECT "embeddingProvider", "embeddingModel", "embeddingDimensions", COUNT(*)::int AS "vectorCount" FROM "KnowledgeChunk" WHERE "organizationId"=${member.organizationId}::uuid AND "sourceId"=${sourceId}::uuid AND "sourceVersion"=${source.sourceVersion} AND generation=${source.activeIndexGeneration} AND embedding IS NOT NULL GROUP BY "embeddingProvider", "embeddingModel", "embeddingDimensions"`,
    ]);
    const latestJob = jobs[0];
    const pageCount = Number(source.document?.pageCount ?? source.document?.pages?.length ?? 0);
    const stage = latestJob?.status === 'QUEUED' || latestJob?.status === 'RETRY_WAIT' ? 'QUEUED'
      : latestJob?.status === 'PROCESSING' ? latestJob.stage ?? 'INDEXING'
        : source.processingStatus === 'READY' ? 'READY'
          : source.processingStatus === 'FAILED' ? 'FAILED' : 'SAVING';
    const documentProgress = source.document ? {
      processingId: latestJob?.id ?? source.id,
      stage,
      totalPages: pageCount || undefined,
      pagesExtracted: source.document.extracted ? pageCount : 0,
      pagesPersisted: source.document.extracted ? pageCount : 0,
      chunksIndexed: chunks,
      ...(source.processingErrorCode || latestJob?.errorCode ? { failureReason: source.processingErrorCode ?? latestJob?.errorCode } : {}),
      lastUpdatedAt: (latestJob?.updatedAt ?? source.updatedAt).toISOString(),
      ...(['READY', 'FAILED'].includes(stage) && !['QUEUED', 'PROCESSING', 'RETRY_WAIT'].includes(latestJob?.status ?? '') ? { completedAt: (latestJob?.updatedAt ?? source.updatedAt).toISOString() } : {}),
    } : undefined;
    const { document: _document, ...sourceSummary } = source;
    const vectorCount = (vectorProfiles as Array<{ vectorCount: number }>).reduce((sum, profile) => sum + Number(profile.vectorCount), 0);
    const embeddingProfile = (vectorProfiles as Array<{ embeddingProvider: string; embeddingModel: string; embeddingDimensions: number }>).length === 1 ? (vectorProfiles as Array<{ embeddingProvider: string; embeddingModel: string; embeddingDimensions: number }>)[0] : null;
    const semanticEnabled = semanticIndexEnabled() && Boolean(this.embeddings) && !semanticConfigurationError();
    // The queue enforces one active job per source/version/kind; its current job
    // is therefore present in this bounded five-row history window.
    const activeIndexJob = jobs.some((job: any) => job.kind === 'INDEX' && ['QUEUED', 'PROCESSING', 'RETRY_WAIT'].includes(job.status));
    const profileMatchesConfiguration = Boolean(this.embeddings && embeddingProfile
      && embeddingProfile.embeddingProvider === this.embeddings.provider
      && embeddingProfile.embeddingModel === this.embeddings.model
      && embeddingProfile.embeddingDimensions === this.embeddings.dimensions);
    const completeCurrentVectors = source.processingStatus === 'READY' && chunks > 0 && vectorCount === chunks && profileMatchesConfiguration;
    let semanticStatus: 'NOT_CONFIGURED' | 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
    let semanticStatusError: string | null;
    if (!semanticEnabled) {
      semanticStatus = 'NOT_CONFIGURED';
      semanticStatusError = semanticIndexEnabled() ? semanticConfigurationError() ?? 'EMBEDDING_PROVIDER_NOT_CONFIGURED' : 'SEMANTIC_INDEX_DISABLED';
    } else if (activeIndexJob) {
      semanticStatus = 'PROCESSING';
      semanticStatusError = null;
    } else if (completeCurrentVectors) {
      semanticStatus = 'READY';
      semanticStatusError = null;
    } else if (source.processingStatus === 'FAILED' || source.semanticIndexStatus === 'FAILED') {
      semanticStatus = 'FAILED';
      semanticStatusError = source.semanticIndexErrorCode ?? source.processingErrorCode ?? 'SEMANTIC_INDEX_FAILED';
    } else if (vectorCount > 0 && (!profileMatchesConfiguration || vectorCount !== chunks)) {
      semanticStatus = 'FAILED';
      semanticStatusError = !profileMatchesConfiguration ? 'EMBEDDING_INDEX_PROFILE_MISMATCH' : 'EMBEDDING_INDEX_VECTOR_COUNT_MISMATCH';
    } else {
      semanticStatus = 'PENDING';
      semanticStatusError = null;
    }
    return { ...sourceSummary, semanticIndexStatus: semanticStatus, semanticIndexErrorCode: semanticStatusError, ...(documentProgress ? { documentProgress } : {}), jobs, chunkCount: chunks, semanticVectorCount: vectorCount, semanticEmbeddingModel: embeddingProfile?.embeddingModel ?? null, semanticEmbeddingProvider: embeddingProfile?.embeddingProvider ?? null, semanticEmbeddingDimensions: embeddingProfile?.embeddingDimensions ?? null, lastIndexedAt: latestIndexed._max.indexedAt };
  }

  async listSourceChunks(userId: string, slug: string, sourceId: string, query: { page?: number; pageSize?: number; search?: string }) {
    const member = await this.workspaces.requireAccess(userId, slug);
    const source = await this.db.knowledgeSource.findFirst({ where: { id: sourceId, organizationId: member.organizationId }, select: { id: true, sourceVersion: true, activeIndexGeneration: true, processingStatus: true } });
    if (!source) throw this.sourceNotFound();
    const page = Math.min(10000, Math.max(1, query.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, query.pageSize ?? 20));
    const search = query.search?.trim().slice(0, 200);
    const where = { organizationId: member.organizationId, sourceId, ...(search ? { content: { contains: search, mode: 'insensitive' } } : {}) };
    const [rows, total, activeCount] = await Promise.all([
      this.db.knowledgeChunk.findMany({ where, orderBy: [{ generation: 'desc' }, { sequence: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, pageId: true, sourceVersion: true, generation: true, sequence: true, content: true, locator: true, indexedAt: true, page: { select: { title: true, canonicalUrl: true, status: true } } } }),
      this.db.knowledgeChunk.count({ where }),
      source.activeIndexGeneration == null ? Promise.resolve(0) : this.db.knowledgeChunk.count({ where: { organizationId: member.organizationId, sourceId, sourceVersion: source.sourceVersion, generation: source.activeIndexGeneration } }),
    ]);
    return { sourceId, sourceVersion: source.sourceVersion, activeGeneration: source.activeIndexGeneration, processingStatus: source.processingStatus, activeChunkCount: activeCount, chunks: rows.map(({ content, ...row }: any) => ({ ...row, contentPreview: String(content).slice(0, 800), active: source.processingStatus === 'READY' && row.sourceVersion === source.sourceVersion && row.generation === source.activeIndexGeneration })), total, page, pageSize, pageCount: Math.ceil(total / pageSize) };
  }

  /** Resolve trace IDs in one authenticated, tenant-scoped read. This is presentation metadata only. */
  async resolveEvidenceMetadata(userId: string, slug: string, assistantId: string, items: Array<{ sourceId: string; chunkId: string; pageId?: string | null; sourceVersion: number; generation: number }>) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const bounded = items.slice(0, 40);
    const effective = await this.bases.resolveEffectiveSources(member.organizationId, assistantId, { publicOnly: true });
    const eligible = new Map(effective.sources.map((source: any) => [source.id, source] as const));
    const sourceIds = [...new Set(bounded.map((item) => item.sourceId).filter((id) => eligible.has(id)))];
    const baseNames = new Map(effective.knowledgeBases.map((base: any) => [base.id, base.name] as const));
    const [sources, chunks] = sourceIds.length ? await Promise.all([
      this.db.knowledgeSource.findMany({ where: { organizationId: member.organizationId, id: { in: sourceIds } }, select: { id: true, name: true, type: true, document: true, knowledgeSection: true, sourceVersion: true, activeIndexGeneration: true, visibility: true, processingStatus: true, status: true, deletedAt: true } }),
      this.db.knowledgeChunk.findMany({ where: { organizationId: member.organizationId, sourceId: { in: sourceIds }, id: { in: bounded.map((item) => item.chunkId) } }, select: { id: true, sourceId: true, pageId: true, locator: true, sourceVersion: true, generation: true, sequence: true } }),
    ]) : [[], []];
    const sourceById = new Map((sources as any[]).map((source) => [source.id, source] as const));
    const chunkById = new Map((chunks as any[]).map((chunk) => [chunk.id, chunk] as const));
    return { items: bounded.map((trace) => {
      const source: any = sourceById.get(trace.sourceId);
      const current: any = eligible.get(trace.sourceId);
      if (!source || !current) return { sourceId: trace.sourceId, chunkId: trace.chunkId, status: 'METADATA_UNAVAILABLE' as const };
      const historical = trace.sourceVersion !== source.sourceVersion || trace.generation !== source.activeIndexGeneration;
      if (historical) return { sourceId: trace.sourceId, chunkId: trace.chunkId, status: 'HISTORICAL_SOURCE_NO_LONGER_ELIGIBLE' as const };
      const chunk: any = chunkById.get(trace.chunkId);
      if (!chunk || chunk.sourceId !== source.id || chunk.sourceVersion !== source.sourceVersion || chunk.generation !== source.activeIndexGeneration || (trace.pageId && chunk.pageId !== trace.pageId)) {
        return { sourceId: trace.sourceId, chunkId: trace.chunkId, status: 'METADATA_UNAVAILABLE' as const };
      }
      const knowledgeBaseIds: string[] = current.knowledgeBaseIds ?? [];
      const knowledgeBase = effective.knowledgeBases.find((base: any) => knowledgeBaseIds.includes(base.id));
      return { sourceId: source.id, chunkId: chunk.id, status: 'CURRENT_VERIFIED_PDF' as const,
        provenance: 'AUTHENTICATED_PDF_EXTRACTION_V1' as const, filename: source.document?.filename ?? null, title: source.name,
        section: source.knowledgeSection, knowledgeBaseId: knowledgeBase?.id ?? null, knowledgeBaseName: knowledgeBase ? baseNames.get(knowledgeBase.id) ?? null : null,
        sourceVersion: source.sourceVersion, generation: source.activeIndexGeneration, pageId: chunk.pageId,
        locator: chunk.locator, chunkSequence: chunk.sequence, customerVisible: source.visibility === 'PUBLIC_REFERENCE' };
    }) };
  }

  /** Paginated, tenant-scoped view of persisted website page records for workspace managers. */

  async retry(userId: string, slug: string, sourceId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const source = await this.db.knowledgeSource.findFirst({ where: { id: sourceId, organizationId: member.organizationId, status: 'REGISTERED' } });
    if (!source) throw this.sourceNotFound();
    if (source.type === 'WEBSITE') return this.enqueueWebsite(userId, slug, sourceId);
    if (!isVerifiedPdfDocumentSource(source)) throw new ConflictException({ code: 'PDF_PROVENANCE_REPROCESS_REQUIRED', message: 'Replace this historical document with its original PDF before reindexing customer Knowledge.' });
    await this.enqueueRecord(source, 'INDEX');
    return { sourceId, status: 'queued', sourceVersion: source.sourceVersion };
  }

  async enqueueWebsite(userId: string, slug: string, sourceId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const source = await this.db.knowledgeSource.findFirst({ where: { id: sourceId, organizationId: member.organizationId, type: 'WEBSITE', status: 'REGISTERED' } });
    if (!source) throw this.sourceNotFound();
    if (requiresVerifiedWebsiteDomain(source) && !websiteDomainIsVerified(source)) throw new ForbiddenException({ code: 'SHOPIFY_STOREFRONT_DOMAIN_NOT_VERIFIED', message: 'Verify control of the Shopify storefront domain before refreshing Shopify storefront discovery.' });
    if (source.syncPaused) throw new ConflictException({ code: 'WEBSITE_SYNC_PAUSED', message: 'Resume website synchronization before starting a sync.' });
    const queued = await this.queueWebsiteCrawl(source);
    await this.db.auditEvent.create({ data: { organizationId: member.organizationId, actorUserId: userId, action: 'knowledge.website_sync_enqueued', entityType: 'knowledge_source', entityId: source.id, metadata: { sourceVersion: source.sourceVersion, jobId: queued.jobId } } });
    return queued;
  }

  private async queueWebsiteCrawl(source: any) {
    return this.db.$transaction(async (tx: any) => {
      const current: WebsiteVerificationGate & { id: string; sourceVersion: number } | null = await tx.knowledgeSource.findFirst({ where: { id: source.id, organizationId: source.organizationId, sourceVersion: source.sourceVersion, type: 'WEBSITE', status: 'REGISTERED', syncPaused: false }, select: { id: true, sourceVersion: true, category: true, description: true, verificationStatus: true, verifiedAt: true } });
      if (!current) throw new ConflictException({ code: 'WEBSITE_SOURCE_NOT_SYNCABLE', message: 'The website changed or is not currently authorized for synchronization.' });
      if (requiresVerifiedWebsiteDomain(current) && !websiteDomainIsVerified(current)) throw new ForbiddenException({ code: 'SHOPIFY_STOREFRONT_DOMAIN_NOT_VERIFIED', message: 'Verify control of the Shopify storefront domain before refreshing Shopify storefront discovery.' });
      const active = await tx.knowledgeProcessingJob.findFirst({ where: { organizationId: source.organizationId, sourceId: source.id, sourceVersion: source.sourceVersion, kind: 'CRAWL', status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, select: { id: true } });
      if (active) return { sourceId: source.id, jobId: active.id, status: 'already_queued', sourceVersion: source.sourceVersion };
      const job = await tx.knowledgeProcessingJob.create({ data: { organizationId: source.organizationId, sourceId: source.id, sourceVersion: source.sourceVersion, kind: 'CRAWL', status: 'QUEUED' }, select: { id: true } });
      await tx.knowledgeSyncRun.create({ data: { organizationId: source.organizationId, sourceId: source.id, jobId: job.id, status: 'QUEUED' } });
      await tx.knowledgeSource.update({ where: { id_organizationId: { id: source.id, organizationId: source.organizationId } }, data: { lastSyncAttemptAt: new Date(), processingStatus: source.activeIndexGeneration == null ? 'QUEUED' : 'READY', processingErrorCode: null } });
      return { sourceId: source.id, jobId: job.id, status: 'queued', sourceVersion: source.sourceVersion };
    });
  }

  private async enqueueScheduledWebsites() {
    const due = await this.db.knowledgeSource.findMany({ where: { type: 'WEBSITE', status: 'REGISTERED', syncPaused: false, syncPolicy: { in: ['DAILY', 'WEEKLY'] }, nextSyncAt: { lte: new Date() } }, take: 10, orderBy: [{ nextSyncAt: 'asc' }, { id: 'asc' }] });
    for (const source of due) {
      try { await this.queueWebsiteCrawl(source); }
      catch (error) { this.logger.warn(JSON.stringify({ event: 'website_sync_schedule_failed', organizationId: source.organizationId, sourceId: source.id, errorType: safeDiagnosticErrorName(error) })); }
    }
  }

  /** Returns only language metadata for sources already eligible to the authenticated assistant's public chat. */
  async publicSourceLanguageHints(userId: string, slug: string, assistantId: string): Promise<string[]> {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const assistant = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId: member.organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!assistant) throw new NotFoundException({ code: 'ASSISTANT_NOT_FOUND', message: 'Active assistant not found in this workspace.' });
    const scope = await this.bases.resolveEffectiveSources(member.organizationId, assistantId, { publicOnly: true });
    const eligibleSources = sourcesForAudience(scope.sources, 'PUBLIC_VISITOR').filter((source: any) => ['FAQ', 'TEXT', 'WEBSITE'].includes(source.type));
    const websiteIds = eligibleSources.filter((source: any) => source.type === 'WEBSITE').map((source: any) => source.id);
    const websiteBoundIds = await this.filterEligiblePublicWebsiteSources(member.organizationId, websiteIds);
    const connectorEligibleIds = await this.filterConnectorKnowledgeSources(member.organizationId, assistantId, [...eligibleSources.filter((source: any) => source.type !== 'WEBSITE').map((source: any) => source.id), ...websiteBoundIds]);
    const eligibleIds = await this.filterVerifiedPdfSources(member.organizationId, connectorEligibleIds);
    const languageRows: Array<{ id: string; type: string; languageHint: string | null; sourceVersion: number; activeIndexGeneration: number | null }> = eligibleIds.length ? await this.db.knowledgeSource.findMany({
      where: { organizationId: member.organizationId, id: { in: eligibleIds }, type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: 'REGISTERED', processingStatus: 'READY', visibility: 'PUBLIC_REFERENCE', deletedAt: null },
      select: { id: true, type: true, languageHint: true, sourceVersion: true, activeIndexGeneration: true },
    }) : [];
    const websiteGenerations = languageRows.filter((source) => source.type === 'WEBSITE' && Number.isSafeInteger(source.sourceVersion) && Number.isSafeInteger(source.activeIndexGeneration))
      .map((source) => ({ sourceId: source.id, sourceVersion: source.sourceVersion, generation: source.activeIndexGeneration! }));
    const pageLanguageRows: Array<{ languageHint: string | null }> = websiteGenerations.length ? await this.db.knowledgePage.findMany({
      where: { organizationId: member.organizationId, status: 'READY', OR: websiteGenerations },
      orderBy: [{ fetchedAt: 'desc' }, { id: 'asc' }],
      take: 100,
      select: { languageHint: true },
    }) : [];
    const hints: string[] = [...languageRows, ...pageLanguageRows]
      .map((source) => typeof source.languageHint === 'string' ? source.languageHint.trim().slice(0, 60) : '')
      .filter((hint) => hint.length > 0 && /^[\p{L}\p{M}\p{N} .,+()/'&_-]+$/u.test(hint));
    return [...new Set(hints)].slice(0, 8);
  }

  /** Read model used by workspace UI; it shares the exact public source gates with retrieval. */
  async effectivePublicKnowledge(userId: string, slug: string, assistantId: string) {
    const member = await this.workspaces.requireAccess(userId, slug);
    const scope = await this.bases.resolveEffectiveSources(member.organizationId, assistantId, { publicOnly: true, includeDiagnostics: true });
    const allPublicSources = sourcesForAudience(scope.sources, 'PUBLIC_VISITOR').filter((source: any) => ['FAQ', 'TEXT', 'WEBSITE'].includes(source.type));
    const pdfSourceIds = new Set(await this.filterVerifiedPdfSources(member.organizationId, allPublicSources.map((source: any) => source.id)));
    const publicSources = allPublicSources.filter((source: any) => pdfSourceIds.has(source.id));
    const websiteIds = publicSources.filter((source: any) => source.type === 'WEBSITE').map((source: any) => source.id);
    const safeWebsiteIds = await this.filterEligiblePublicWebsiteSources(member.organizationId, websiteIds);
    const candidateIds = [...publicSources.filter((source: any) => source.type !== 'WEBSITE').map((source: any) => source.id), ...safeWebsiteIds];
    const connectorAuthorizedIds = await this.filterConnectorKnowledgeSources(member.organizationId, assistantId, candidateIds);
    const authorizedIds = new Set(await this.filterVerifiedPdfSources(member.organizationId, connectorAuthorizedIds));
    const blockedReasonCounts = { ...(scope.blockedReasonCounts ?? {}) } as Record<string, number>;
    const websiteAuthorizationBlocked = websiteIds.length - safeWebsiteIds.length;
    const connectorAuthorizationBlocked = candidateIds.length - authorizedIds.size;
    if (websiteAuthorizationBlocked > 0) blockedReasonCounts.WEBSITE_VERIFICATION_REQUIRED = (blockedReasonCounts.WEBSITE_VERIFICATION_REQUIRED ?? 0) + websiteAuthorizationBlocked;
    if (connectorAuthorizationBlocked > 0) blockedReasonCounts.CONNECTOR_OR_ASSISTANT_PERMISSION_REQUIRED = (blockedReasonCounts.CONNECTOR_OR_ASSISTANT_PERMISSION_REQUIRED ?? 0) + connectorAuthorizationBlocked;
    const authorizedSources = publicSources.filter((source: any) => authorizedIds.has(source.id));
    const activeSources = authorizedSources.filter((source: any) => Number.isSafeInteger(source.activeIndexGeneration) && Number.isSafeInteger(source.sourceVersion));
    const chunkGroups = activeSources.length ? await this.db.knowledgeChunk.groupBy({
      by: ['sourceId', 'sourceVersion', 'generation'],
      where: { organizationId: member.organizationId, OR: activeSources.map((source: any) => ({ sourceId: source.id, sourceVersion: source.sourceVersion, generation: source.activeIndexGeneration })) },
      _count: { _all: true },
    }) : [];
    const sources = authorizedSources.map((source: any) => ({
      ...source,
      activeChunkCount: chunkGroups.filter((group: any) => group.sourceId === source.id && group.sourceVersion === source.sourceVersion && group.generation === source.activeIndexGeneration).reduce((count: number, group: any) => count + group._count._all, 0),
    }));
    const searchableIds = new Set(sources.filter((source: any) => source.activeChunkCount > 0).map((source: any) => source.id));
    const knowledgeBases = scope.knowledgeBases.map((base: any) => {
      const eligibleSourceCount = sources.filter((source: any) => searchableIds.has(source.id) && source.knowledgeBaseIds?.includes(base.id)).length;
      return { ...base, eligibleSourceCount, retrievalEnabled: eligibleSourceCount > 0 };
    });
    return { ...scope, blockedReasonCounts, knowledgeBases, sources, searchableSourceCount: searchableIds.size, retrievalEnabled: searchableIds.size > 0 };
  }

  /** Recomputes public source assignment and connector permissions for tool manifest eligibility. */
  async eligiblePublicSourceCount(userId: string, slug: string, assistantId: string): Promise<number> {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const assistant = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId: member.organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!assistant) return 0;
    const scope = await this.bases.resolveEffectiveSources(member.organizationId, assistantId, { publicOnly: true });
    const ids = sourcesForAudience(scope.sources, 'PUBLIC_VISITOR')
      .filter((source: any) => ['FAQ', 'TEXT', 'WEBSITE'].includes(source.type))
      .map((source: any) => source.id);
    const websiteIds = scope.sources.filter((source: any) => ids.includes(source.id) && source.type === 'WEBSITE').map((source: any) => source.id);
    const websiteBoundIds = await this.filterEligiblePublicWebsiteSources(member.organizationId, websiteIds);
    const connectorEligibleIds = await this.filterConnectorKnowledgeSources(member.organizationId, assistantId, [...ids.filter((id) => !websiteIds.includes(id)), ...websiteBoundIds]);
    const eligibleIds = await this.filterVerifiedPdfSources(member.organizationId, connectorEligibleIds);
    if (!eligibleIds.length) return 0;
    return this.db.knowledgeSource.count({ where: { organizationId: member.organizationId, id: { in: eligibleIds }, status: 'REGISTERED', processingStatus: 'READY', visibility: 'PUBLIC_REFERENCE', deletedAt: null } });
  }

  /** Returns source types passing effective knowledge, public visibility, and connector permissions. */
  async eligiblePublicSourceTypes(userId: string, slug: string, assistantId: string): Promise<readonly ('FAQ' | 'TEXT' | 'WEBSITE')[]> {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const assistant = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId: member.organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!assistant) return [];
    const scope = await this.bases.resolveEffectiveSources(member.organizationId, assistantId, { publicOnly: true });
    const ids = sourcesForAudience(scope.sources, 'PUBLIC_VISITOR')
      .filter((source: any) => ['FAQ', 'TEXT', 'WEBSITE'].includes(source.type))
      .map((source: any) => source.id);
    const websiteIds = scope.sources.filter((source: any) => ids.includes(source.id) && source.type === 'WEBSITE').map((source: any) => source.id);
    const websiteBoundIds = await this.filterEligiblePublicWebsiteSources(member.organizationId, websiteIds);
    const connectorEligibleIds = await this.filterConnectorKnowledgeSources(member.organizationId, assistantId, [...ids.filter((id) => !websiteIds.includes(id)), ...websiteBoundIds]);
    const eligibleIds = await this.filterVerifiedPdfSources(member.organizationId, connectorEligibleIds);
    if (!eligibleIds.length) return [];
    const rows = await this.db.knowledgeSource.groupBy({
      by: ['type'],
      where: {
        organizationId: member.organizationId,
        id: { in: eligibleIds },
        status: 'REGISTERED',
        processingStatus: 'READY',
        visibility: 'PUBLIC_REFERENCE',
        deletedAt: null,
      },
      _count: { _all: true },
    });
    return rows.flatMap((row: { type: string }) => row.type === 'FAQ' || row.type === 'TEXT' || row.type === 'WEBSITE' ? [row.type] : []);
  }

  async searchPreview(userId: string, slug: string, assistantId: string, query: string | readonly string[], limit = 5, audience: 'INTERNAL_MANAGER_PREVIEW' | 'PUBLIC_VISITOR' = 'INTERNAL_MANAGER_PREVIEW'): Promise<KnowledgePreviewResponse> {
    const retrievalStartedAt = Date.now();
    const seenQueries = new Set<string>();
    const queryCandidates = (typeof query === 'string' ? [query] : [...query])
      .map((candidate) => candidate.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300))
      .filter((candidate) => {
        const identity = candidate.toLowerCase();
        if (!candidate || seenQueries.has(identity)) return false;
        seenQueries.add(identity);
        return true;
      }).slice(0, 8);
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const assistant = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId: member.organizationId, status: 'ACTIVE' }, select: { id: true, website: { select: { domain: true, status: true, verificationStatus: true } } } });
    if (!assistant) throw new NotFoundException({ code: 'ASSISTANT_NOT_FOUND', message: 'Active assistant not found in this workspace.' });
    const scope = await this.bases.resolveEffectiveSources(member.organizationId, assistantId, { publicOnly: audience === 'PUBLIC_VISITOR', includeDiagnostics: true });
    const allAssignedScope = audience === 'PUBLIC_VISITOR'
      ? await this.bases.resolveEffectiveSources(member.organizationId, assistantId)
      : scope;
    const assignedSourceCount = sourcesForAudience(allAssignedScope.sources, 'INTERNAL_MANAGER_PREVIEW').filter((source: any) => ['FAQ', 'TEXT', 'WEBSITE'].includes(source.type)).length;
    const assignedSourceIds = sourcesForAudience(scope.sources, audience)
      .filter((source: any) => ['FAQ', 'TEXT', 'WEBSITE'].includes(source.type))
      .map((source: any) => source.id);
    const websiteIds = audience === 'PUBLIC_VISITOR'
      ? scope.sources.filter((source: any) => source.type === 'WEBSITE').map((source: any) => source.id)
      : [];
    const eligibleWebsiteIds = audience === 'PUBLIC_VISITOR'
      ? await this.filterEligiblePublicWebsiteSources(member.organizationId, websiteIds)
      : [];
    const authorizedSourceIds = audience === 'PUBLIC_VISITOR'
      ? [...assignedSourceIds.filter((id) => !websiteIds.includes(id)), ...eligibleWebsiteIds]
      : assignedSourceIds;
    const connectorAuthorizedSourceIds = await this.filterConnectorKnowledgeSources(member.organizationId, assistantId, authorizedSourceIds);
    let sourceIds = connectorAuthorizedSourceIds;
    this.logger.debug(JSON.stringify({ event: 'knowledge_retrieval_authorization', organizationId: member.organizationId, assistantId, audience, assignedCandidateCount: authorizedSourceIds.length, eligibleSourceCount: sourceIds.length, permissionFilteredCount: authorizedSourceIds.length - sourceIds.length }));
    const context = audience === 'PUBLIC_VISITOR' ? 'public_safe_playground_preview' : 'authenticated_workspace_preview';
    const rejectionReasons = [
      ...(audience === 'PUBLIC_VISITOR' ? Object.entries(scope.blockedReasonCounts ?? {}).map(([reason, count]) => ({ reason, count })) : []),
      ...(audience === 'PUBLIC_VISITOR' && !scope.useAllEligibleWorkspaceKnowledge && assignedSourceCount > assignedSourceIds.length ? [{ reason: 'SOURCE_NOT_PUBLIC_OR_DELETED', count: assignedSourceCount - assignedSourceIds.length }] : []),
      ...(audience === 'PUBLIC_VISITOR' && websiteIds.length > eligibleWebsiteIds.length ? [{ reason: 'PUBLIC_WEBSITE_NOT_ELIGIBLE', count: websiteIds.length - eligibleWebsiteIds.length }] : []),
      ...(authorizedSourceIds.length > sourceIds.length ? [{ reason: 'CONNECTOR_PERMISSION_OR_CAPABILITY_BLOCKED', count: authorizedSourceIds.length - sourceIds.length }] : []),
    ];
    if (!queryCandidates.length) return { results: [], mode: 'lexical_only', context, audience, eligibleSourceCount: sourceIds.length, semanticUnavailableCode: 'EMPTY_QUERY', diagnostics: { assignedSourceCount, rejectedSourceCount: Math.max(0, assignedSourceCount - sourceIds.length), indexReadySourceCount: 0, activeIndexChunkCount: 0, indexReadinessDurationMs: 0, queryVariantCount: 0, lexicalCandidateCount: 0, semanticCandidateCount: 0, rankedCandidateCount: 0, selectedEvidenceCount: 0, lexicalDurationMs: 0, semanticDurationMs: 0, rankingDurationMs: 0, methodsAttempted: [], rejectionReasons, sourceIndexStates: [], retrievalReason: 'EMPTY_QUERY' } };
    if (!sourceIds.length) return { results: [], mode: 'lexical_only', context, audience, eligibleSourceCount: 0, semanticUnavailableCode: this.embeddings ? 'NO_AUTHORIZED_SOURCES' : semanticConfigurationError() ?? 'SEMANTIC_NOT_CONFIGURED', diagnostics: { assignedSourceCount, rejectedSourceCount: assignedSourceCount, indexReadySourceCount: 0, activeIndexChunkCount: 0, indexReadinessDurationMs: 0, queryVariantCount: queryCandidates.length, lexicalCandidateCount: 0, semanticCandidateCount: 0, rankedCandidateCount: 0, selectedEvidenceCount: 0, lexicalDurationMs: 0, semanticDurationMs: 0, rankingDurationMs: 0, methodsAttempted: [], rejectionReasons, sourceIndexStates: [], retrievalReason: 'NO_ELIGIBLE_SOURCES' } };
    const indexReadinessStartedAt = Date.now();
    const sourceReadiness = await this.db.knowledgeSource.findMany({ where: { organizationId: member.organizationId, id: { in: sourceIds } }, select: { id: true, type: true, document: true, status: true, processingStatus: true, sourceVersion: true, activeIndexGeneration: true, visibility: true, deletedAt: true } });
    {
      const pdfSourceIds = new Set(sourceReadiness.filter((source: any) => isVerifiedPdfDocumentSource(source)).map((source: any) => source.id));
      const beforePdfEligibility = sourceIds.length;
      sourceIds = sourceIds.filter((id) => pdfSourceIds.has(id));
      if (beforePdfEligibility > sourceIds.length) rejectionReasons.push({ reason: 'PDF_DOCUMENT_PROVENANCE_REQUIRED', count: beforePdfEligibility - sourceIds.length });
    }
    const readySources = sourceReadiness.filter((source: any) => sourceIds.includes(source.id) && source.status === 'REGISTERED' && source.processingStatus === 'READY' && (audience !== 'PUBLIC_VISITOR' || (source.visibility === 'PUBLIC_REFERENCE' && source.deletedAt === null)));
    if (!sourceIds.length) return { results: [], mode: 'lexical_only', context, audience, eligibleSourceCount: 0, semanticUnavailableCode: this.embeddings ? 'NO_AUTHORIZED_SOURCES' : semanticConfigurationError() ?? 'SEMANTIC_NOT_CONFIGURED', diagnostics: { assignedSourceCount, rejectedSourceCount: assignedSourceCount, indexReadySourceCount: 0, activeIndexChunkCount: 0, indexReadinessDurationMs: Date.now() - indexReadinessStartedAt, queryVariantCount: queryCandidates.length, lexicalCandidateCount: 0, semanticCandidateCount: 0, rankedCandidateCount: 0, selectedEvidenceCount: 0, lexicalDurationMs: 0, semanticDurationMs: 0, rankingDurationMs: 0, methodsAttempted: [], rejectionReasons, sourceIndexStates: [], retrievalReason: 'NO_ELIGIBLE_SOURCES' } };
    const activeIndexSources = readySources.filter((source: any) => Number.isSafeInteger(source.activeIndexGeneration) && Number.isSafeInteger(source.sourceVersion));
    const activeIndexChunkCount = activeIndexSources.length ? await this.db.knowledgeChunk.count({ where: { organizationId: member.organizationId, OR: activeIndexSources.map((source: any) => ({ sourceId: source.id, sourceVersion: source.sourceVersion, generation: source.activeIndexGeneration })) } }) : 0;
    const readySourceIds = readySources.map((source: any) => source.id);
    const indexReadinessDurationMs = Date.now() - indexReadinessStartedAt;
    const diagnosticSources = sourceReadiness.slice(0, 20);
    const diagnosticActiveSources = diagnosticSources.filter((source: any) => Number.isSafeInteger(source.activeIndexGeneration) && Number.isSafeInteger(source.sourceVersion));
    const diagnosticChunkGroups = diagnosticActiveSources.length ? await this.db.knowledgeChunk.groupBy({
      by: ['sourceId', 'sourceVersion', 'generation'],
      where: { organizationId: member.organizationId, OR: diagnosticActiveSources.map((source: any) => ({ sourceId: source.id, sourceVersion: source.sourceVersion, generation: source.activeIndexGeneration })) },
      _count: { _all: true },
    }) : [];
    const sourceIndexStates = diagnosticSources.map((source: any) => ({ sourceId: String(source.id).slice(0, 64), sourceVersion: Number(source.sourceVersion) || 0, activeGeneration: Number.isSafeInteger(source.activeIndexGeneration) ? source.activeIndexGeneration : null, processingStatus: String(source.processingStatus).slice(0, 40), ready: readySourceIds.includes(source.id), activeChunkCount: diagnosticChunkGroups.filter((group: any) => group.sourceId === source.id && group.sourceVersion === source.sourceVersion && group.generation === source.activeIndexGeneration).reduce((total: number, group: any) => total + group._count._all, 0) }));
    const safeLimit = Math.max(1, Math.min(10, limit));
    const candidateLimit = 40; // Rank a bounded pool before applying the final evidence limit.
    const publicOnly = audience === 'PUBLIC_VISITOR';
    let semanticProfile: { provider: string; model: string; dimensions: number; vectorTexts: string[] } | null = null;
    let semanticUnavailableCode: string | undefined;
    let semanticDurationMs = 0;
    let semanticSearchAttempted = false;
    if (this.embeddings) {
      try {
        const semanticStartedAt = Date.now();
        const vectors = await this.embeddings.embed(queryCandidates);
        semanticDurationMs = Date.now() - semanticStartedAt;
        if (vectors.length !== queryCandidates.length || vectors.some((vector) => vector.length !== this.embeddings!.dimensions || vector.some((value) => !Number.isFinite(value)))) throw Object.assign(new Error('Invalid query vector dimensions'), { code: 'EMBEDDING_DIMENSION_MISMATCH' });
        semanticProfile = { provider: this.embeddings.provider, model: this.embeddings.model, dimensions: this.embeddings.dimensions, vectorTexts: vectors.map((vector) => `[${vector.join(',')}]`) };
      } catch (error: any) {
        semanticUnavailableCode = String(error?.response?.code ?? error?.code ?? 'EMBEDDING_PROVIDER_UNAVAILABLE');
      }
    } else semanticUnavailableCode = semanticConfigurationError() ?? 'SEMANTIC_NOT_CONFIGURED';
    const lexicalStartedAt = Date.now();
    const lexicalRows: Array<KnowledgePreviewResult & { __candidateCount?: bigint | number }> = await this.db.$queryRaw`
      WITH q AS (
        SELECT websearch_to_tsquery('simple', candidate.query_text) AS terms,
          phraseto_tsquery('simple', candidate.query_text) AS phrase,
          websearch_to_tsquery('english', candidate.query_text) AS english_terms,
          phraseto_tsquery('english', candidate.query_text) AS english_phrase
        FROM unnest(${queryCandidates}::text[]) AS candidate(query_text)
      ),
      eligible_sources AS (
        SELECT s.id FROM "KnowledgeSource" s
        WHERE s."organizationId"=${member.organizationId}::uuid AND s.id=ANY(${sourceIds}::uuid[])
          AND s.status='REGISTERED' AND s."processingStatus"='READY'
          AND s.document->>'provenance'='AUTHENTICATED_PDF_EXTRACTION_V1'
          AND (NOT ${publicOnly}::boolean OR (s.type='TEXT' AND s.document->>'extracted'='true' AND s.document->>'sourceLanguage'='en'
            AND COALESCE(s.document->>'filename','') ~* '\\.pdf$' AND COALESCE(s.document->>'bytes','') ~ '^[1-9][0-9]*$'
            AND COALESCE(s.document->>'hash','') ~* '^[a-f0-9]{64}$' AND COALESCE(s.document->>'contentHash','') ~* '^[a-f0-9]{64}$'
            AND jsonb_typeof(s.document->'pages')='array' AND jsonb_array_length(s.document->'pages') > 0
            AND s.document->>'pageCount'=jsonb_array_length(s.document->'pages')::text))
          AND (NOT ${publicOnly}::boolean OR (s.visibility='PUBLIC_REFERENCE' AND s."deletedAt" IS NULL))
          AND (s."connectorInstanceId" IS NULL OR EXISTS (SELECT 1 FROM "ConnectorInstance" ci WHERE ci.id=s."connectorInstanceId" AND ci."organizationId"=s."organizationId" AND ci.state='CONNECTED' AND ci."verifiedCapabilities" @> '["WEBSITE_CONTENT"]'::jsonb AND (s."connectorDataCategory" NOT IN ('SHOPIFY_LOCATIONS','SHOPIFY_SHIPPING','SHOPIFY_LEGAL_POLICIES','SHOPIFY_ONLINE_STORE_PAGES','SHOPIFY_MARKETS','SHOPIFY_DISCOUNTS','SHOPIFY_METAOBJECT_DEFINITIONS','SHOPIFY_METAOBJECTS') OR (s."connectorDataCategory"='SHOPIFY_LOCATIONS' AND ci."verifiedCapabilities" @> '["SHOPIFY_LOCATIONS"]'::jsonb) OR (s."connectorDataCategory"='SHOPIFY_SHIPPING' AND ci."verifiedCapabilities" @> '["SHOPIFY_SHIPPING"]'::jsonb) OR (s."connectorDataCategory"='SHOPIFY_LEGAL_POLICIES' AND ci."verifiedCapabilities" @> '["SHOPIFY_LEGAL_POLICIES"]'::jsonb) OR (s."connectorDataCategory"='SHOPIFY_ONLINE_STORE_PAGES' AND ci."verifiedCapabilities" @> '["SHOPIFY_ONLINE_STORE_PAGES"]'::jsonb) OR (s."connectorDataCategory"='SHOPIFY_MARKETS' AND ci."verifiedCapabilities" @> '["SHOPIFY_MARKETS"]'::jsonb) OR (s."connectorDataCategory"='SHOPIFY_DISCOUNTS' AND ci."verifiedCapabilities" @> '["SHOPIFY_DISCOUNTS"]'::jsonb) OR (s."connectorDataCategory"='SHOPIFY_METAOBJECT_DEFINITIONS' AND ci."verifiedCapabilities" @> '["SHOPIFY_METAOBJECT_DEFINITIONS"]'::jsonb) OR (s."connectorDataCategory"='SHOPIFY_METAOBJECTS' AND ci."verifiedCapabilities" @> '["SHOPIFY_METAOBJECTS"]'::jsonb)) AND EXISTS (SELECT 1 FROM "ConnectorDataPermission" dp WHERE dp."organizationId"=s."organizationId" AND dp."connectorInstanceId"=ci.id AND dp.category=s."connectorDataCategory" AND dp.enabled=true) AND EXISTS (SELECT 1 FROM "AssistantConnectorDataPermission" ap WHERE ap."organizationId"=s."organizationId" AND ap."connectorInstanceId"=ci.id AND ap."assistantId"=${assistantId}::uuid AND ap.category=s."connectorDataCategory" AND ap.enabled=true)))
          AND EXISTS (SELECT 1 FROM "Chatbot" a WHERE a.id=${assistantId}::uuid AND a."organizationId"=s."organizationId" AND a.status='ACTIVE')
          AND (s.type <> 'WEBSITE' OR NOT COALESCE(s.category='SHOPIFY_STOREFRONT' OR s.description LIKE 'Public storefront discovered from the connected Shopify shop.%', false) OR (s."verificationStatus"='VERIFIED' AND s."verifiedAt" IS NOT NULL))
      ),
      content_hits AS (
        SELECT c.id, GREATEST(ts_rank_cd(to_tsvector('simple', c.content), q.terms), ts_rank_cd(to_tsvector('english', c.content), q.english_terms)) AS score,
          (to_tsvector('simple', c.content) @@ q.phrase OR to_tsvector('english', c.content) @@ q.english_phrase) AS phrase_match
        FROM "KnowledgeChunk" c JOIN "KnowledgeSource" s ON s.id=c."sourceId" AND s."organizationId"=c."organizationId" CROSS JOIN q
        WHERE c."organizationId"=${member.organizationId}::uuid AND EXISTS (SELECT 1 FROM eligible_sources e WHERE e.id=c."sourceId")
          AND c."sourceVersion"=s."sourceVersion" AND c."generation"=s."activeIndexGeneration"
          AND s.status='REGISTERED' AND s."processingStatus"='READY'
          AND (to_tsvector('simple', c.content) @@ q.terms OR to_tsvector('english', c.content) @@ q.english_terms)
      ), title_hits AS (
        SELECT c.id, GREATEST(ts_rank_cd(to_tsvector('simple', s.name), q.terms), ts_rank_cd(to_tsvector('english', s.name), q.english_terms)) + 0.05 AS score,
          (to_tsvector('simple', s.name) @@ q.phrase OR to_tsvector('english', s.name) @@ q.english_phrase) AS phrase_match
        FROM "KnowledgeChunk" c JOIN "KnowledgeSource" s ON s.id=c."sourceId" AND s."organizationId"=c."organizationId" CROSS JOIN q
        WHERE c."organizationId"=${member.organizationId}::uuid AND EXISTS (SELECT 1 FROM eligible_sources e WHERE e.id=c."sourceId")
          AND c."sourceVersion"=s."sourceVersion" AND c."generation"=s."activeIndexGeneration"
          AND s.status='REGISTERED' AND s."processingStatus"='READY'
          AND (to_tsvector('simple', s.name) @@ q.terms OR to_tsvector('english', s.name) @@ q.english_terms)
      ), grouped_candidates AS (
        SELECT id, max(score) AS score, bool_or(phrase_match) AS phrase_match FROM (
          SELECT * FROM content_hits UNION ALL SELECT * FROM title_hits
        ) hits GROUP BY id
      ), candidates AS (
        SELECT id, score, phrase_match, count(*) OVER() AS candidate_count FROM grouped_candidates
        ORDER BY phrase_match DESC, score DESC LIMIT 40
      )
      SELECT candidates.candidate_count AS "__candidateCount", c.id AS "chunkId", c."pageId" AS "pageId", c.generation AS "generation", c.content, c.locator, c."sourceVersion", c."contentHash", c."indexedAt", s.id AS "sourceId", s.name AS "sourceTitle", s.type AS "sourceType", s.visibility,
        p."canonicalUrl" AS "pageUrl", p.title AS "pageTitle", p."pageCategory" AS "pageCategory", p."languageHint" AS "languageHint", p."fetchedAt" AS "pageFetchedAt", s."lastSuccessfulSyncAt" AS "sourceDataAt", CASE WHEN s."connectorDataCategory"='SHOPIFY_LEGAL_POLICIES' AND s."lastSuccessfulSyncAt" >= now() - interval '24 hours' THEN 'SHOPIFY_API_POLICY' WHEN s."connectorDataCategory"='SHOPIFY_LEGAL_POLICIES' THEN 'SHOPIFY_API_POLICY_STALE' WHEN s.type='WEBSITE' THEN 'PUBLIC_WEBSITE' ELSE 'MERCHANT_KNOWLEDGE' END AS "sourceAuthority", candidates.score AS score, 'lexical'::text AS method
        , CASE WHEN s."lastSyncErrorCode" IS NOT NULL THEN 'PARTIAL' ELSE 'COMPLETE' END AS "dataCompleteness"
      FROM candidates JOIN "KnowledgeChunk" c ON c.id=candidates.id
      JOIN "KnowledgeSource" s ON s.id=c."sourceId" AND s."organizationId"=c."organizationId"
      LEFT JOIN "KnowledgePage" p ON p.id=c."pageId" AND p."organizationId"=c."organizationId"
      WHERE s."organizationId"=${member.organizationId}::uuid AND s.status='REGISTERED' AND s."processingStatus"='READY'
          AND s.document->>'provenance'='AUTHENTICATED_PDF_EXTRACTION_V1'
        AND (NOT ${publicOnly}::boolean OR (s.visibility='PUBLIC_REFERENCE' AND s."deletedAt" IS NULL))
      ORDER BY candidates.phrase_match DESC, candidates.score DESC, c."sequence" ASC LIMIT ${candidateLimit}`;
    const lexicalDurationMs = Date.now() - lexicalStartedAt;
    const lexicalCandidateCount = Number(lexicalRows[0]?.__candidateCount ?? 0);
    const lexical: KnowledgePreviewResult[] = lexicalRows.map(({ __candidateCount: _candidateCount, ...row }) => row);
    const lexicalResponse = (): KnowledgePreviewResponse => {
      const selected = lexical.slice(0, safeLimit);
      this.logger.debug(JSON.stringify({ event: 'knowledge_retrieval_complete', organizationId: member.organizationId, assistantId, audience, strategy: 'lexical_only', queryCount: queryCandidates.length, eligibleSourceCount: sourceIds.length, selectedEvidenceCount: selected.length, semanticUnavailableCode: semanticUnavailableCode ?? 'NOT_CONFIGURED', durationMs: Date.now() - retrievalStartedAt }));
      const retrievalReason = lexical.length ? undefined : readySourceIds.length === 0 ? 'INDEX_NOT_READY' : activeIndexChunkCount === 0 ? 'EMPTY_INDEX' : 'NO_LEXICAL_MATCH';
      return { results: selected.map((item, index) => ({ ...item, rankingPosition: index + 1 })), mode: 'lexical_only', semanticUnavailableCode, context, eligibleSourceCount: sourceIds.length, audience, diagnostics: { assignedSourceCount, rejectedSourceCount: Math.max(0, assignedSourceCount - sourceIds.length), indexReadySourceCount: readySourceIds.length, activeIndexChunkCount, indexReadinessDurationMs, queryVariantCount: queryCandidates.length, lexicalCandidateCount, semanticCandidateCount: 0, rankedCandidateCount: lexical.length, selectedEvidenceCount: selected.length, lexicalDurationMs, semanticDurationMs, rankingDurationMs: 0, methodsAttempted: semanticSearchAttempted ? ['lexical', 'semantic'] : ['lexical'], rejectionReasons, sourceIndexStates, ...(retrievalReason ? { retrievalReason } : {}) } };
    };
    if (!semanticProfile) return lexicalResponse();
    const queryProfile = semanticProfile;
    const semanticSearchStartedAt = Date.now();
    semanticSearchAttempted = true;
    let semanticRowsWithCounts: Array<KnowledgePreviewResult & { __candidateCount?: bigint | number }>;
    try {
      semanticRowsWithCounts = await this.db.$queryRaw`
      WITH query_vectors AS (
        SELECT query_vector::vector AS vector FROM unnest(${queryProfile.vectorTexts}::text[]) AS candidate(query_vector)
      ), eligible_sources AS (
        SELECT s.id FROM "KnowledgeSource" s
        WHERE s."organizationId"=${member.organizationId}::uuid AND s.id=ANY(${sourceIds}::uuid[])
          AND s.status='REGISTERED' AND s."processingStatus"='READY'
          AND (NOT ${publicOnly}::boolean OR (s.type='TEXT' AND s.document->>'extracted'='true' AND s.document->>'sourceLanguage'='en'
            AND COALESCE(s.document->>'filename','') ~* '\\.pdf$' AND COALESCE(s.document->>'bytes','') ~ '^[1-9][0-9]*$'
            AND COALESCE(s.document->>'hash','') ~* '^[a-f0-9]{64}$' AND COALESCE(s.document->>'contentHash','') ~* '^[a-f0-9]{64}$'
            AND jsonb_typeof(s.document->'pages')='array' AND jsonb_array_length(s.document->'pages') > 0
            AND s.document->>'pageCount'=jsonb_array_length(s.document->'pages')::text))
          AND (NOT ${publicOnly}::boolean OR (s.visibility='PUBLIC_REFERENCE' AND s."deletedAt" IS NULL))
          AND (s."connectorInstanceId" IS NULL OR EXISTS (SELECT 1 FROM "ConnectorInstance" ci WHERE ci.id=s."connectorInstanceId" AND ci."organizationId"=s."organizationId" AND ci.state='CONNECTED' AND ci."verifiedCapabilities" @> '["WEBSITE_CONTENT"]'::jsonb AND (s."connectorDataCategory" NOT IN ('SHOPIFY_LOCATIONS','SHOPIFY_SHIPPING','SHOPIFY_LEGAL_POLICIES','SHOPIFY_ONLINE_STORE_PAGES','SHOPIFY_MARKETS','SHOPIFY_DISCOUNTS','SHOPIFY_METAOBJECT_DEFINITIONS','SHOPIFY_METAOBJECTS') OR (s."connectorDataCategory"='SHOPIFY_LOCATIONS' AND ci."verifiedCapabilities" @> '["SHOPIFY_LOCATIONS"]'::jsonb) OR (s."connectorDataCategory"='SHOPIFY_SHIPPING' AND ci."verifiedCapabilities" @> '["SHOPIFY_SHIPPING"]'::jsonb) OR (s."connectorDataCategory"='SHOPIFY_LEGAL_POLICIES' AND ci."verifiedCapabilities" @> '["SHOPIFY_LEGAL_POLICIES"]'::jsonb) OR (s."connectorDataCategory"='SHOPIFY_ONLINE_STORE_PAGES' AND ci."verifiedCapabilities" @> '["SHOPIFY_ONLINE_STORE_PAGES"]'::jsonb) OR (s."connectorDataCategory"='SHOPIFY_MARKETS' AND ci."verifiedCapabilities" @> '["SHOPIFY_MARKETS"]'::jsonb) OR (s."connectorDataCategory"='SHOPIFY_DISCOUNTS' AND ci."verifiedCapabilities" @> '["SHOPIFY_DISCOUNTS"]'::jsonb) OR (s."connectorDataCategory"='SHOPIFY_METAOBJECT_DEFINITIONS' AND ci."verifiedCapabilities" @> '["SHOPIFY_METAOBJECT_DEFINITIONS"]'::jsonb) OR (s."connectorDataCategory"='SHOPIFY_METAOBJECTS' AND ci."verifiedCapabilities" @> '["SHOPIFY_METAOBJECTS"]'::jsonb)) AND EXISTS (SELECT 1 FROM "ConnectorDataPermission" dp WHERE dp."organizationId"=s."organizationId" AND dp."connectorInstanceId"=ci.id AND dp.category=s."connectorDataCategory" AND dp.enabled=true) AND EXISTS (SELECT 1 FROM "AssistantConnectorDataPermission" ap WHERE ap."organizationId"=s."organizationId" AND ap."connectorInstanceId"=ci.id AND ap."assistantId"=${assistantId}::uuid AND ap.category=s."connectorDataCategory" AND ap.enabled=true)))
          AND EXISTS (SELECT 1 FROM "Chatbot" a WHERE a.id=${assistantId}::uuid AND a."organizationId"=s."organizationId" AND a.status='ACTIVE')
          AND (s.type <> 'WEBSITE' OR NOT COALESCE(s.category='SHOPIFY_STOREFRONT' OR s.description LIKE 'Public storefront discovered from the connected Shopify shop.%', false) OR (s."verificationStatus"='VERIFIED' AND s."verifiedAt" IS NOT NULL))
      )
      , semantic_hits AS (
        SELECT c.id, max(1 - (c.embedding <=> q.vector)) AS score, count(*) OVER() AS candidate_count
        FROM "KnowledgeChunk" c
        JOIN "KnowledgeSource" s ON s.id=c."sourceId" AND s."organizationId"=c."organizationId"
        CROSS JOIN query_vectors q
        WHERE c."organizationId"=${member.organizationId}::uuid AND EXISTS (SELECT 1 FROM eligible_sources e WHERE e.id=c."sourceId")
          AND c.embedding IS NOT NULL AND c."embeddingProvider"=${queryProfile.provider} AND c."embeddingModel"=${queryProfile.model} AND c."embeddingDimensions"=${queryProfile.dimensions}
          AND c."sourceVersion"=s."sourceVersion" AND c."generation"=s."activeIndexGeneration"
          AND s.status='REGISTERED' AND s."processingStatus"='READY'
          AND (NOT ${publicOnly}::boolean OR (s.visibility='PUBLIC_REFERENCE' AND s."deletedAt" IS NULL))
        GROUP BY c.id
        HAVING max(1 - (c.embedding <=> q.vector)) >= ${semanticMinimumSimilarity()}
        ORDER BY max(1 - (c.embedding <=> q.vector)) DESC LIMIT ${candidateLimit}
      )
      SELECT semantic_hits.candidate_count AS "__candidateCount", c.id AS "chunkId", c."pageId" AS "pageId", c.generation AS "generation", c.content, c.locator, c."sourceVersion", c."contentHash", c."indexedAt", s.id AS "sourceId", s.name AS "sourceTitle", s.type AS "sourceType", s.visibility,
        p."canonicalUrl" AS "pageUrl", p.title AS "pageTitle", p."pageCategory" AS "pageCategory", p."languageHint" AS "languageHint", p."fetchedAt" AS "pageFetchedAt", s."lastSuccessfulSyncAt" AS "sourceDataAt", CASE WHEN s."connectorDataCategory"='SHOPIFY_LEGAL_POLICIES' AND s."lastSuccessfulSyncAt" >= now() - interval '24 hours' THEN 'SHOPIFY_API_POLICY' WHEN s."connectorDataCategory"='SHOPIFY_LEGAL_POLICIES' THEN 'SHOPIFY_API_POLICY_STALE' WHEN s.type='WEBSITE' THEN 'PUBLIC_WEBSITE' ELSE 'MERCHANT_KNOWLEDGE' END AS "sourceAuthority", semantic_hits.score AS score, 'semantic'::text AS method
        , CASE WHEN s."lastSyncErrorCode" IS NOT NULL THEN 'PARTIAL' ELSE 'COMPLETE' END AS "dataCompleteness"
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeSource" s ON s.id=c."sourceId" AND s."organizationId"=c."organizationId"
      JOIN semantic_hits ON semantic_hits.id=c.id
      LEFT JOIN "KnowledgePage" p ON p.id=c."pageId" AND p."organizationId"=c."organizationId"
      WHERE c."organizationId"=${member.organizationId}::uuid
        AND (NOT ${publicOnly}::boolean OR (s.visibility='PUBLIC_REFERENCE' AND s."deletedAt" IS NULL))
      ORDER BY semantic_hits.score DESC LIMIT ${candidateLimit}`;
    } catch {
      // A vector extension/index failure must not discard successful lexical evidence.
      // Do not expose raw database errors, which may contain query parameters.
      semanticDurationMs += Date.now() - semanticSearchStartedAt;
      semanticUnavailableCode = 'SEMANTIC_QUERY_FAILED';
      return lexicalResponse();
    }
    semanticDurationMs += Date.now() - semanticSearchStartedAt;
    const semanticCandidateCount = Number(semanticRowsWithCounts[0]?.__candidateCount ?? 0);
    const semanticRows: KnowledgePreviewResult[] = semanticRowsWithCounts
      .map(({ __candidateCount: _candidateCount, ...row }) => row)
      .filter((row) => Number.isFinite(row.score) && row.score >= semanticMinimumSimilarity());
    if (!semanticRows.length && activeIndexSources.length && activeIndexChunkCount > 0) {
      // Profile fields are constrained with the stored vector in the existing schema.
      // Check only the authorized, current generations; stale vectors cannot make a source ready.
      let profiles: Array<{ embeddingProvider: string; embeddingModel: string; embeddingDimensions: number }>;
      try {
        profiles = await this.db.knowledgeChunk.groupBy({
          by: ['embeddingProvider', 'embeddingModel', 'embeddingDimensions'],
          where: { organizationId: member.organizationId, OR: activeIndexSources.map((source: any) => ({ sourceId: source.id, sourceVersion: source.sourceVersion, generation: source.activeIndexGeneration })) },
          _count: { _all: true },
        });
      } catch {
        semanticUnavailableCode = 'SEMANTIC_INDEX_STATUS_UNAVAILABLE';
        return lexicalResponse();
      }
      const matchingModel = profiles.filter((profile: any) => profile.embeddingProvider === queryProfile.provider && profile.embeddingModel === queryProfile.model);
      if (!matchingModel.some((profile: any) => profile.embeddingDimensions === queryProfile.dimensions)) {
        semanticUnavailableCode = matchingModel.length ? 'EMBEDDING_INDEX_DIMENSION_MISMATCH'
          : profiles.some((profile: any) => profile.embeddingDimensions > 0) ? 'EMBEDDING_INDEX_PROFILE_MISMATCH'
            : 'SEMANTIC_INDEX_NOT_READY';
      }
    }
    const rankingStartedAt = Date.now();
    const merged = new Map<string, KnowledgePreviewResult>();
    for (const [method, rows] of [['lexical', lexical], ['semantic', semanticRows]] as const) {
      rows.forEach((row, index) => {
        const prior = merged.get(row.chunkId) ?? { ...row, score: 0, methods: [] };
        prior.score += 1 / (60 + index + 1);
        prior.methods = [...(prior.methods ?? []), method];
        merged.set(row.chunkId, prior);
      });
    }
    const combined = [...merged.values()]
      .map((row) => ({ ...row, method: row.methods?.length === 2 ? 'hybrid_rrf' : row.methods?.[0] ?? row.method }))
      .sort((a, b) => b.score - a.score || (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0))
      .slice(0, safeLimit);
    const rankingDurationMs = Date.now() - rankingStartedAt;
    const mode = semanticRows.length ? 'hybrid' : 'lexical_only';
    const unavailable = semanticRows.length ? undefined : semanticUnavailableCode;
    const retrievalReason = combined.length ? undefined
      : readySourceIds.length === 0 ? 'INDEX_NOT_READY'
        : activeIndexChunkCount === 0 ? 'EMPTY_INDEX'
          : semanticUnavailableCode ? 'SEMANTIC_RETRIEVAL_UNAVAILABLE'
          : lexicalCandidateCount === 0 && semanticRows.length === 0 && semanticProfile ? 'NO_SEMANTIC_MATCH'
            : lexicalCandidateCount === 0 ? 'NO_LEXICAL_MATCH'
              : semanticRows.length === 0 && semanticProfile ? 'NO_SEMANTIC_MATCH'
                : 'NO_SELECTED_EVIDENCE';
    const now = Date.now();
    const oldestIndexAgeMs = combined.length ? Math.max(...combined.map((item) => Math.max(0, now - new Date(item.indexedAt).getTime()))) : null;
    this.logger.debug(JSON.stringify({ event: 'knowledge_retrieval_complete', organizationId: member.organizationId, assistantId, audience, strategy: mode, queryCount: queryCandidates.length, eligibleSourceCount: sourceIds.length, lexicalCandidateCount: lexical.length, semanticCandidateCount: semanticRows.length, selectedEvidenceCount: combined.length, oldestSelectedIndexAgeMs: Number.isFinite(oldestIndexAgeMs) ? oldestIndexAgeMs : null, semanticUnavailableCode: unavailable, durationMs: Date.now() - retrievalStartedAt }));
    return { results: combined.map((item, index) => ({ ...item, rankingPosition: index + 1 })), mode, ...(unavailable ? { semanticUnavailableCode: unavailable } : {}), context, eligibleSourceCount: sourceIds.length, audience, diagnostics: { assignedSourceCount, rejectedSourceCount: Math.max(0, assignedSourceCount - sourceIds.length), indexReadySourceCount: readySourceIds.length, activeIndexChunkCount, indexReadinessDurationMs, queryVariantCount: queryCandidates.length, lexicalCandidateCount, semanticCandidateCount, rankedCandidateCount: merged.size, selectedEvidenceCount: combined.length, lexicalDurationMs, semanticDurationMs, rankingDurationMs, methodsAttempted: ['lexical', 'semantic'], rejectionReasons, sourceIndexStates, ...(retrievalReason ? { retrievalReason } : {}) } };
  }

  private async filterConnectorKnowledgeSources(organizationId: string, assistantId: string, sourceIds: string[]) {
    if (!sourceIds.length) return [];
    const linkedSources = await this.db.knowledgeSource.findMany({ where: { organizationId, id: { in: sourceIds }, connectorInstanceId: { not: null } }, select: { id: true, connectorInstanceId: true, connectorDataCategory: true } });
    if (!linkedSources.length) return sourceIds;
    const connectorIds = [...new Set(linkedSources.map((source: any) => source.connectorInstanceId))];
    const connectors = await this.db.connectorInstance.findMany({ where: { organizationId, id: { in: connectorIds }, state: 'CONNECTED' }, select: { id: true, connectorId: true, verifiedCapabilities: true, lastVerifiedAt: true, commerceConnection: { select: { grantedScopes: true, grantedScopesVerifiedAt: true } } } });
    const liveIds = connectors.filter((row: any) => Array.isArray(row.verifiedCapabilities) && (row.verifiedCapabilities.includes('WEBSITE_CONTENT') || [...Object.values(SHOPIFY_CONTENT_SCOPE_REQUIREMENTS)].some((requirement: any) => row.verifiedCapabilities.includes(requirement.capability)))).map((row: any) => row.id);
    if (!liveIds.length) return sourceIds.filter((id) => !linkedSources.some((source: any) => source.id === id));
    const [business, assistant] = await Promise.all([
      this.db.connectorDataPermission.findMany({ where: { organizationId, connectorInstanceId: { in: liveIds }, enabled: true, category: { in: ['WEBSITE_PAGES', 'FAQ_POLICIES', ...Object.keys(SHOPIFY_CONTENT_SCOPE_REQUIREMENTS)] } }, select: { connectorInstanceId: true, category: true } }),
      this.db.assistantConnectorDataPermission.findMany({ where: { organizationId, connectorInstanceId: { in: liveIds }, assistantId, enabled: true, category: { in: ['WEBSITE_PAGES', 'FAQ_POLICIES', ...Object.keys(SHOPIFY_CONTENT_SCOPE_REQUIREMENTS)] } }, select: { connectorInstanceId: true, category: true } }),
    ]);
    const businessSet = new Set(business.map((row: any) => `${row.connectorInstanceId}:${row.category}`));
    const assistantSet = new Set(assistant.map((row: any) => `${row.connectorInstanceId}:${row.category}`));
    return sourceIds.filter((id) => {
      const source = linkedSources.find((item: any) => item.id === id);
      if (!source) return true;
      const category = source.connectorDataCategory;
      const connection = connectors.find((item: any) => item.id === source.connectorInstanceId);
      const providerReady = category in SHOPIFY_CONTENT_SCOPE_REQUIREMENTS
        ? connection?.connectorId === 'shopify_v1' && SHOPIFY_CONTENT_SCOPE_REQUIREMENTS[category as keyof typeof SHOPIFY_CONTENT_SCOPE_REQUIREMENTS].assistantEligible && isShopifyScopeSnapshotFresh(connection.commerceConnection?.grantedScopesVerifiedAt ?? connection.lastVerifiedAt) && shopifyContentCategoryAllowed(category, connection.commerceConnection?.grantedScopes ?? [], connection.verifiedCapabilities ?? [])
        : (category === 'WEBSITE_PAGES' || category === 'FAQ_POLICIES') && Array.isArray(connection?.verifiedCapabilities) && connection.verifiedCapabilities.includes('WEBSITE_CONTENT');
      return Boolean(providerReady && businessSet.has(`${source.connectorInstanceId}:${category}`) && assistantSet.has(`${source.connectorInstanceId}:${category}`));
    });
  }

  /** Static AI evidence is limited to complete PDF extraction records from the approved upload path. */
  private async filterVerifiedPdfSources(organizationId: string, sourceIds: readonly string[]): Promise<string[]> {
    const ids = [...new Set(sourceIds)];
    if (!ids.length) return [];
    const rows = await this.db.knowledgeSource.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, type: true, document: true },
    });
    const eligible = new Set(rows.filter((row: any) => isVerifiedPdfDocumentSource(row)).map((row: any) => row.id));
    return ids.filter((id) => eligible.has(id));
  }

  /** Public website evidence is not tied to widget origin; Shopify storefront ownership remains verified. */
  private async filterEligiblePublicWebsiteSources(organizationId: string, sourceIds: string[]) {
    if (!sourceIds.length) return [];
    const rows = await this.db.knowledgeSource.findMany({
      where: { organizationId, id: { in: sourceIds } },
      select: { id: true, type: true, category: true, description: true, verificationStatus: true, verifiedAt: true, status: true, processingStatus: true, visibility: true, deletedAt: true },
    });
    const sources = new Map<string, WebsiteVerificationGate & { id: string; type: string; status: string; processingStatus: string; visibility: string; deletedAt: Date | null }>();
    for (const row of rows) sources.set(row.id, row);
    return sourceIds.filter((id) => {
      const source = sources.get(id);
      if (!source) return false;
      if (source.type !== 'WEBSITE') return true;
      return source.status === 'REGISTERED' && source.processingStatus === 'READY'
        && source.visibility === 'PUBLIC_REFERENCE' && source.deletedAt === null
        && (!requiresVerifiedWebsiteDomain(source) || websiteDomainIsVerified(source));
    });
  }

  /** Batch revalidation immediately before evidence is sent to a customer-facing provider. */
  async revalidatePublicEvidence(userId: string, slug: string, assistantId: string, chunkIds: readonly string[]): Promise<KnowledgePreviewResult[]> {
    const ids = [...new Set(chunkIds)];
    if (!ids.length) return [];
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const assistant = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId: member.organizationId, status: 'ACTIVE' }, select: { id: true } });
    if (!assistant) return [];
    const scope = await this.bases.resolveEffectiveSources(member.organizationId, assistantId, { publicOnly: true });
    const websiteIds = scope.sources.filter((source: any) => source.type === 'WEBSITE').map((source: any) => source.id);
    const safeWebsiteIds = await this.filterEligiblePublicWebsiteSources(member.organizationId, websiteIds);
    const candidateSourceIds = scope.sources.filter((source: any) => source.type !== 'WEBSITE').map((source: any) => source.id).concat(safeWebsiteIds);
    const connectorAuthorizedSourceIds = await this.filterConnectorKnowledgeSources(member.organizationId, assistantId, candidateSourceIds);
    const authorizedSourceIds = await this.filterVerifiedPdfSources(member.organizationId, connectorAuthorizedSourceIds);
    if (!authorizedSourceIds.length) return [];
    const rows: KnowledgePreviewResult[] = await this.db.$queryRaw<KnowledgePreviewResult[]>`
      SELECT c.id AS "chunkId", c."pageId" AS "pageId", c.generation AS "generation", c.content, c.locator, c."sourceVersion", c."contentHash", c."indexedAt",
        s.id AS "sourceId", s.name AS "sourceTitle", s.type AS "sourceType", s.visibility,
        p."canonicalUrl" AS "pageUrl", p.title AS "pageTitle", p."pageCategory" AS "pageCategory", p."languageHint" AS "languageHint", p."fetchedAt" AS "pageFetchedAt", s."lastSuccessfulSyncAt" AS "sourceDataAt", CASE WHEN s."connectorDataCategory"='SHOPIFY_LEGAL_POLICIES' AND s."lastSuccessfulSyncAt" >= now() - interval '24 hours' THEN 'SHOPIFY_API_POLICY' WHEN s."connectorDataCategory"='SHOPIFY_LEGAL_POLICIES' THEN 'SHOPIFY_API_POLICY_STALE' WHEN s.type='WEBSITE' THEN 'PUBLIC_WEBSITE' ELSE 'MERCHANT_KNOWLEDGE' END AS "sourceAuthority", 0::float AS score, 'revalidated'::text AS method, CASE WHEN s."lastSyncErrorCode" IS NOT NULL THEN 'PARTIAL' ELSE 'COMPLETE' END AS "dataCompleteness"
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeSource" s ON s.id=c."sourceId" AND s."organizationId"=c."organizationId"
      LEFT JOIN "KnowledgePage" p ON p.id=c."pageId" AND p."organizationId"=c."organizationId"
      WHERE c."organizationId"=${member.organizationId}::uuid AND c.id=ANY(${ids}::uuid[]) AND s.id=ANY(${authorizedSourceIds}::uuid[])
        AND c."sourceVersion"=s."sourceVersion" AND c.generation=s."activeIndexGeneration"
        AND s.type IN ('FAQ','TEXT','WEBSITE') AND s.status='REGISTERED' AND s."processingStatus"='READY'
          AND s.document->>'provenance'='AUTHENTICATED_PDF_EXTRACTION_V1'
        AND s.visibility='PUBLIC_REFERENCE' AND s."deletedAt" IS NULL
        AND s.type='TEXT' AND s.document->>'extracted'='true' AND s.document->>'sourceLanguage'='en'
        AND COALESCE(s.document->>'filename','') ~* '\\.pdf$' AND COALESCE(s.document->>'bytes','') ~ '^[1-9][0-9]*$'
        AND COALESCE(s.document->>'hash','') ~* '^[a-f0-9]{64}$' AND COALESCE(s.document->>'contentHash','') ~* '^[a-f0-9]{64}$'
        AND jsonb_typeof(s.document->'pages')='array' AND jsonb_array_length(s.document->'pages') > 0
        AND s.document->>'pageCount'=jsonb_array_length(s.document->'pages')::text
        AND (s.type <> 'WEBSITE' OR NOT COALESCE(s.category='SHOPIFY_STOREFRONT' OR s.description LIKE 'Public storefront discovered from the connected Shopify shop.%', false) OR (s."verificationStatus"='VERIFIED' AND s."verifiedAt" IS NOT NULL))
        AND EXISTS (SELECT 1 FROM "Chatbot" a WHERE a.id=${assistantId}::uuid AND a."organizationId"=s."organizationId" AND a.status='ACTIVE')
        AND (s."connectorInstanceId" IS NULL OR EXISTS (
          SELECT 1 FROM "ConnectorInstance" ci
          WHERE ci.id=s."connectorInstanceId" AND ci."organizationId"=s."organizationId" AND ci.state='CONNECTED'
            AND ci."verifiedCapabilities" @> '["WEBSITE_CONTENT"]'::jsonb
            AND EXISTS (SELECT 1 FROM "ConnectorDataPermission" dp WHERE dp."organizationId"=s."organizationId" AND dp."connectorInstanceId"=ci.id AND dp.category=s."connectorDataCategory" AND dp.enabled=true)
            AND EXISTS (SELECT 1 FROM "AssistantConnectorDataPermission" ap WHERE ap."organizationId"=s."organizationId" AND ap."connectorInstanceId"=ci.id AND ap."assistantId"=${assistantId}::uuid AND ap.category=s."connectorDataCategory" AND ap.enabled=true)
        ))
    ORDER BY array_position(${ids}::uuid[], c.id)`;
    const sourceIds: string[] = [...new Set(rows.flatMap((row: KnowledgePreviewResult): string[] => typeof row.sourceId === 'string' ? [row.sourceId] : []))];
    const eligibleSourceIds: ReadonlySet<string> = new Set(await this.filterConnectorKnowledgeSources(member.organizationId, assistantId, sourceIds));
    return rows.filter((row: KnowledgePreviewResult) => typeof row.sourceId === 'string' && eligibleSourceIds.has(row.sourceId));
  }

  /** Internal server-to-server policy hook for a future widget invocation; deliberately not an anonymous HTTP route. */
  async resolvePublicVisitorSources(organizationId: string, assistantId: string, verifiedOrigin: string) {
    const assistant = await this.db.chatbot.findFirst({
      where: { id: assistantId, organizationId, status: 'ACTIVE', website: { status: 'ACTIVE' } },
      select: { id: true, organizationId: true, website: { select: { domain: true, status: true, verificationStatus: true } } },
    });
    if (!assistant?.website || assistant.website.verificationStatus !== 'VERIFIED' || !originMatchesVerifiedDomain(verifiedOrigin, assistant.website.domain)) throw new ForbiddenException({ code: 'PUBLIC_ASSISTANT_ORIGIN_DENIED', message: 'This assistant is not authorized for the requesting website origin.' });
    const scope = await this.bases.resolveEffectiveSources(organizationId, assistantId, { publicOnly: true });
    const assignedSources = sourcesForAudience(scope.sources, 'PUBLIC_VISITOR');
    const eligiblePdfIds = new Set(await this.filterVerifiedPdfSources(organizationId, assignedSources.map((source: any) => source.id)));
    const publicSources = assignedSources.filter((source: any) => eligiblePdfIds.has(source.id));
    return { organizationId, assistantId, audience: 'PUBLIC_VISITOR' as const, sources: publicSources.map((source: any) => ({ ...source, sourceOrigin: 'PDF_DOCUMENT' })) };
  }

  private async tick() {
    let stage = 'PENDING_SOURCE_RECOVERY';
    let operation = 'pending_source_recovery_query';
    try {
      // Catch sources created by Phase 07.2 batch/import paths and recover jobs after restart.
      const pending = await this.db.knowledgeSource.findMany({ where: { status: 'REGISTERED', type: { in: ['FAQ', 'TEXT'] }, processingStatus: 'NOT_PROCESSED' }, take: 20, orderBy: { createdAt: 'asc' }, select: { id: true, organizationId: true, sourceVersion: true, type: true, activeIndexGeneration: true } });
      operation = 'pending_source_recovery_enqueue';
      for (const source of pending) await this.enqueueRecord(source).catch(() => undefined);
      stage = 'SCHEDULED_WEBSITE_ENQUEUE';
      operation = 'scheduled_website_enqueue';
      await this.enqueueScheduledWebsites();
      stage = 'EXPIRED_LEASE_RECOVERY';
      operation = 'expired_lease_recovery';
      await this.requeueExpiredLeases();
      stage = 'JOB_CLAIM';
      operation = 'job_claim';
      const job = await this.claim();
      if (job) {
        stage = job.kind === 'CRAWL' ? 'WEBSITE_CRAWL' : 'KNOWLEDGE_INDEX';
        this.logger.log(JSON.stringify({
          event: 'knowledge_processing_job_claimed',
          jobFingerprint: safeJobFingerprint(job.id),
          kind: job.kind,
          attempt: job.attempts,
          stage: job.stage,
        }));
        await this.process(job);
      }
    } catch (error) {
      this.logger.warn(`Knowledge worker tick failed ${JSON.stringify({ stage, operation, ...safeWorkerDatabaseDiagnostic(error) })}`);
    }
  }

  private async enqueueRecord(source: any, kind = 'INDEX') {
    try { return await this.db.$transaction(async (tx: any) => {
      const current = await tx.knowledgeSource.findFirst({ where: { id: source.id, organizationId: source.organizationId, sourceVersion: source.sourceVersion, status: 'REGISTERED' }, select: { id: true } });
      if (!current || kind === 'CRAWL' || source.type === 'WEBSITE') return 'ineligible';
      const active = await tx.knowledgeProcessingJob.findFirst({ where: { sourceId: source.id, sourceVersion: source.sourceVersion, kind, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, select: { id: true } });
      if (active) return 'existing';
      await tx.knowledgeProcessingJob.create({ data: { organizationId: source.organizationId, sourceId: source.id, sourceVersion: source.sourceVersion, kind, status: 'QUEUED' } });
      const indexed = source.activeIndexGeneration == null ? false : Boolean(await tx.knowledgeChunk.findFirst({ where: { organizationId: source.organizationId, sourceId: source.id, sourceVersion: source.sourceVersion, generation: source.activeIndexGeneration }, select: { id: true } }));
      await tx.knowledgeSource.update({ where: { id_organizationId: { id: source.id, organizationId: source.organizationId } }, data: { processingStatus: indexed ? 'READY' : 'QUEUED', processingErrorCode: null, semanticIndexStatus: this.embeddings ? 'QUEUED' : 'NOT_CONFIGURED', semanticIndexErrorCode: semanticConfigurationError() ?? null } });
      return 'queued';
    }); } catch (error: any) {
      // The partial unique index is the final idempotency guard when concurrent schedulers race.
      if (error?.code !== 'P2002') throw error;
      return 'existing';
    }
  }

  private async claim(): Promise<any | null> {
    const rows = await this.db.$queryRaw`
      WITH advisory_lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(812790341)
      ),
      global_lock AS MATERIALIZED (
        SELECT TRUE AS acquired FROM advisory_lock
      ),
      candidate AS (
        SELECT j.id FROM "KnowledgeProcessingJob" j
        JOIN "Organization" o ON o.id=j."organizationId"
        CROSS JOIN global_lock
        WHERE j.status IN ('QUEUED', 'RETRY_WAIT') AND j."availableAt" <= now()
          AND (
            (j.kind='INDEX' AND EXISTS (
              SELECT 1 FROM "KnowledgeSource" s
              WHERE s.id=j."sourceId" AND s."organizationId"=j."organizationId"
                AND s.type IN ('FAQ','TEXT') AND s.status='REGISTERED'
            ))
            OR (j.kind='CRAWL' AND EXISTS (
              SELECT 1 FROM "KnowledgeSource" s
              WHERE s.id=j."sourceId" AND s."organizationId"=j."organizationId"
                AND s.type='WEBSITE' AND s.status='REGISTERED' AND s."syncPaused"=false
                AND (
                  NOT COALESCE(s.category='SHOPIFY_STOREFRONT' OR s.description LIKE 'Public storefront discovered from the connected Shopify shop.%', false)
                  OR (s."verificationStatus"='VERIFIED' AND s."verifiedAt" IS NOT NULL)
                )
            ))
          )
          AND NOT EXISTS (SELECT 1 FROM "KnowledgeProcessingJob" active WHERE active."organizationId"=j."organizationId" AND active.status='PROCESSING')
          AND (SELECT count(*) FROM "KnowledgeProcessingJob" global_active WHERE global_active.status='PROCESSING') < 2
      ORDER BY j."availableAt", j."createdAt" LIMIT 1 FOR UPDATE OF o, j SKIP LOCKED
      )
      UPDATE "KnowledgeProcessingJob" j SET status='PROCESSING', stage=CASE WHEN j.kind='CRAWL' THEN 'HTML_EXTRACTION' ELSE 'INDEXING' END, attempts=j.attempts+1,
        "leasedAt"=now(), "heartbeatAt"=now(), "leaseOwner"=${this.workerId}, "updatedAt"=now()
      FROM candidate WHERE j.id=candidate.id RETURNING j.*`;
    if (!rows[0]) return null;
    if (rows[0].kind === 'CRAWL') await this.db.knowledgeSyncRun.updateMany({ where: { organizationId: rows[0].organizationId, sourceId: rows[0].sourceId, jobId: rows[0].id, status: { in: ['QUEUED', 'RETRY_WAIT'] } }, data: { status: 'PROCESSING' } });
    const published = await this.db.knowledgeSource.findFirst({ where: { id: rows[0].sourceId, organizationId: rows[0].organizationId, sourceVersion: rows[0].sourceVersion, status: 'REGISTERED' }, select: { activeIndexGeneration: true } });
    const indexed = published?.activeIndexGeneration == null ? false : Boolean(await this.db.knowledgeChunk.findFirst({ where: { organizationId: rows[0].organizationId, sourceId: rows[0].sourceId, sourceVersion: rows[0].sourceVersion, generation: published.activeIndexGeneration }, select: { id: true } }));
    await this.db.knowledgeSource.updateMany({ where: { id: rows[0].sourceId, organizationId: rows[0].organizationId, sourceVersion: rows[0].sourceVersion, status: 'REGISTERED' }, data: { processingStatus: indexed ? 'READY' : 'PROCESSING', ...(this.embeddings ? { semanticIndexStatus: 'PROCESSING' } : {}) } });
    return rows[0];
  }

  private async process(job: any) {
    let failureOperation = 'job_source_lookup';
    let failureJobStage = typeof job.stage === 'string' ? job.stage : 'UNKNOWN';
    let failureOperationStartedAt = Date.now();
    const setFailureOperation = (operation: string, jobStage?: string) => {
      failureOperation = operation;
      if (jobStage) failureJobStage = jobStage;
      failureOperationStartedAt = Date.now();
    };
    const heartbeat = setInterval(() => {
      void this.db.knowledgeProcessingJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseOwner: this.workerId }, data: { heartbeatAt: new Date() } }).catch(() => undefined);
    }, 30_000);
    heartbeat.unref();
    try {
      const source = await this.db.knowledgeSource.findFirst({ where: { id: job.sourceId, organizationId: job.organizationId, sourceVersion: job.sourceVersion, status: 'REGISTERED' } });
      if (!source) {
        await this.db.$transaction(async (tx: any) => {
          await tx.knowledgeProcessingJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseOwner: this.workerId }, data: { status: 'CANCELLED', stage: 'CANCELLED', leaseOwner: null, leasedAt: null, heartbeatAt: null } });
          if (job.kind === 'CRAWL') await tx.knowledgeSyncRun.updateMany({ where: { organizationId: job.organizationId, sourceId: job.sourceId, jobId: job.id, status: 'PROCESSING' }, data: { status: 'CANCELLED', errorCode: 'WEBSITE_SOURCE_INACTIVE', finishedAt: new Date() } });
        });
        return;
      }
      if (job.kind === 'CRAWL' && source.type === 'WEBSITE') {
        await this.processWebsite(job, source, setFailureOperation);
        return;
      }
      if (source.type === 'WEBSITE' || job.kind === 'CRAWL') throw Object.assign(new Error('Crawl job does not match a website source.'), { code: 'SOURCE_TYPE_NOT_SUPPORTED', terminal: true });
      if (!isVerifiedPdfDocumentSource(source)) throw Object.assign(new Error('Only authenticated PDF documents can be indexed as static knowledge.'), { code: 'PDF_DOCUMENT_PROVENANCE_REQUIRED', terminal: true });
      const original = source.type === 'FAQ' ? `Question: ${source.name}\nAnswer: ${source.contentBody ?? ''}` : `${source.name}\n\n${source.contentBody ?? ''}`;
      let extracted: PdfExtraction | null = null;
      if (source.document) {
        if (source.document.extracted && source.contentBody && source.document.pages?.length) {
          extracted = { content: source.contentBody, pages: source.document.pages, warnings: source.document.warnings ?? [], characterCount: source.document.characterCount ?? source.contentBody.length, wordCount: source.document.wordCount ?? (source.contentBody.match(/[\p{L}\p{N}]+/gu) ?? []).length };
        } else {
          if (!this.documentStorage?.isConfigured() || !source.document.storageKey) throw Object.assign(new Error('PDF storage unavailable'), { code: 'PRIVATE_STORAGE_UNAVAILABLE', terminal: true });
          setFailureOperation('pdf_extraction', 'EXTRACTING');
          await this.db.knowledgeProcessingJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseOwner: this.workerId }, data: { stage: 'EXTRACTING' } });
          const bytes = await this.documentStorage.read(source.organizationId, source.document.storageKey);
          if (createHash('sha256').update(bytes).digest('hex') !== source.document.hash) throw Object.assign(new Error('Document identity mismatch'), { code: 'PDF_IDENTITY_MISMATCH', terminal: true });
          extracted = await extractPdf(bytes);
          await this.db.$transaction(async (tx: any) => {
            await this.requireLease(tx, job);
            const saved = await tx.knowledgeSource.updateMany({ where: { id: source.id, organizationId: source.organizationId, sourceVersion: job.sourceVersion, status: 'REGISTERED' },
              data: { contentBody: extracted!.content, document: { ...source.document, pages: extracted!.pages, warnings: extracted!.warnings, extracted: true } } });
            if (!saved.count) throw Object.assign(new Error('Source changed'), { code: 'STALE_SOURCE_VERSION', terminal: true });
          });
        }
        if (source.document.storageKey) {
          if (!this.documentStorage?.isConfigured()) throw Object.assign(new Error('Temporary PDF cleanup is unavailable.'), { code: 'PRIVATE_STORAGE_UNAVAILABLE', retryable: true });
          setFailureOperation('original_pdf_discard', 'SAVING');
          try { await this.documentStorage.delete(source.document.storageKey); }
          catch { throw Object.assign(new Error('The extracted text is saved, but original PDF cleanup failed.'), { code: 'PDF_CLEANUP_FAILED', retryable: true }); }
          const { storageKey: _storageKey, retiredStorageKeys: _retiredStorageKeys, ...durableDocument } = source.document;
          await this.db.$transaction(async (tx: any) => {
            await this.requireLease(tx, job);
            await tx.knowledgeSource.updateMany({ where: { id: source.id, organizationId: source.organizationId, sourceVersion: job.sourceVersion, status: 'REGISTERED' }, data: { document: durableDocument } });
          });
        }
        await this.db.knowledgeProcessingJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseOwner: this.workerId }, data: { stage: 'INDEXING' } });
      }
      const locatedParts = extracted ? pdfChunks(extracted, source.name) : null;
      const parts = locatedParts ? locatedParts.map(part => part.content) : deduplicateKnowledgeChunks(chunkKnowledgeText(original));
      if (!parts.length) throw Object.assign(new Error('Source has no indexable text'), { code: 'EMPTY_SOURCE', terminal: true });
      let vectors: number[][] | null = null;
      let semanticErrorCode: string | null = null;
      if (this.embeddings) {
        try {
          vectors = [];
          for (let index = 0; index < parts.length; index += 32) vectors.push(...await this.embeddings.embed(parts.slice(index, index + 32)));
          if (vectors.length !== parts.length || vectors.some((vector) => vector.length !== this.embeddings!.dimensions || vector.some((value) => !Number.isFinite(value)))) throw Object.assign(new Error('Embedding dimension mismatch'), { code: 'EMBEDDING_DIMENSION_MISMATCH' });
        } catch (error: any) {
          semanticErrorCode = String(error?.response?.code ?? error?.code ?? 'EMBEDDING_PROVIDER_FAILED').slice(0, 100);
          vectors = null;
        }
      }
      const generation = (source.activeIndexGeneration ?? 0) + 1;
      if (vectors && vectors.some((vector) => vector.length !== 1536)) throw Object.assign(new Error('Embedding dimension does not match the supported OpenAI profile'), { code: 'EMBEDDING_DIMENSION_MISMATCH', terminal: true });
      failureOperation = 'knowledge_index_publication_transaction';
      await this.db.$transaction(async (tx: any) => {
        failureOperation = 'knowledge_index_lease_check';
        await this.requireLease(tx, job);
        failureOperation = 'knowledge_index_source_revalidation';
        const stillCurrent = await tx.knowledgeSource.findFirst({ where: { id: source.id, organizationId: source.organizationId, sourceVersion: job.sourceVersion, status: 'REGISTERED' }, select: { id: true } });
        if (!stillCurrent) throw Object.assign(new Error('Source changed during processing'), { code: 'STALE_SOURCE_VERSION', terminal: true });
        for (const [i, part] of parts.entries()) {
          const vectorText = vectors ? `[${vectors[i]!.join(',')}]` : null;
          const provider = vectors ? this.embeddings!.provider : 'postgres';
          const model = vectors ? this.embeddings!.model : 'fts-simple';
          const dimensions = vectors ? this.embeddings!.dimensions : 0;
          failureOperation = 'knowledge_chunk_insert';
          await tx.$executeRaw`INSERT INTO "KnowledgeChunk" ("id","organizationId","sourceId","sourceVersion","generation","sequence","content","contentHash","locator","embeddingProvider","embeddingModel","embeddingDimensions","embedding","indexedAt") VALUES (${stableKnowledgeChunkId({ sourceId: source.id, sourceVersion: job.sourceVersion, generation, sequence: i, contentHash: contentHash(part) })}::uuid,${source.organizationId}::uuid,${source.id}::uuid,${job.sourceVersion},${generation},${i},${part},${contentHash(part)},${locatedParts?.[i]?.locator ?? source.name},${provider},${model},${dimensions},${vectorText}::vector,now())`;
        }
        failureOperation = 'knowledge_source_publish';
        await tx.knowledgeSource.update({ where: { id_organizationId: { id: source.id, organizationId: source.organizationId } }, data: { activeIndexGeneration: generation, processingStatus: 'READY', processingErrorCode: null, semanticIndexStatus: vectors ? 'READY' : this.embeddings ? 'FAILED' : 'NOT_CONFIGURED', semanticIndexErrorCode: semanticErrorCode ?? semanticConfigurationError() ?? null } });
        failureOperation = 'knowledge_job_complete';
        await this.completeLease(tx, job);
        failureOperation = 'knowledge_old_chunk_cleanup';
        await tx.knowledgeChunk.deleteMany({ where: { sourceId: source.id, generation: { not: generation } } });
        failureOperation = 'knowledge_index_publication_commit';
      });
      this.logger.log(JSON.stringify({
        event: 'knowledge_processing_job_completed',
        jobFingerprint: safeJobFingerprint(job.id),
        kind: job.kind,
        generation,
        chunksSaved: parts.length,
      }));
    } catch (error: any) {
      const retryable = ['EMBEDDING_PROVIDER_RETRYABLE', 'EMBEDDING_PROVIDER_UNAVAILABLE'].includes(error?.response?.code) || error?.code === 'EMBEDDING_PROVIDER_UNAVAILABLE' || Boolean(error?.retryable);
      const terminal = Boolean(error?.terminal) || ['EMBEDDING_PROVIDER_AUTH_FAILED', 'EMBEDDING_PROVIDER_FORBIDDEN', 'EMBEDDING_PROVIDER_MODEL_OR_ENDPOINT_NOT_FOUND', 'EMBEDDING_PROVIDER_NOT_CONFIGURED', 'EMBEDDING_PROVIDER_PAYMENT_REQUIRED', 'EMBEDDING_PROVIDER_REQUEST_FAILED', 'EMBEDDING_PROVIDER_INVALID_RESPONSE'].includes(error?.response?.code);
      const canRetry = retryable && Number(job.attempts) < 5;
      const delay = Math.min(3600, 15 * (2 ** Math.max(0, Number(job.attempts) - 1)));
      // Record the original processing failure before attempting to persist its
      // status. Otherwise a second database error in this recovery transaction
      // can hide the error and operation that caused the job to fail.
      this.logger.warn(JSON.stringify({ event: 'knowledge_processing_job_failed', stage: 'index_processing', operation: failureOperation, jobFingerprint: safeJobFingerprint(job.id), jobStage: failureJobStage, elapsedMs: Math.max(0, Date.now() - failureOperationStartedAt), code: safeProcessingErrorCode(error), retryable: canRetry, retryability: canRetry ? 'RETRYABLE' : 'TERMINAL_OR_EXHAUSTED', failureStatePersistence: 'PENDING', ...safeWorkerDatabaseDiagnostic(error) }));
      await this.db.$transaction(async (tx: any) => {
        const status = canRetry ? 'RETRY_WAIT' : 'FAILED';
        const safeCode = safeProcessingErrorCode(error);
        const code = safeCode === 'PROCESSING_FAILED' && terminal ? 'PROCESSING_REJECTED' : safeCode;
        const result = await tx.knowledgeProcessingJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseOwner: this.workerId }, data: { status, availableAt: new Date(Date.now() + delay * 1000), leaseOwner: null, leasedAt: null, heartbeatAt: null, errorCode: code } });
        if (!result.count) {
          if (job.kind === 'CRAWL') await tx.knowledgeSyncRun.updateMany({ where: { organizationId: job.organizationId, sourceId: job.sourceId, jobId: job.id, status: 'PROCESSING' }, data: { status: 'CANCELLED', errorCode: 'CRAWL_JOB_CANCELLED', finishedAt: new Date() } });
          return;
        }
        const source = await tx.knowledgeSource.findFirst({ where: { id: job.sourceId, organizationId: job.organizationId, sourceVersion: job.sourceVersion, status: 'REGISTERED' }, select: { activeIndexGeneration: true } });
        const indexed = source?.activeIndexGeneration == null ? false : Boolean(await tx.knowledgeChunk.findFirst({ where: { organizationId: job.organizationId, sourceId: job.sourceId, sourceVersion: job.sourceVersion, generation: source.activeIndexGeneration }, select: { id: true } }));
        if (source) await tx.knowledgeSource.updateMany({ where: { id: job.sourceId, organizationId: job.organizationId, sourceVersion: job.sourceVersion }, data: { processingStatus: indexed ? 'READY' : 'FAILED', processingErrorCode: code, ...(job.kind === 'CRAWL' ? { lastSyncErrorCode: code } : {}) } });
        if (job.kind === 'CRAWL') await tx.knowledgeSyncRun.updateMany({ where: { organizationId: job.organizationId, sourceId: job.sourceId, jobId: job.id, status: 'PROCESSING' }, data: { status: canRetry ? 'RETRY_WAIT' : 'FAILED', errorCode: code, failedPages: Number(error?.failedPages ?? 1), ...(canRetry ? {} : { finishedAt: new Date() }) } });
      });
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async processWebsite(job: any, source: any, setFailureOperation: (operation: string, jobStage?: string) => void = () => undefined) {
    const crawlStartedAt = Date.now();
    const assertAuthorized = async () => {
      setFailureOperation('website_permission_revalidation');
      const current: WebsiteVerificationGate | null = await this.db.knowledgeSource.findFirst({ where: { id: source.id, organizationId: source.organizationId, sourceVersion: job.sourceVersion, type: 'WEBSITE', status: 'REGISTERED', syncPaused: false }, select: { category: true, description: true, verificationStatus: true, verifiedAt: true } });
      if (!current) throw Object.assign(new Error('Website authorization changed during crawl.'), { code: 'WEBSITE_CRAWL_NOT_AUTHORIZED', terminal: true });
      if (requiresVerifiedWebsiteDomain(current) && !websiteDomainIsVerified(current)) throw Object.assign(new Error('Shopify storefront domain verification is required for this crawl.'), { code: 'SHOPIFY_STOREFRONT_DOMAIN_NOT_VERIFIED', terminal: true });
      setFailureOperation('website_lease_revalidation');
      const lease = await this.db.knowledgeProcessingJob.findFirst({ where: { id: job.id, status: 'PROCESSING', leaseOwner: this.workerId }, select: { id: true } });
      if (!lease) throw Object.assign(new Error('Crawl lease is no longer owned by this worker.'), { code: 'WORKER_LEASE_LOST', terminal: true });
    };
    await assertAuthorized();
    this.logger.log(JSON.stringify({ event: 'website_crawl_started', jobFingerprint: safeJobFingerprint(job.id) }));
    setFailureOperation('website_previous_page_snapshot_read');
    const previousRows: WebsitePageSnapshot[] = source.activeIndexGeneration == null ? [] : await this.db.knowledgePage.findMany({ where: { organizationId: source.organizationId, sourceId: source.id, sourceVersion: job.sourceVersion, generation: source.activeIndexGeneration, status: 'READY' }, select: { id: true, canonicalUrl: true, title: true, content: true, contentHash: true, extractionMethod: true, pageCategory: true, languageHint: true, fetchedAt: true, etag: true, lastModified: true } });
    const validators = Object.fromEntries(previousRows.map((page) => [page.canonicalUrl, { etag: page.etag, lastModified: page.lastModified }]));
    const siteOrigin = new URL(source.sourceUrl).origin;
    setFailureOperation('website_shopify_seed_lookup');
    const shopify = await this.db.connectorInstance.findFirst({ where: { organizationId: source.organizationId, connectorId: 'shopify_v1', state: 'CONNECTED', commerceConnection: { is: { organizationId: source.organizationId, state: 'CONNECTED', siteUrl: siteOrigin } } }, select: { id: true, verifiedCapabilities: true, commerceConnection: { select: { grantedScopes: true, grantedScopesVerifiedAt: true } } } });
    let seedUrls: string[] = [];
    if (shopify && isShopifyScopeSnapshotFresh(shopify.commerceConnection?.grantedScopesVerifiedAt) && shopifyContentCategoryAllowed('SHOPIFY_ONLINE_STORE_PAGES', shopify.commerceConnection?.grantedScopes ?? [], Array.isArray(shopify.verifiedCapabilities) ? shopify.verifiedCapabilities : [])) {
      setFailureOperation('website_shopify_content_permission_lookup');
      const permission = await this.db.connectorDataPermission.findFirst({ where: { organizationId: source.organizationId, connectorInstanceId: shopify.id, category: 'SHOPIFY_ONLINE_STORE_PAGES', enabled: true, syncEnabled: true }, select: { id: true } });
      if (permission) {
        setFailureOperation('website_shopify_seed_pages_read');
        const syncedPages = await this.db.knowledgeSource.findMany({ where: { organizationId: source.organizationId, connectorInstanceId: shopify.id, connectorDataCategory: 'SHOPIFY_ONLINE_STORE_PAGES', status: 'REGISTERED', sourceUrl: { not: null } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 200, select: { sourceUrl: true } });
        seedUrls = syncedPages.flatMap((page: { sourceUrl: string | null }) => typeof page.sourceUrl === 'string' ? [page.sourceUrl] : []);
      }
    }
    setFailureOperation('crawl.static_fetch', 'HTML_EXTRACTION');
    const crawl = await this.crawler.crawl({ startUrl: source.sourceUrl, seedUrls, validators, excludeShopifyCatalog: Boolean(shopify), maxPages: source.crawlMaxPages, maxDepth: source.crawlMaxDepth, pathPrefix: source.crawlPathPrefix || '/', sourceAuthorized: true, assertAuthorized,
      onOperation: (operation) => setFailureOperation(operation),
      onStage: async (stage) => {
        setFailureOperation('crawl.stage_progress_update', stage);
        const updated = await this.db.knowledgeProcessingJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseOwner: this.workerId }, data: { stage, heartbeatAt: new Date() } });
        if (!updated.count) throw Object.assign(new Error('Processing lease is no longer owned by this worker.'), { code: 'WORKER_LEASE_LOST', terminal: true });
        this.logger.log(JSON.stringify({ event: 'website_crawl_stage_changed', jobFingerprint: safeJobFingerprint(job.id), stage, elapsedMs: Date.now() - crawlStartedAt }));
      },
    });
    this.logger.log(JSON.stringify({
      event: 'website_crawl_extracted',
      jobFingerprint: safeJobFingerprint(job.id),
      discoveredUrlCount: crawl.discovered,
      extractedPageCount: crawl.pages.length,
      notModifiedPageCount: crawl.notModifiedUrls.length,
      failedPageCount: crawl.failed,
      totalBytes: crawl.totalBytes,
      complete: crawl.complete,
      elapsedMs: Date.now() - crawlStartedAt,
    }));
    await assertAuthorized();
    if (!crawl.pages.length && crawl.notModifiedUrls.length > 0 && crawl.complete && crawl.removedUrls.length === 0) {
      await this.db.$transaction(async (tx: any) => {
        await this.requireLease(tx, job);
        const authorized: WebsiteVerificationGate | null = await tx.knowledgeSource.findFirst({ where: { id: source.id, organizationId: source.organizationId, sourceVersion: job.sourceVersion, type: 'WEBSITE', status: 'REGISTERED', syncPaused: false }, select: { category: true, description: true, verificationStatus: true, verifiedAt: true } });
        if (!authorized) throw Object.assign(new Error('Website authorization changed before publication.'), { code: 'WEBSITE_CRAWL_NOT_AUTHORIZED', terminal: true });
        if (requiresVerifiedWebsiteDomain(authorized) && !websiteDomainIsVerified(authorized)) throw Object.assign(new Error('Shopify storefront domain verification is required before publication.'), { code: 'SHOPIFY_STOREFRONT_DOMAIN_NOT_VERIFIED', terminal: true });
        const now = new Date();
        const nextSyncAt = source.syncPolicy === 'DAILY' ? new Date(now.getTime() + 86_400_000) : source.syncPolicy === 'WEEKLY' ? new Date(now.getTime() + 604_800_000) : null;
        await tx.knowledgeSource.update({ where: { id_organizationId: { id: source.id, organizationId: source.organizationId } }, data: { lastSyncAt: now, lastSuccessfulSyncAt: now, lastSyncErrorCode: null, nextSyncAt } });
        await tx.knowledgeSyncRun.updateMany({ where: { organizationId: source.organizationId, sourceId: source.id, jobId: job.id, status: 'PROCESSING' }, data: { status: 'SUCCEEDED', discoveredPages: crawl.discovered, unchangedPages: crawl.notModifiedUrls.length, finishedAt: now } });
        const activeChunks = source.processingStatus === 'READY' && source.activeIndexGeneration !== null
          ? await tx.knowledgeChunk.count({ where: { organizationId: source.organizationId, sourceId: source.id, sourceVersion: source.sourceVersion, generation: source.activeIndexGeneration } })
          : 0;
        if (activeChunks > 0) {
          const autoLinkBases = await tx.knowledgeBase.findMany({ where: { organizationId: source.organizationId, status: 'ACTIVE', archivedAt: null, autoAddEligibleSources: true }, select: { id: true } });
          if (autoLinkBases.length) await tx.knowledgeBaseSource.createMany({ data: autoLinkBases.map((base: { id: string }) => ({ organizationId: source.organizationId, knowledgeBaseId: base.id, sourceId: source.id })), skipDuplicates: true });
        }
        await this.completeLease(tx, job);
      });
      this.logger.log(JSON.stringify({ event: 'website_index_publication_completed', jobFingerprint: safeJobFingerprint(job.id), pagesSaved: 0, chunksSaved: 0, unchangedPages: crawl.notModifiedUrls.length, indexGeneration: source.activeIndexGeneration ?? null, elapsedMs: Date.now() - crawlStartedAt }));
      this.logger.log(JSON.stringify({ event: 'knowledge_processing_job_completed', jobFingerprint: safeJobFingerprint(job.id), kind: job.kind, elapsedMs: Date.now() - crawlStartedAt }));
      return;
    }
    // A bounded or partially failed crawl may still return explicit 404s, but those
    // observations do not prove that the source-wide snapshot was complete.
    const completeRemovedUrls = authoritativeRemovedUrls(crawl);
    if (!crawl.pages.length) {
      const code = crawl.errorCode ?? (crawl.retryableFailures ? 'WEBSITE_CRAWL_FAILED' : crawl.skippedRobots ? 'ROBOTS_DISALLOWS_CRAWLING' : 'WEBSITE_NO_INDEXABLE_CONTENT');
      throw Object.assign(new Error('The website crawl produced no indexable public pages.'), { code, retryable: crawl.retryableFailures > 0, terminal: crawl.retryableFailures === 0, failedPages: Math.max(1, crawl.failed) });
    }
    const previous = previousRows.map((page) => ({
      url: page.canonicalUrl,
      title: page.title,
      content: page.content,
      contentHash: page.contentHash,
      extractionMethod: page.extractionMethod ?? undefined,
      pageCategory: page.pageCategory ?? undefined,
      language: page.languageHint,
      fetchedAt: page.fetchedAt,
    }));
    const sync = prepareWebsiteSyncPages(crawl.pages, previous, completeRemovedUrls);
    const seenChunkHashes = new Set<string>();
    const indexed: IndexedWebsitePage[] = sync.pages.map((page) => ({ page, parts: chunkKnowledgeText(`${page.title}\n\n${page.content}`).filter((part) => {
      const hash = contentHash(part);
      if (seenChunkHashes.has(hash)) return false;
      seenChunkHashes.add(hash);
      return true;
    }) })).filter((item) => item.parts.length > 0);
    if (!indexed.length) throw Object.assign(new Error('The website has no useful public content.'), { code: 'WEBSITE_NO_INDEXABLE_CONTENT', terminal: true, failedPages: crawl.failed });
    const chunksPrepared = indexed.reduce((count, item) => count + item.parts.length, 0);
    this.logger.log(JSON.stringify({ event: 'website_chunks_prepared', jobFingerprint: safeJobFingerprint(job.id), pageCount: indexed.length, chunkCount: chunksPrepared, elapsedMs: Date.now() - crawlStartedAt }));
    const priorByUrl = new Map(previousRows.map((page) => [page.canonicalUrl, page] as const));
    const unchanged = indexed.filter((item) => {
      const prior = priorByUrl.get(item.page.url);
      return prior && prior.contentHash === item.page.contentHash && prior.title === item.page.title
        && (prior.extractionMethod ?? 'HTML') === (item.page.extractionMethod ?? 'HTML')
        && prior.pageCategory === (item.page.pageCategory ?? 'GENERAL') && prior.languageHint === (item.page.language ?? null);
    });
    const priorPageIds = unchanged.flatMap((item) => {
      const prior = priorByUrl.get(item.page.url);
      return prior ? [prior.id] : [];
    });
    let oldChunks: StoredWebsiteChunk[] = [];
    if (priorPageIds.length && source.activeIndexGeneration != null) {
      setFailureOperation('website_previous_chunk_read');
      oldChunks = await this.db.$queryRaw<StoredWebsiteChunk[]>`SELECT "pageId", content, "contentHash", locator, "embeddingProvider", "embeddingModel", "embeddingDimensions", "embedding"::text AS embedding FROM "KnowledgeChunk" WHERE "organizationId"=${source.organizationId}::uuid AND "sourceId"=${source.id}::uuid AND "sourceVersion"=${job.sourceVersion} AND generation=${source.activeIndexGeneration} AND "pageId"=ANY(${priorPageIds}::uuid[]) ORDER BY "pageId", sequence`;
    }
    const oldChunksByPage = new Map<string, typeof oldChunks>();
    for (const chunk of oldChunks) oldChunksByPage.set(chunk.pageId, [...(oldChunksByPage.get(chunk.pageId) ?? []), chunk]);
    const isReusable = (item: IndexedWebsitePage) => {
      const pageId = priorByUrl.get(item.page.url)?.id;
      if (!pageId || !unchanged.includes(item)) return false;
      const chunks = oldChunksByPage.get(pageId) ?? [];
      return canReuseIndexedChunks(item.parts, chunks, this.embeddings ? { provider: this.embeddings.provider, model: this.embeddings.model, dimensions: this.embeddings.dimensions } : undefined);
    };
    const reusablePages = new Set(indexed.filter(isReusable));
    const allParts = indexed.filter((item) => !reusablePages.has(item)).flatMap((item) => item.parts);
    let vectors: number[][] | null = null;
    let semanticErrorCode: string | null = null;
    const embeddingProvider = this.embeddings;
    if (embeddingProvider) {
      try {
        vectors = [];
        setFailureOperation('website_embedding_generation');
        for (let index = 0; index < allParts.length; index += 32) vectors.push(...await embeddingProvider.embed(allParts.slice(index, index + 32)));
        if (vectors.length !== allParts.length || vectors.some((vector) => vector.length !== embeddingProvider.dimensions || vector.some((value) => !Number.isFinite(value)))) throw Object.assign(new Error('Embedding dimension mismatch'), { code: 'EMBEDDING_DIMENSION_MISMATCH' });
      } catch (error: unknown) {
        const record = errorRecord(error);
        const response = errorRecord(record?.response);
        const code = response?.code ?? record?.code;
        semanticErrorCode = (typeof code === 'string' ? code : 'EMBEDDING_PROVIDER_FAILED').slice(0, 100);
        vectors = null;
      }
    }
    if (vectors && vectors.some((vector) => vector.length !== 1536)) throw Object.assign(new Error('Embedding dimension does not match the supported OpenAI profile'), { code: 'EMBEDDING_DIMENSION_MISMATCH', terminal: true });
    const generation = (source.activeIndexGeneration ?? 0) + 1;
    setFailureOperation('crawl.transaction_commit');
    await this.db.$transaction(async (tx: any) => {
      setFailureOperation('website_index_lease_check');
      await this.requireLease(tx, job);
      setFailureOperation('website_publication_permission_revalidation');
        const authorized: WebsiteVerificationGate | null = await tx.knowledgeSource.findFirst({ where: { id: source.id, organizationId: source.organizationId, sourceVersion: job.sourceVersion, type: 'WEBSITE', status: 'REGISTERED', syncPaused: false }, select: { category: true, description: true, verificationStatus: true, verifiedAt: true } });
      if (!authorized) throw Object.assign(new Error('Website authorization changed before publication.'), { code: 'WEBSITE_CRAWL_NOT_AUTHORIZED', terminal: true });
        if (requiresVerifiedWebsiteDomain(authorized) && !websiteDomainIsVerified(authorized)) throw Object.assign(new Error('Shopify storefront domain verification is required before publication.'), { code: 'SHOPIFY_STOREFRONT_DOMAIN_NOT_VERIFIED', terminal: true });
      let sequence = 0;
      let embeddingSequence = 0;
      for (const item of indexed) {
        const page = item.page;
        const data = { title: page.title.slice(0, 500), pageCategory: page.pageCategory ?? 'GENERAL', languageHint: page.language ?? null, content: page.content, contentHash: page.contentHash, extractionMethod: page.extractionMethod ?? 'HTML', fetchedAt: page.fetchedAt ?? new Date(), etag: page.etag ?? null, lastModified: page.lastModified ?? null, indexedAt: new Date(), generation, status: 'READY' };
        setFailureOperation('crawl.page_persistence');
        const stored = await tx.knowledgePage.upsert({
          where: { sourceId_canonicalUrl_sourceVersion: { sourceId: source.id, canonicalUrl: page.url, sourceVersion: job.sourceVersion } },
          create: { ...data, organizationId: source.organizationId, sourceId: source.id, canonicalUrl: page.url, sourceVersion: job.sourceVersion },
          update: data,
          select: { id: true },
        });
        const reuse = reusablePages.has(item);
        const priorPage = priorByUrl.get(page.url);
        const priorChunksForPage = reuse && priorPage ? oldChunksByPage.get(priorPage.id) ?? [] : [];
        for (let partIndex = 0; partIndex < item.parts.length; partIndex++) {
          const part = item.parts[partIndex];
          if (part === undefined) throw new Error('WEBSITE_CHUNK_SEQUENCE_INVALID');
          const priorChunk = reuse ? priorChunksForPage[partIndex] : null;
          const vector = priorChunk ? null : vectors?.[embeddingSequence] ?? null;
          if (!priorChunk) embeddingSequence++;
          const vectorText = priorChunk?.embedding ?? (vector ? `[${vector.join(',')}]` : null);
          const provider = priorChunk?.embeddingProvider ?? (vector && embeddingProvider ? embeddingProvider.provider : 'postgres');
          const model = priorChunk?.embeddingModel ?? (vector && embeddingProvider ? embeddingProvider.model : 'fts-simple');
          const dimensions = priorChunk?.embeddingDimensions ?? (vector && embeddingProvider ? embeddingProvider.dimensions : 0);
          setFailureOperation('crawl.chunk_persistence');
          await tx.$executeRaw`INSERT INTO "KnowledgeChunk" ("id","organizationId","sourceId","pageId","sourceVersion","generation","sequence","content","contentHash","locator","embeddingProvider","embeddingModel","embeddingDimensions","embedding","indexedAt") VALUES (${stableKnowledgeChunkId({ sourceId: source.id, sourceVersion: job.sourceVersion, generation, sequence, contentHash: contentHash(part) })}::uuid,${source.organizationId}::uuid,${source.id}::uuid,${stored.id}::uuid,${job.sourceVersion},${generation},${sequence},${part},${contentHash(part)},${page.url},${provider},${model},${dimensions},${vectorText}::vector,now())`;
          sequence++;
        }
      }
      if (completeRemovedUrls.length) await tx.knowledgePage.updateMany({ where: { organizationId: source.organizationId, sourceId: source.id, sourceVersion: job.sourceVersion, canonicalUrl: { in: completeRemovedUrls } }, data: { status: 'REMOVED', generation, indexedAt: null } });
      const now = new Date();
      const nextSyncAt = source.syncPolicy === 'DAILY' ? new Date(now.getTime() + 86_400_000) : source.syncPolicy === 'WEEKLY' ? new Date(now.getTime() + 604_800_000) : null;
      setFailureOperation('crawl.index_publication');
      await tx.knowledgeSource.update({ where: { id_organizationId: { id: source.id, organizationId: source.organizationId } }, data: { activeIndexGeneration: generation, processingStatus: 'READY', processingErrorCode: null, semanticIndexStatus: vectors ? 'READY' : this.embeddings ? 'FAILED' : 'NOT_CONFIGURED', semanticIndexErrorCode: semanticErrorCode ?? semanticConfigurationError() ?? null, lastSyncAt: now, ...(crawl.complete ? { lastSuccessfulSyncAt: now } : {}), lastSyncErrorCode: crawl.complete ? null : (crawl.errorCode ?? 'CRAWL_SNAPSHOT_INCOMPLETE'), nextSyncAt } });
      setFailureOperation('website_sync_run_publish');
      await tx.knowledgeSyncRun.updateMany({ where: { organizationId: source.organizationId, sourceId: source.id, jobId: job.id, status: 'PROCESSING' }, data: { status: crawl.complete && !crawl.failed && !crawl.skippedRobots && !crawl.unsupportedPages ? 'SUCCEEDED' : 'SUCCEEDED_WITH_WARNINGS', discoveredPages: crawl.discovered, changedPages: sync.changedPages, unchangedPages: sync.unchangedPages, removedPages: sync.removedPages, failedPages: crawl.failed, skippedPages: crawl.skippedRobots, unsupportedPages: crawl.unsupportedPages, retryableFailures: crawl.retryableFailures, errorCode: crawl.errorCode ?? (crawl.complete ? null : 'CRAWL_SNAPSHOT_INCOMPLETE'), finishedAt: now } });
      if (sequence > 0 && crawl.complete && !crawl.failed && !crawl.skippedRobots && !crawl.unsupportedPages) {
        const autoLinkBases = await tx.knowledgeBase.findMany({ where: { organizationId: source.organizationId, status: 'ACTIVE', archivedAt: null, autoAddEligibleSources: true }, select: { id: true } });
        if (autoLinkBases.length) await tx.knowledgeBaseSource.createMany({ data: autoLinkBases.map((base: { id: string }) => ({ organizationId: source.organizationId, knowledgeBaseId: base.id, sourceId: source.id })), skipDuplicates: true });
      }
      setFailureOperation('website_job_complete');
      await this.completeLease(tx, job);
      setFailureOperation('website_old_chunk_cleanup');
      await tx.knowledgeChunk.deleteMany({ where: { organizationId: source.organizationId, sourceId: source.id, generation: { not: generation } } });
      setFailureOperation('crawl.transaction_commit');
    }, { timeout: 30_000, maxWait: 5_000 });
    const publicationCompletedAt = Date.now();
    this.logger.log(JSON.stringify({ event: 'website_index_publication_completed', jobFingerprint: safeJobFingerprint(job.id), pagesSaved: indexed.length, chunksSaved: chunksPrepared, indexGeneration: generation, durationMs: publicationCompletedAt - crawlStartedAt }));
    this.logger.log(JSON.stringify({ event: 'knowledge_processing_job_completed', jobFingerprint: safeJobFingerprint(job.id), kind: job.kind, elapsedMs: publicationCompletedAt - crawlStartedAt }));
  }

  private async requireLease(tx: any, job: any) {
    const row = await tx.knowledgeProcessingJob.findFirst({ where: { id: job.id, status: 'PROCESSING', leaseOwner: this.workerId }, select: { id: true } });
    if (!row) throw Object.assign(new Error('Processing lease is no longer owned by this worker.'), { code: 'WORKER_LEASE_LOST', terminal: true });
  }
  private async completeLease(tx: any, job: any) {
    const result = await tx.knowledgeProcessingJob.updateMany({ where: { id: job.id, status: 'PROCESSING', leaseOwner: this.workerId }, data: { status: 'SUCCEEDED', stage: 'INDEX_PUBLISHED', leaseOwner: null, leasedAt: null, heartbeatAt: null, errorCode: null } });
    if (!result.count) throw Object.assign(new Error('Processing lease is no longer owned by this worker.'), { code: 'WORKER_LEASE_LOST', terminal: true });
  }
  private async requeueExpiredLeases() {
    const cutoff = new Date(Date.now() - 120_000);
    const expiredCrawls = await this.db.knowledgeProcessingJob.findMany({ where: { kind: 'CRAWL', status: 'PROCESSING', heartbeatAt: { lt: cutoff }, attempts: { lt: 5 } }, select: { id: true, organizationId: true, sourceId: true } });
    await this.db.knowledgeProcessingJob.updateMany({ where: { kind: { in: ['INDEX', 'CRAWL'] }, status: 'PROCESSING', heartbeatAt: { lt: cutoff }, attempts: { lt: 5 } }, data: { status: 'RETRY_WAIT', availableAt: new Date(), leaseOwner: null, leasedAt: null, heartbeatAt: null, errorCode: 'WORKER_LEASE_EXPIRED' } });
    if (expiredCrawls.length) await this.db.knowledgeSyncRun.updateMany({ where: { jobId: { in: expiredCrawls.map((job: any) => job.id) }, organizationId: { in: [...new Set(expiredCrawls.map((job: any) => job.organizationId))] }, status: 'PROCESSING' }, data: { status: 'RETRY_WAIT', errorCode: 'WORKER_LEASE_EXPIRED' } });
    const exhausted = await this.db.knowledgeProcessingJob.findMany({ where: { kind: { in: ['INDEX', 'CRAWL'] }, status: 'PROCESSING', heartbeatAt: { lt: cutoff }, attempts: { gte: 5 } }, select: { id: true, organizationId: true, sourceId: true, sourceVersion: true, kind: true } });
    for (const job of exhausted) {
      await this.db.$transaction(async (tx: any) => {
        await tx.knowledgeProcessingJob.updateMany({ where: { id: job.id, status: 'PROCESSING' }, data: { status: 'FAILED', leaseOwner: null, leasedAt: null, heartbeatAt: null, errorCode: 'WORKER_RETRIES_EXHAUSTED' } });
        await tx.knowledgeSource.updateMany({ where: { id: job.sourceId, organizationId: job.organizationId, sourceVersion: job.sourceVersion, status: 'REGISTERED', processingStatus: 'PROCESSING' }, data: { processingStatus: 'FAILED', processingErrorCode: 'WORKER_RETRIES_EXHAUSTED' } });
        if (job.kind === 'CRAWL') await tx.knowledgeSyncRun.updateMany({ where: { organizationId: job.organizationId, sourceId: job.sourceId, jobId: job.id, status: { in: ['PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'FAILED', errorCode: 'WORKER_RETRIES_EXHAUSTED', finishedAt: new Date() } });
      });
    }
  }
  private sourceNotFound() { return new NotFoundException({ code: 'KNOWLEDGE_SOURCE_NOT_FOUND', message: 'Knowledge source not found in this workspace.' }); }

}
