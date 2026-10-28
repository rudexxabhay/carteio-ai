import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { lookup, resolveTxt } from 'node:dns/promises';
import { isIP } from 'node:net';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkspaceService } from './workspace.service';
import { normalizePublicWebsiteUrl } from './knowledge.service';
import { isPublicAddress } from './website-crawler';
import { rendererAvailability } from './website-renderer';

const managers = ['OWNER', 'ADMIN'] as const;
const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

@Injectable()
export class WebsiteVerificationService {
  private readonly db: any;
  constructor(prisma: PrismaService, private readonly workspaces: WorkspaceService) { this.db = prisma as any; }

  async challenge(userId: string, slug: string, sourceId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const source = await this.website(member.organizationId, sourceId);
    const { hostname } = normalizePublicWebsiteUrl(source.sourceUrl);
    if (isIP(hostname)) throw new BadRequestException({ code: 'WEBSITE_DOMAIN_REQUIRED', message: 'DNS ownership verification requires a domain name; IP-address websites cannot be verified with this method.' });
    await this.assertPublicHost(hostname);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await this.db.$transaction(async (tx: any) => {
      await tx.knowledgeSource.update({ where: { id_organizationId: { id: sourceId, organizationId: member.organizationId } }, data: { verificationStatus: 'PENDING', verificationTokenHash: digest(token), verificationExpiresAt: expiresAt, verifiedAt: null } });
      await tx.auditEvent.create({ data: { organizationId: member.organizationId, actorUserId: userId, action: 'knowledge.website_verification_challenged', entityType: 'knowledge_source', entityId: sourceId, metadata: { method: 'DNS_TXT' } } });
    });
    return { sourceId, method: 'DNS_TXT', hostname, recordName: `_carteio-verify.${hostname}`, recordValue: `carteio-verification=${token}`, expiresAt };
  }

  async verify(userId: string, slug: string, sourceId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const source = await this.website(member.organizationId, sourceId);
    if (source.verificationStatus !== 'PENDING' || !source.verificationTokenHash || !source.verificationExpiresAt || source.verificationExpiresAt <= new Date()) {
      throw new ConflictException({ code: 'WEBSITE_VERIFICATION_CHALLENGE_EXPIRED', message: 'Create a new verification challenge and publish its DNS TXT record.' });
    }
    const { hostname } = normalizePublicWebsiteUrl(source.sourceUrl);
    if (isIP(hostname)) throw new BadRequestException({ code: 'WEBSITE_DOMAIN_REQUIRED', message: 'DNS ownership verification requires a domain name; IP-address websites cannot be verified with this method.' });
    await this.assertPublicHost(hostname);
    let records: string[][];
    try { records = await resolveTxt(`_carteio-verify.${hostname}`); }
    catch { records = []; }
    const proof = records.flat().find((entry) => entry.startsWith('carteio-verification='));
    if (!proof || digest(proof.slice('carteio-verification='.length)) !== source.verificationTokenHash) {
      throw new BadRequestException({ code: 'WEBSITE_VERIFICATION_PROOF_MISSING', message: 'The expected DNS TXT proof was not found. Check the record and DNS propagation, then retry.' });
    }
    const now = new Date();
    const nextSyncAt = source.syncPaused || source.syncPolicy === 'MANUAL' ? null : new Date(now.getTime() + (source.syncPolicy === 'DAILY' ? 86400000 : 604800000));
    await this.db.$transaction(async (tx: any) => {
      const result = await tx.knowledgeSource.updateMany({ where: { id: sourceId, organizationId: member.organizationId, type: 'WEBSITE', verificationStatus: 'PENDING', verificationTokenHash: source.verificationTokenHash, verificationExpiresAt: { gt: now } }, data: { verificationStatus: 'VERIFIED', verifiedAt: now, verificationTokenHash: null, verificationExpiresAt: null, nextSyncAt } });
      if (!result.count) throw new ConflictException({ code: 'WEBSITE_VERIFICATION_CHALLENGE_EXPIRED', message: 'The verification challenge changed or expired. Create a new challenge.' });
      await tx.auditEvent.create({ data: { organizationId: member.organizationId, actorUserId: userId, action: 'knowledge.website_verified', entityType: 'knowledge_source', entityId: sourceId, metadata: { method: 'DNS_TXT' } } });
    });
    return { sourceId, verificationStatus: 'VERIFIED', verifiedAt: now, nextSyncAt };
  }

  async settings(userId: string, slug: string, sourceId: string, input: { syncPolicy?: 'MANUAL' | 'DAILY' | 'WEEKLY'; paused?: boolean; pathPrefix?: string | null; maxPages?: number; maxDepth?: number }) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const source = await this.website(member.organizationId, sourceId);
    if (input.pathPrefix !== undefined && input.pathPrefix !== null && (!input.pathPrefix.startsWith('/') || input.pathPrefix.startsWith('//') || input.pathPrefix.includes('?') || input.pathPrefix.includes('#'))) {
      throw new BadRequestException({ code: 'INVALID_CRAWL_PATH_SCOPE', message: 'Path scope must be a URL path beginning with a single slash.' });
    }
    if (input.pathPrefix !== undefined && input.pathPrefix !== null) {
      const startPath = new URL(source.sourceUrl).pathname;
      const prefix = input.pathPrefix === '/' ? '/' : `/${input.pathPrefix.split('/').filter(Boolean).join('/')}`;
      if (prefix !== '/' && startPath !== prefix && !startPath.startsWith(`${prefix}/`)) {
        throw new BadRequestException({ code: 'CRAWL_SCOPE_EXCLUDES_START_URL', message: 'The allowed path must include the registered starting URL.' });
      }
    }
    const policy = input.syncPolicy ?? source.syncPolicy;
    const paused = input.paused ?? source.syncPaused;
    const previousPathScope = source.crawlPathPrefix || '/';
    const nextPathScope = input.pathPrefix ?? '/';
    const scopeChanged = previousPathScope !== nextPathScope
      || (input.maxPages !== undefined && input.maxPages < source.crawlMaxPages)
      || (input.maxDepth !== undefined && input.maxDepth < source.crawlMaxDepth);
    const cancelActiveCrawl = scopeChanged || input.paused === true;
    const nextSyncAt = policy === 'MANUAL' || paused ? null : new Date(Date.now() + (policy === 'DAILY' ? 86400000 : 604800000));
    await this.db.$transaction(async (tx: any) => {
      if (cancelActiveCrawl) {
        const jobs = await tx.knowledgeProcessingJob.findMany({ where: { organizationId: member.organizationId, sourceId, kind: 'CRAWL', status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, select: { id: true } });
        if (jobs.length) {
          const jobIds = jobs.map((job: any) => job.id);
          await tx.knowledgeProcessingJob.updateMany({ where: { organizationId: member.organizationId, id: { in: jobIds }, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'CANCELLED', leaseOwner: null, leasedAt: null, heartbeatAt: null, errorCode: scopeChanged ? 'CRAWL_SCOPE_CHANGED' : 'WEBSITE_SYNC_PAUSED' } });
          await tx.knowledgeSyncRun.updateMany({ where: { organizationId: member.organizationId, sourceId, jobId: { in: jobIds }, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'CANCELLED', errorCode: scopeChanged ? 'CRAWL_SCOPE_CHANGED' : 'WEBSITE_SYNC_PAUSED', finishedAt: new Date() } });
        }
      }
      await tx.knowledgeSource.update({ where: { id_organizationId: { id: sourceId, organizationId: member.organizationId } }, data: {
        ...(input.syncPolicy ? { syncPolicy: input.syncPolicy } : {}),
        ...(input.paused !== undefined ? { syncPaused: input.paused } : {}),
        ...(input.pathPrefix !== undefined ? { crawlPathPrefix: input.pathPrefix || '/' } : {}),
        ...(input.maxPages !== undefined ? { crawlMaxPages: input.maxPages } : {}),
        ...(input.maxDepth !== undefined ? { crawlMaxDepth: input.maxDepth } : {}),
        ...(scopeChanged ? { sourceVersion: { increment: 1 }, processingStatus: 'NOT_PROCESSED', processingErrorCode: null, lastSyncAt: null, lastSuccessfulSyncAt: null } : {}),
        nextSyncAt,
      } });
      await tx.auditEvent.create({ data: { organizationId: member.organizationId, actorUserId: userId, action: 'knowledge.website_sync_settings_updated', entityType: 'knowledge_source', entityId: sourceId, metadata: { syncPolicy: policy, paused } } });
    });
    return { sourceId, syncPolicy: policy, paused, nextSyncAt };
  }

  async details(userId: string, slug: string, sourceId: string) {
    const member = await this.workspaces.requireAccess(userId, slug);
    const source = await this.website(member.organizationId, sourceId);
    const [pages, history, activeJob] = await Promise.all([
      this.db.$queryRaw`SELECT id, "canonicalUrl", title, "pageCategory", "languageHint", "contentHash", "extractionMethod", status, "fetchedAt", "indexedAt", generation, substring(content from 1 for 1200) AS "contentPreview" FROM "KnowledgePage" WHERE "organizationId"=${member.organizationId}::uuid AND "sourceId"=${sourceId}::uuid AND "sourceVersion"=${source.sourceVersion} AND generation=${source.activeIndexGeneration ?? -1} ORDER BY "canonicalUrl" LIMIT 200`,
      this.db.knowledgeSyncRun.findMany({ where: { organizationId: member.organizationId, sourceId }, orderBy: { startedAt: 'desc' }, take: 20 }),
      this.db.knowledgeProcessingJob.findFirst({ where: { organizationId: member.organizationId, sourceId, kind: 'CRAWL', status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, orderBy: { createdAt: 'desc' }, select: { status: true, stage: true } }),
    ]);
    return { sourceId, extractionMode: 'AUTO', renderer: rendererAvailability(), workerEnabled: process.env.KNOWLEDGE_WORKER_ENABLED === 'true', crawlStage: activeJob?.stage ?? null, verificationStatus: source.verificationStatus, verifiedAt: source.verifiedAt, processingStatus: source.processingStatus, processingErrorCode: source.processingErrorCode, crawlJobStatus: activeJob?.status ?? null, syncPolicy: source.syncPolicy, paused: source.syncPaused, nextSyncAt: source.nextSyncAt, lastSyncAttemptAt: source.lastSyncAttemptAt, lastSyncAt: source.lastSyncAt, lastSuccessfulSyncAt: source.lastSuccessfulSyncAt, lastSyncErrorCode: source.lastSyncErrorCode, crawlPathPrefix: source.crawlPathPrefix, crawlMaxPages: source.crawlMaxPages, crawlMaxDepth: source.crawlMaxDepth, pages, history };
  }

  private async website(organizationId: string, sourceId: string) {
    const source = await this.db.knowledgeSource.findFirst({ where: { id: sourceId, organizationId, type: 'WEBSITE' }, select: { id: true, sourceUrl: true, status: true, processingStatus: true, processingErrorCode: true, verificationStatus: true, verificationTokenHash: true, verificationExpiresAt: true, syncPolicy: true, syncPaused: true, nextSyncAt: true, crawlPathPrefix: true, crawlMaxPages: true, crawlMaxDepth: true, sourceVersion: true, activeIndexGeneration: true } });
    if (!source) throw new NotFoundException({ code: 'KNOWLEDGE_SOURCE_NOT_FOUND', message: 'Website source not found in this workspace.' });
    if (source.status !== 'REGISTERED') throw new ConflictException({ code: 'WEBSITE_SOURCE_INACTIVE', message: 'Restore the website source before managing verification or sync.' });
    return source;
  }

  private async assertPublicHost(hostname: string) {
    try {
      const addresses = await lookup(hostname, { all: true, verbatim: true });
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error('unsafe');
    } catch {
      throw new BadRequestException({ code: 'WEBSITE_HOST_NOT_PUBLIC', message: 'The website host must resolve only to public network addresses before it can be verified.' });
    }
  }
}
