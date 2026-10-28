import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { KnowledgeProcessingService } from './knowledge-processing.service';
import { KnowledgeService, normalizePublicWebsiteUrl } from './knowledge.service';
import { WebsiteVerificationService } from './website-verification.service';
import { WorkspaceService } from './workspace.service';

const managers = ['OWNER', 'ADMIN'] as const;
const canonicalKey = (url: string) => `website:${createHash('sha256').update(url, 'utf8').digest('hex')}`;

/** Registers Shopify's provider-confirmed storefront while retaining its verified-domain crawl gate. */
@Injectable()
export class ShopifyWebsiteDiscoveryService {
  private readonly db: any;
  constructor(
    prisma: PrismaService,
    private readonly workspaces: WorkspaceService,
    private readonly knowledge: KnowledgeService,
    private readonly processing: KnowledgeProcessingService,
    private readonly websiteVerification: WebsiteVerificationService,
  ) { this.db = prisma as any; }

  async discover(userId: string, slug: string, connectorInstanceId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const connector = await this.connectedShopify(member.organizationId, connectorInstanceId);
    const rawUrl = connector.commerceConnection?.siteUrl;
    if (typeof rawUrl !== 'string') throw new ConflictException({ code: 'SHOPIFY_STOREFRONT_DOMAIN_UNAVAILABLE', message: 'Reverify the Shopify connection to retrieve its primary storefront domain.' });
    let url: string;
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('unsafe');
      url = normalizePublicWebsiteUrl(parsed.origin).url;
    } catch {
      throw new BadRequestException({ code: 'SHOPIFY_STOREFRONT_DOMAIN_INVALID', message: 'Shopify did not provide a safe HTTPS primary storefront domain.' });
    }
    const key = canonicalKey(url);
    let source = await this.db.knowledgeSource.findFirst({ where: { organizationId: member.organizationId, canonicalKey: key, type: 'WEBSITE' }, select: { id: true, sourceUrl: true, status: true, verificationStatus: true, verifiedAt: true } });
    if (!source) {
      try {
        const created = await this.knowledge.createShopifyDiscoveredWebsite(userId, slug, { sourceUrl: url, name: new URL(url).hostname, description: 'Public storefront discovered from the connected Shopify shop. DNS ownership verification is required before crawling.', visibility: 'PUBLIC_REFERENCE' });
        source = { id: created.id, sourceUrl: created.sourceUrl, status: created.status, verificationStatus: created.verificationStatus, verifiedAt: created.verifiedAt };
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
        source = await this.db.knowledgeSource.findFirst({ where: { organizationId: member.organizationId, canonicalKey: key, type: 'WEBSITE' }, select: { id: true, sourceUrl: true, status: true, verificationStatus: true, verifiedAt: true } });
      }
    }
    if (!source) throw new ConflictException({ code: 'SHOPIFY_STOREFRONT_SOURCE_UNAVAILABLE', message: 'The storefront source could not be registered. Retry discovery.' });
    if (String(source.status).toUpperCase() === 'ARCHIVED') throw new ConflictException({ code: 'SHOPIFY_STOREFRONT_SOURCE_ARCHIVED', message: 'This storefront source is archived. Restore the existing Knowledge source before using Shopify website discovery.' });
    return { connectorInstanceId, storefrontUrl: url, sourceId: source.id, sourceUrl: source.sourceUrl, authorizationStatus: source.verificationStatus, verifiedAt: source.verifiedAt, crawlAllowed: source.verificationStatus === 'VERIFIED' && Boolean(source.verifiedAt) };
  }

  async status(userId: string, slug: string, connectorInstanceId: string) {
    const member = await this.workspaces.requireAccess(userId, slug);
    const connector = await this.connectedShopify(member.organizationId, connectorInstanceId);
    const rawUrl = connector.commerceConnection?.siteUrl;
    const storefrontUrl = typeof rawUrl === 'string' ? this.safeStorefrontUrl(rawUrl) : null;
    const source = storefrontUrl ? await this.db.knowledgeSource.findFirst({ where: { organizationId: member.organizationId, canonicalKey: canonicalKey(storefrontUrl), type: 'WEBSITE' }, select: { id: true, sourceUrl: true, status: true, verificationStatus: true, verifiedAt: true, processingStatus: true, lastSuccessfulSyncAt: true, lastSyncAttemptAt: true, lastSyncErrorCode: true, nextSyncAt: true, activeIndexGeneration: true, sourceVersion: true } }) : null;
    if (!source) return { connectorInstanceId, storefrontUrl, sourceId: null, authorizationStatus: 'NOT_REGISTERED', discoveredUrls: 0, crawledPages: 0, ingestedPages: 0, failedPages: 0, skippedPages: 0, unsupportedPages: 0, retryableFailures: 0, knowledgeFreshness: 'UNAVAILABLE', lastSuccessfulRefreshAt: null, lastAttemptAt: null, errorCode: null };
    const [pages, latestRun, activeJob] = await Promise.all([
      source.activeIndexGeneration == null ? Promise.resolve([]) : this.db.knowledgePage.findMany({ where: { organizationId: member.organizationId, sourceId: source.id, generation: source.activeIndexGeneration, sourceVersion: source.sourceVersion, status: 'READY' }, select: { id: true, canonicalUrl: true, indexedAt: true } }),
      this.db.knowledgeSyncRun.findFirst({ where: { organizationId: member.organizationId, sourceId: source.id }, orderBy: { startedAt: 'desc' }, select: { status: true, discoveredPages: true, changedPages: true, unchangedPages: true, removedPages: true, failedPages: true, skippedPages: true, unsupportedPages: true, retryableFailures: true, errorCode: true, startedAt: true, finishedAt: true } }),
      this.db.knowledgeProcessingJob.findFirst({ where: { organizationId: member.organizationId, sourceId: source.id, kind: 'CRAWL', status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, orderBy: { createdAt: 'desc' }, select: { status: true, stage: true } }),
    ]);
    const latestSuccess = await this.db.knowledgeSyncRun.findFirst({ where: { organizationId: member.organizationId, sourceId: source.id, status: 'SUCCEEDED' }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } });
    const lastSuccessfulRefreshAt = latestSuccess?.finishedAt ?? source.lastSuccessfulSyncAt;
    const knowledgeFreshness = !lastSuccessfulRefreshAt ? 'UNAVAILABLE' : Date.now() - new Date(lastSuccessfulRefreshAt).getTime() <= 24 * 60 * 60 * 1000 ? 'FRESH' : 'STALE';
    const lastSuccessfulIndexAt = pages.reduce((latest: Date | null, page: any) => page.indexedAt && (!latest || new Date(page.indexedAt) > latest) ? new Date(page.indexedAt) : latest, null);
    return { connectorInstanceId, storefrontUrl, sourceId: source.id, sourceUrl: source.sourceUrl, authorizationStatus: source.verificationStatus, verifiedAt: source.verifiedAt, crawlAllowed: source.verificationStatus === 'VERIFIED' && Boolean(source.verifiedAt) && source.status === 'REGISTERED', crawlStatus: activeJob?.status ?? latestRun?.status ?? source.processingStatus, crawlStage: activeJob?.stage ?? null, discoveredUrls: latestRun?.discoveredPages ?? 0, crawledPages: pages.length, ingestedPages: pages.filter((page: any) => page.indexedAt).length, changedPages: latestRun?.changedPages ?? 0, unchangedPages: latestRun?.unchangedPages ?? 0, removedPages: latestRun?.removedPages ?? 0, failedPages: latestRun?.failedPages ?? 0, skippedPages: latestRun?.skippedPages ?? 0, unsupportedPages: latestRun?.unsupportedPages ?? 0, retryableFailures: latestRun?.retryableFailures ?? 0, partial: Boolean(latestRun && latestRun.status === 'SUCCEEDED_WITH_WARNINGS'), knowledgeFreshness, lastSuccessfulRefreshAt, lastAttemptAt: source.lastSyncAttemptAt ?? latestRun?.startedAt ?? null, lastSuccessfulIndexAt, nextScheduledRefreshAt: source.nextSyncAt, errorCode: latestRun?.errorCode ?? source.lastSyncErrorCode };
  }

  async refresh(userId: string, slug: string, connectorInstanceId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const connector = await this.connectedShopify(member.organizationId, connectorInstanceId);
    const siteUrl = this.safeStorefrontUrl(connector.commerceConnection?.siteUrl);
    if (!siteUrl) throw new ConflictException({ code: 'SHOPIFY_STOREFRONT_DOMAIN_UNAVAILABLE', message: 'Reverify the Shopify connection to retrieve its primary storefront domain.' });
    const source = await this.db.knowledgeSource.findFirst({ where: { organizationId: member.organizationId, canonicalKey: canonicalKey(siteUrl), type: 'WEBSITE' }, select: { id: true, verificationStatus: true, verifiedAt: true, status: true } });
    if (!source) throw new NotFoundException({ code: 'SHOPIFY_STOREFRONT_NOT_DISCOVERED', message: 'Discover the Shopify storefront and verify its domain before refreshing content.' });
    if (source.status !== 'REGISTERED' || source.verificationStatus !== 'VERIFIED' || !source.verifiedAt) throw new ConflictException({ code: 'SHOPIFY_STOREFRONT_DOMAIN_NOT_VERIFIED', message: 'Verify control of the Shopify storefront domain before using Shopify storefront discovery.' });
    return this.processing.enqueueWebsite(userId, slug, source.id);
  }

  async challenge(userId: string, slug: string, connectorInstanceId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const source = await this.discoveredSource(member.organizationId, connectorInstanceId);
    return this.websiteVerification.challenge(userId, slug, source.id);
  }

  async verify(userId: string, slug: string, connectorInstanceId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const source = await this.discoveredSource(member.organizationId, connectorInstanceId);
    return this.websiteVerification.verify(userId, slug, source.id);
  }

  private async discoveredSource(organizationId: string, connectorInstanceId: string) {
    const connector = await this.connectedShopify(organizationId, connectorInstanceId);
    const siteUrl = this.safeStorefrontUrl(connector.commerceConnection?.siteUrl);
    if (!siteUrl) throw new ConflictException({ code: 'SHOPIFY_STOREFRONT_DOMAIN_UNAVAILABLE', message: 'Reverify the Shopify connection to retrieve its primary storefront domain.' });
    const source = await this.db.knowledgeSource.findFirst({ where: { organizationId, canonicalKey: canonicalKey(siteUrl), type: 'WEBSITE' }, select: { id: true } });
    if (!source) throw new NotFoundException({ code: 'SHOPIFY_STOREFRONT_NOT_DISCOVERED', message: 'Discover the Shopify storefront before verifying it.' });
    return source;
  }

  private async connectedShopify(organizationId: string, connectorInstanceId: string) {
    const connector = await this.db.connectorInstance.findFirst({ where: { id: connectorInstanceId, organizationId, connectorId: 'shopify_v1', state: 'CONNECTED', commerceConnection: { is: { organizationId, platform: 'SHOPIFY', state: 'CONNECTED' } } }, select: { id: true, commerceConnection: { select: { siteUrl: true } } } });
    if (!connector) throw new NotFoundException({ code: 'SHOPIFY_CONNECTION_NOT_FOUND', message: 'Connected Shopify store was not found in this workspace.' });
    return connector;
  }

  private safeStorefrontUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try { const parsed = new URL(value); if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash) return null; return normalizePublicWebsiteUrl(parsed.origin).url; }
    catch { return null; }
  }
}
