import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import { ConnectorCredentialVault } from './connector-credential-vault';
import { ConnectorRegistry } from './connector.registry';
import { connectorSyncDebug } from './connector-sync-debug';
import { isShopifyScopeSnapshotFresh, shopifyScopeAllows, SHOPIFY_CONTENT_SCOPE_REQUIREMENTS, shopifyContentCategoryAllowed } from './shopify-granted-scope-discovery.service';

const boundedError = (error: unknown) => { const code = error instanceof Error ? error.message : ''; return /^CONNECTOR_[A-Z0-9_]{1,80}$/.test(code) ? code : 'CONNECTOR_OPERATION_FAILED'; };
const batchSize = () => Math.min(Math.max(Number(process.env.CONNECTOR_SYNC_BATCH_SIZE ?? 10), 1), 100);
export const isCompleteAuthoritativeProductSnapshot = (input: { connectorId: string; resourceType: string; mode: string; complete: boolean }) => input.connectorId === 'shopify_v1' && input.resourceType === 'PRODUCTS' && input.mode === 'FULL' && input.complete;
export function validateConnectorSyncPage(result: any, connectorId: string, currentCursor?: string | null, cursorTrail: readonly string[] = []) {
  if (!result || !Number.isInteger(result.itemCount) || result.itemCount < 0 || result.itemCount > 5000 || (result.cursor && (typeof result.cursor !== 'string' || result.cursor.length > 2048)) || Buffer.byteLength(JSON.stringify(result.checkpoint ?? null)) > 16384) throw new Error('CONNECTOR_SYNC_RESULT_INVALID');
  if (result.records && (!Array.isArray(result.records) || result.records.length > 100)) throw new Error('CONNECTOR_SYNC_RESULT_INVALID');
  if (result.complete !== true && result.complete !== false) throw new Error('CONNECTOR_SYNC_RESULT_INVALID');
  const cursorHash = typeof result.cursor === 'string' ? createHash('sha256').update(result.cursor).digest('hex') : '';
  if (!result.complete && (!result.cursor || result.cursor === currentCursor || cursorTrail.includes(cursorHash))) throw new Error('CONNECTOR_SYNC_CURSOR_INVALID');
  if (result.records?.some((record: any) => record.kind === 'PRODUCT' ? record.variantsComplete !== true : record.kind === 'ORDER' ? record.linesComplete !== true : false)) throw new Error('CONNECTOR_NESTED_PAGINATION_INCOMPLETE');
  if (connectorId === 'shopify_v1' && result.records?.some((record: any) => record.kind === 'PRODUCT' && record.imagesComplete !== true)) throw new Error('CONNECTOR_NESTED_PAGINATION_INCOMPLETE');
}

@Injectable()
export class ConnectorSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly db: any;
  private readonly logger = new Logger(ConnectorSyncWorker.name);
  private timer?: NodeJS.Timeout;
  private inFlight: Promise<void> | null = null;
  private batchStage = 'connector.batch_start';
  constructor(prisma: PrismaService, private readonly registry: ConnectorRegistry, private readonly vault: ConnectorCredentialVault) { this.db = prisma; }
  onModuleInit() {
    if (process.env.CONNECTOR_SYNC_WORKER_ENABLED !== 'true') return;
    const poll = Math.min(Math.max(Number(process.env.CONNECTOR_SYNC_POLL_MS ?? 15000), 1000), 300000);
    this.timer = setInterval(() => { if (!this.inFlight) this.inFlight = this.runBatch().then(() => undefined).catch((error) => this.logFailure(error)).finally(() => { this.inFlight = null; }); }, poll);
    this.timer.unref();
    void (this.inFlight = this.runBatch().then(() => undefined).catch((error) => this.logFailure(error)).finally(() => { this.inFlight = null; }));
  }
  async onModuleDestroy() { if (this.timer) clearInterval(this.timer); await this.inFlight; }
  private logFailure(error: unknown) { const code = boundedError(error); this.logger.warn(JSON.stringify({ event: 'connector_worker_batch_failed', code, stage: this.batchStage })); }

  async runBatch(now = new Date()) {
    const limit = batchSize();
    this.batchStage = 'connector.schedule_enqueue';
    await this.enqueueScheduledSyncs(now, Math.min(limit, 20));
    this.batchStage = 'connector.sync_job_claim';
    const [syncLeases, webhookLeases] = await Promise.all([this.claimSyncJobs(now, limit), this.claimWebhooks(now, limit)]);
    for (const lease of syncLeases) { this.batchStage = 'connector.sync_job_process'; await this.processSync(lease); }
    for (const lease of webhookLeases) { this.batchStage = 'connector.webhook_process'; await this.processWebhook(lease); }
    this.batchStage = 'connector.batch_complete';
    return { syncJobs: syncLeases.length, webhooks: webhookLeases.length };
  }

  private async enqueueScheduledSyncs(now: Date, limit: number) {
    if (typeof this.db.connectorSyncSchedule?.findMany !== 'function') return 0;
    const schedules = await this.db.connectorSyncSchedule.findMany({
      where: { enabled: true, paused: false, nextRunAt: { lte: now } },
      orderBy: [{ nextRunAt: 'asc' }, { id: 'asc' }], take: Math.max(1, Math.min(limit, 20)),
      include: { connector: { select: { id: true, organizationId: true, connectorId: true, state: true, verifiedCapabilities: true, lastVerifiedAt: true, commerceConnection: { select: { state: true, grantedScopes: true, grantedScopesVerifiedAt: true } } } } },
    });
    const connectorIds = [...new Set(schedules.map((schedule: any) => schedule.connectorInstanceId))];
    const permissionRows = connectorIds.length ? await this.db.connectorDataPermission.findMany({ where: { connectorInstanceId: { in: connectorIds }, syncEnabled: true }, select: { organizationId: true, connectorInstanceId: true, category: true } }) : [];
    const permissionsByConnector = new Map<string, Set<string>>();
    for (const row of permissionRows) {
      const key = `${row.organizationId}:${row.connectorInstanceId}`;
      if (!permissionsByConnector.has(key)) permissionsByConnector.set(key, new Set());
      permissionsByConnector.get(key)!.add(row.category);
    }
    let enqueued = 0;
    for (const schedule of schedules) {
      const connector = schedule.connector;
      const allowed = permissionsByConnector.get(`${schedule.organizationId}:${schedule.connectorInstanceId}`) ?? new Set<string>();
      const capabilities: string[] = Array.isArray(connector?.verifiedCapabilities) ? connector.verifiedCapabilities : [];
      const scopes: string[] = connector?.commerceConnection?.grantedScopes ?? [];
      const fresh = connector?.connectorId !== 'shopify_v1' || isShopifyScopeSnapshotFresh(connector?.commerceConnection?.grantedScopesVerifiedAt ?? connector?.lastVerifiedAt);
      const permitted = connector?.state === 'CONNECTED'
        && (schedule.resourceType === 'PRODUCTS'
          ? allowed.has('PRODUCTS') && capabilities.includes('PRODUCT_CATALOG') && (connector.connectorId !== 'shopify_v1' || fresh && shopifyScopeAllows(scopes, 'PRODUCTS'))
          : schedule.resourceType === 'ORDERS'
            ? allowed.has('ORDERS') && capabilities.includes('ORDERS') && (connector.connectorId !== 'shopify_v1' || fresh && shopifyScopeAllows(scopes, 'ORDERS'))
            : connector.connectorId === 'shopify_v1'
              ? fresh && [...allowed].some((category) => category in SHOPIFY_CONTENT_SCOPE_REQUIREMENTS && shopifyContentCategoryAllowed(category, scopes, capabilities))
              : (allowed.has('WEBSITE_PAGES') || allowed.has('FAQ_POLICIES')) && capabilities.includes('WEBSITE_CONTENT'));
      const nextRunAt = new Date(now.getTime() + schedule.intervalMinutes * 60_000);
      await this.db.$transaction(async (tx: any) => {
        const current = await tx.connectorSyncSchedule.findFirst({ where: { id: schedule.id, enabled: true, paused: false, nextRunAt: { lte: now } }, select: { id: true } });
        if (!current) return;
        if (permitted) {
          const idempotencyKey = `schedule:${schedule.id}:${new Date(schedule.nextRunAt).toISOString()}`;
          const active = await tx.connectorSyncJob.findFirst({ where: { organizationId: schedule.organizationId, connectorInstanceId: schedule.connectorInstanceId, resourceType: schedule.resourceType, state: { in: ['PENDING', 'RUNNING', 'RETRY_WAIT'] } }, select: { id: true } });
          if (!active) {
            await tx.connectorSyncJob.upsert({ where: { organizationId_connectorInstanceId_idempotencyKey: { organizationId: schedule.organizationId, connectorInstanceId: schedule.connectorInstanceId, idempotencyKey } }, create: { organizationId: schedule.organizationId, connectorInstanceId: schedule.connectorInstanceId, resourceType: schedule.resourceType, mode: schedule.mode, idempotencyKey, state: 'PENDING' }, update: {} });
            enqueued++;
          }
        }
        await tx.connectorSyncSchedule.update({ where: { id: schedule.id }, data: { lastRunAt: now, nextRunAt } });
      }, { timeout: 10000, maxWait: 5000 });
    }
    return enqueued;
  }

  private async claimSyncJobs(now: Date, limit: number) {
    const startedAt = Date.now();
    try {
    const leases = await this.db.$transaction(async (tx: any) => {
      const due = await tx.$queryRaw<Array<{ id: string; organizationId: string; connectorInstanceId: string; resourceType: string }>>`SELECT j."id",j."organizationId",j."connectorInstanceId",j."resourceType" FROM "ConnectorSyncJob" j JOIN "ConnectorInstance" c ON c."id"=j."connectorInstanceId" AND c."organizationId"=j."organizationId" WHERE c."state"='CONNECTED' AND (c."integrationConnectionId" IS NULL OR EXISTS (SELECT 1 FROM "IntegrationConnection" i WHERE i."id"=c."integrationConnectionId" AND i."organizationId"=c."organizationId" AND i."state"='CONNECTED')) AND ((j."state" IN ('PENDING','RETRY_WAIT') AND j."scheduledAt"<=${now}) OR (j."state"='RUNNING' AND j."leaseUntil"<=${now})) ORDER BY j."scheduledAt", j."id" LIMIT ${limit} FOR UPDATE OF j SKIP LOCKED`;
      const leases: Array<{ id: string; token: string }> = [];
      for (const row of due) {
        const resourceLock = `${row.organizationId}:${row.connectorInstanceId}:${row.resourceType}`;
        await tx.$queryRaw<Array<{ acquired: boolean }>>`
          WITH advisory_lock AS MATERIALIZED (
            SELECT pg_advisory_xact_lock(hashtextextended(${resourceLock}::text, 0::bigint))
          )
          SELECT TRUE AS acquired FROM advisory_lock
        `;
        const activeForResource = await tx.connectorSyncJob.findFirst({ where: { organizationId: row.organizationId, connectorInstanceId: row.connectorInstanceId, resourceType: row.resourceType, id: { not: row.id }, state: 'RUNNING', leaseUntil: { gt: now } }, select: { id: true } });
        if (activeForResource) continue;
        const token = randomUUID();
        const updated = await tx.connectorSyncJob.updateMany({ where: { id: row.id, OR: [{ state: { in: ['PENDING', 'RETRY_WAIT'] }, scheduledAt: { lte: now } }, { state: 'RUNNING', leaseUntil: { lte: now } }] }, data: { state: 'RUNNING', leaseToken: token, leaseUntil: new Date(now.getTime() + 60_000), attemptCount: { increment: 1 }, startedAt: now } });
        if (updated.count === 1) leases.push({ id: row.id, token });
      }
      return leases;
    }, { timeout: 10000, maxWait: 5000 });
    connectorSyncDebug(this.logger, '14_worker_job_pickup', 'worker:batch', startedAt, { operation: 'connector.sync_job_claim', claimedCount: leases.length });
    return leases;
    } catch (error) {
      connectorSyncDebug(this.logger, '14_worker_job_pickup', 'worker:batch', startedAt, { operation: 'connector.sync_job_claim' }, error);
      throw error;
    }
  }
  private async claimWebhooks(now: Date, limit: number) {
    return this.db.$transaction(async (tx: any) => {
      const due = await tx.$queryRaw<Array<{ id: string }>>`SELECT e."id" FROM "ConnectorWebhookEvent" e JOIN "ConnectorInstance" c ON c."id"=e."connectorInstanceId" AND c."organizationId"=e."organizationId" WHERE c."state"='CONNECTED' AND ((e."state"='RECEIVED' AND e."nextAttemptAt"<=${now}) OR (e."state"='PROCESSING' AND e."leaseUntil"<=${now})) ORDER BY e."nextAttemptAt", e."receivedAt", e."id" LIMIT ${limit} FOR UPDATE OF e SKIP LOCKED`;
      const leases: Array<{ id: string; token: string }> = [];
      for (const row of due) {
        const token = randomUUID();
        const updated = await tx.connectorWebhookEvent.updateMany({ where: { id: row.id, OR: [{ state: 'RECEIVED', nextAttemptAt: { lte: now } }, { state: 'PROCESSING', leaseUntil: { lte: now } }] }, data: { state: 'PROCESSING', leaseToken: token, leaseUntil: new Date(now.getTime() + 60_000), attemptCount: { increment: 1 } } });
        if (updated.count === 1) leases.push({ id: row.id, token });
      }
      return leases;
    }, { timeout: 10000, maxWait: 5000 });
  }

  private async processSync(lease: { id: string; token: string }) {
    const startedAt = Date.now();
    let stage = '14_worker_job_pickup';
    let job: any;
    try { job = await this.db.connectorSyncJob.findFirst({ where: { id: lease.id, state: 'RUNNING', leaseToken: lease.token }, include: { connector: { include: { credential: true, commerceConnection: { select: { state: true, grantedScopes: true, grantedScopesVerifiedAt: true } } } } } }); }
    catch (error) { connectorSyncDebug(this.logger, stage, `worker:${lease.id}`, startedAt, { operation: 'connector.sync_job_load', syncJobId: lease.id }, error); throw error; }
    if (!job) {
      connectorSyncDebug(this.logger, stage, `worker:${lease.id}`, startedAt, { operation: 'connector.sync_job_load', syncJobId: lease.id, found: false });
      return;
    }
    const debugShopify = job.connector.connectorId === 'shopify_v1';
    const debug = (name: string, fields: Record<string, string | number | boolean | null | undefined>, error?: unknown) => {
      if (debugShopify) connectorSyncDebug(this.logger, name, `worker:${job.id}`, startedAt, { operation: 'connector.shopify_sync', syncJobId: job.id, organizationId: job.organizationId, connectorInstanceId: job.connectorInstanceId, ...fields }, error);
    };
    debug(stage, { state: job.state });
    if (job.connector.state !== 'CONNECTED' || !job.connector.credential) {
      debug('14_worker_job_cancelled', { reason: job.connector.state !== 'CONNECTED' ? 'CONNECTOR_NOT_CONNECTED' : 'CREDENTIAL_MISSING' });
      return this.cancelSync(job.id, lease.token);
    }
    try {
      const allowedRows = await this.db.connectorDataPermission.findMany({ where: { organizationId: job.organizationId, connectorInstanceId: job.connectorInstanceId, syncEnabled: true }, select: { category: true } });
      const allowed = new Set<string>(allowedRows.map((row: any) => row.category));
      const capabilities: string[] = Array.isArray(job.connector.verifiedCapabilities) ? job.connector.verifiedCapabilities : [];
      const grantedScopes: string[] = job.connector.commerceConnection?.grantedScopes ?? [];
      const scopeSnapshotFresh = job.connector.connectorId !== 'shopify_v1' || isShopifyScopeSnapshotFresh(job.connector.commerceConnection?.grantedScopesVerifiedAt ?? job.connector.lastVerifiedAt);
      const providerProducts = job.connector.connectorId === 'shopify_v1' ? scopeSnapshotFresh && shopifyScopeAllows(grantedScopes, 'PRODUCTS') && capabilities.includes('PRODUCT_CATALOG') : capabilities.includes('PRODUCT_CATALOG');
      const providerPrices = job.connector.connectorId === 'shopify_v1' ? scopeSnapshotFresh && shopifyScopeAllows(grantedScopes, 'PRODUCTS') && capabilities.includes('PRODUCT_PRICES') : capabilities.includes('PRODUCT_PRICES');
      const providerInventory = job.connector.connectorId === 'shopify_v1' ? scopeSnapshotFresh && shopifyScopeAllows(grantedScopes, 'INVENTORY') && capabilities.includes('INVENTORY') : capabilities.includes('INVENTORY');
      const providerOrders = job.connector.connectorId === 'shopify_v1' ? scopeSnapshotFresh && shopifyScopeAllows(grantedScopes, 'ORDERS') && capabilities.includes('ORDERS') : capabilities.includes('ORDERS');
      const enabledShopifyContentCategories = [...allowed].filter((category) => category in SHOPIFY_CONTENT_SCOPE_REQUIREMENTS && scopeSnapshotFresh && shopifyContentCategoryAllowed(category, grantedScopes, capabilities));
      const legacyContentAllowed = (allowed.has('WEBSITE_PAGES') || allowed.has('FAQ_POLICIES')) && capabilities.includes('WEBSITE_CONTENT');
      const required = job.resourceType === 'PRODUCTS' ? allowed.has('PRODUCTS') : job.resourceType === 'ORDERS' ? allowed.has('ORDERS') : job.connector.connectorId === 'shopify_v1' ? enabledShopifyContentCategories.length > 0 || legacyContentAllowed : legacyContentAllowed;
      if (!required || (job.resourceType === 'PRODUCTS' && !providerProducts) || (job.resourceType === 'ORDERS' && !providerOrders)) {
        debug('14_worker_job_cancelled', { reason: 'CONNECTOR_DATA_PERMISSION_DISABLED' });
        return this.cancelSync(job.id, lease.token);
      }
      stage = '15_shopify_product_api_request';
      const adapter = this.registry.adapter(job.connector.connectorId);
      this.registry.assertResourceSupport(job.connector.connectorId, job.resourceType);
      const credentials = this.vault.decrypt(job.connector.credential, `carteio:connector:${job.organizationId}:${job.connectorInstanceId}:${job.connector.connectorId}`);
      const result = await adapter.sync({ organizationId: job.organizationId, connectorInstanceId: job.connectorInstanceId }, { resourceType: job.resourceType, mode: job.mode, cursor: job.cursor, checkpoint: job.checkpoint, includePrices: allowed.has('PRICES') && providerPrices, includeInventory: allowed.has('INVENTORY') && providerInventory, ...(job.connector.connectorId === 'shopify_v1' && job.resourceType === 'CONTENT' ? { enabledCategories: enabledShopifyContentCategories, grantedScopes } : {}) }, job.connector.configuration as Record<string, unknown>, credentials);
      stage = '16_product_variant_inventory_processing';
      debug(stage, { resourceType: job.resourceType, recordCount: result.records?.length ?? 0, itemCount: result.itemCount, complete: result.complete });
      const checkpointBefore = job.checkpoint && typeof job.checkpoint === 'object' ? job.checkpoint as Record<string, any> : {};
      const cursorTrail: string[] = Array.isArray(checkpointBefore.cursorTrail) ? checkpointBefore.cursorTrail.filter((item: unknown): item is string => typeof item === 'string').slice(-24) : [];
      validateConnectorSyncPage(result, job.connector.connectorId, job.cursor, cursorTrail);
      const checkpointAfter = !result.complete ? { ...(result.checkpoint && typeof result.checkpoint === 'object' ? result.checkpoint as Record<string, unknown> : {}), cursorTrail: [...cursorTrail, createHash('sha256').update(result.cursor as string).digest('hex')].slice(-24) } : result.checkpoint;
      stage = '17_commerce_database_upsert_and_job_completion';
      let cancelledForPermission = false;
      await this.db.$transaction(async (tx: any) => {
        // Serialize Shopify publication with disconnect. If disconnect wins the
        // connector-row lock, this transaction observes the inactive state and
        // cannot republish records after the disconnect transaction commits.
        if (job.connector.connectorId === 'shopify_v1') {
          const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "ConnectorInstance" WHERE "id" = ${job.connectorInstanceId}::uuid AND "organizationId" = ${job.organizationId}::uuid FOR UPDATE`;
          if (!locked.length) return;
        }
        const stillLeased = await tx.connectorSyncJob.findFirst({ where: { id: job.id, state: 'RUNNING', leaseToken: lease.token }, select: { id: true } });
        if (!stillLeased) return;
        const latestPermissionRows = await tx.connectorDataPermission.findMany({ where: { organizationId: job.organizationId, connectorInstanceId: job.connectorInstanceId, syncEnabled: true }, select: { category: true } });
        const latestAllowed = new Set<string>(latestPermissionRows.map((row: any) => row.category));
        const latestConnector = await tx.connectorInstance.findFirst({ where: { id: job.connectorInstanceId, organizationId: job.organizationId }, select: { state: true, connectorId: true, verifiedCapabilities: true, lastVerifiedAt: true, commerceConnection: { select: { state: true, grantedScopes: true, grantedScopesVerifiedAt: true } } } });
        const latestCapabilities: string[] = Array.isArray(latestConnector?.verifiedCapabilities) ? latestConnector.verifiedCapabilities : [];
        const latestScopes: string[] = latestConnector?.commerceConnection?.grantedScopes ?? [];
        const latestScopeSnapshotFresh = latestConnector?.connectorId !== 'shopify_v1' || isShopifyScopeSnapshotFresh(latestConnector?.commerceConnection?.grantedScopesVerifiedAt ?? latestConnector?.lastVerifiedAt);
        const latestProviderProducts = latestConnector?.connectorId === 'shopify_v1' ? latestScopeSnapshotFresh && shopifyScopeAllows(latestScopes, 'PRODUCTS') && latestCapabilities.includes('PRODUCT_CATALOG') : latestCapabilities.includes('PRODUCT_CATALOG');
        const latestProviderPrices = latestConnector?.connectorId === 'shopify_v1' ? latestScopeSnapshotFresh && shopifyScopeAllows(latestScopes, 'PRODUCTS') && latestCapabilities.includes('PRODUCT_PRICES') : latestCapabilities.includes('PRODUCT_PRICES');
        const latestProviderInventory = latestConnector?.connectorId === 'shopify_v1' ? latestScopeSnapshotFresh && shopifyScopeAllows(latestScopes, 'INVENTORY') && latestCapabilities.includes('INVENTORY') : latestCapabilities.includes('INVENTORY');
        const latestProviderOrders = latestConnector?.connectorId === 'shopify_v1' ? latestScopeSnapshotFresh && shopifyScopeAllows(latestScopes, 'ORDERS') && latestCapabilities.includes('ORDERS') : latestCapabilities.includes('ORDERS');
        const latestShopifyContentCategories = [...latestAllowed].filter((category) => category in SHOPIFY_CONTENT_SCOPE_REQUIREMENTS && latestScopeSnapshotFresh && shopifyContentCategoryAllowed(category, latestScopes, latestCapabilities));
        const latestLegacyContentAllowed = (latestAllowed.has('WEBSITE_PAGES') || latestAllowed.has('FAQ_POLICIES')) && latestCapabilities.includes('WEBSITE_CONTENT');
        const latestRequired = latestConnector?.state === 'CONNECTED' && (job.resourceType === 'PRODUCTS' ? latestAllowed.has('PRODUCTS') && latestProviderProducts : job.resourceType === 'ORDERS' ? latestAllowed.has('ORDERS') && latestProviderOrders : latestConnector?.connectorId === 'shopify_v1' ? latestShopifyContentCategories.length > 0 || latestLegacyContentAllowed : latestLegacyContentAllowed);
        if (!latestRequired) {
          cancelledForPermission = true;
          await tx.connectorSyncJob.updateMany({ where: { id: job.id, state: 'RUNNING', leaseToken: lease.token }, data: { state: 'CANCELLED', finishedAt: new Date(), leaseToken: null, leaseUntil: null, lastErrorCode: 'CONNECTOR_DATA_PERMISSION_DISABLED' } });
          return;
        }
        const link = job.connector.integrationConnectionId ? await tx.integrationConnection.findFirst({ where: { id: job.connector.integrationConnectionId, organizationId: job.organizationId, state: 'CONNECTED' }, select: { id: true } }) : null;
        if (result.records?.length && !link) throw new Error('CONNECTOR_COMMERCE_LINK_MISSING');
        for (const record of result.records ?? []) {
          if (record.kind === 'PRODUCT') {
            if (!latestAllowed.has('PRICES') || !latestProviderPrices) { record.price = null; record.compareAtPrice = null; record.currency = null; for (const variant of record.variants) { variant.price = null; variant.compareAtPrice = null; variant.currency = null; } }
            if (!latestAllowed.has('INVENTORY') || !latestProviderInventory) { record.inventory = null; record.availability = null; for (const variant of record.variants) { variant.inventory = null; variant.availability = null; } }
            if (!latestAllowed.has('CATEGORIES')) { record.category = null; record.productType = null; record.taxonomyCategoryId = null; record.taxonomyCategory = null; record.collections = []; }
          }
          if (record.kind === 'KNOWLEDGE') {
            const category = typeof record.permissionCategory === 'string' ? record.permissionCategory : /faq|policy|terms|privacy|refund|return|shipping/i.test(`${record.category ?? ''} ${record.title}`) ? 'FAQ_POLICIES' : 'WEBSITE_PAGES';
            if (category in SHOPIFY_CONTENT_SCOPE_REQUIREMENTS) {
              if (!latestAllowed.has(category) || !latestScopeSnapshotFresh || !shopifyContentCategoryAllowed(category, latestScopes, latestCapabilities)) continue;
            } else if (!latestAllowed.has(category) || !latestCapabilities.includes('WEBSITE_CONTENT')) continue;
            await this.persistCommerceRecord(tx, job.organizationId, link.id, job.connectorInstanceId, category, record);
            continue;
          }
          await this.persistCommerceRecord(tx, job.organizationId, link.id, job.connectorInstanceId, undefined, record);
        }
        // A product list is authoritative only after all top-level and nested pages completed.
        // syncedAt is refreshed by every persisted page, so records older than job creation were
        // not observed in this full snapshot. Concurrent/newer records are deliberately retained.
        if (isCompleteAuthoritativeProductSnapshot({ connectorId: job.connector.connectorId, resourceType: job.resourceType, mode: job.mode, complete: result.complete }) && link) {
          await tx.commerceProduct.updateMany({
            where: { organizationId: job.organizationId, connectionId: link.id, syncedAt: { lt: job.createdAt } },
            data: { rawStatus: 'DELETED', syncedAt: new Date() },
          });
        }
        await tx.connectorSyncJob.updateMany({ where: { id: job.id, state: 'RUNNING', leaseToken: lease.token }, data: { state: result.complete ? 'SUCCEEDED' : 'PENDING', cursor: result.complete ? null : result.cursor ?? null, checkpoint: checkpointAfter as any, itemCount: { increment: result.itemCount }, scheduledAt: new Date(), leaseToken: null, leaseUntil: null, lastErrorCode: null, ...(result.complete ? { finishedAt: new Date() } : {}) } });
        if (link) await tx.integrationConnection.update({ where: { id_organizationId: { id: link.id, organizationId: job.organizationId } }, data: { lastSyncAt: new Date(), ...(result.complete ? { lastSuccessfulSyncAt: new Date(), lastErrorCode: null } : {}) } });
      }, { timeout: 20000, maxWait: 5000 });
      debug(stage, { recordCount: result.records?.length ?? 0, itemCount: result.itemCount, state: cancelledForPermission ? 'CANCELLED' : result.complete ? 'SUCCEEDED' : 'PENDING' });
    } catch (error) {
      debug(stage, { resourceType: job.resourceType }, error);
      await this.retrySync(job, lease.token, boundedError(error));
    }
  }
  private async persistCommerceRecord(tx: any, organizationId: string, connectionId: string, connectorInstanceId: string, connectorDataCategory: string | undefined, record: any) {
    const now = new Date();
    if (record.kind === 'PRODUCT_DELETE') {
      const eventAt = record.eventAt instanceof Date ? record.eventAt : record.eventAt ? new Date(record.eventAt) : null;
      const validEventTime = eventAt && Number.isFinite(eventAt.getTime()) ? eventAt : null;
      await tx.commerceProduct.updateMany({ where: { organizationId, connectionId, externalId: String(record.externalId).slice(0, 255), ...(validEventTime ? { OR: [{ externalUpdatedAt: null }, { externalUpdatedAt: { lte: validEventTime } }] } : {}) }, data: { rawStatus: 'DELETED', ...(validEventTime ? { externalUpdatedAt: validEventTime } : {}), syncedAt: now } });
      return;
    }
    if (record.kind === 'PRODUCT') {
      const externalId = String(record.externalId).slice(0, 255);
      const incomingUpdatedAt = record.updatedAt ? new Date(record.updatedAt) : null;
      const existingProduct = await tx.commerceProduct.findFirst({ where: { organizationId, connectionId, externalId }, select: { externalUpdatedAt: true, rawStatus: true } });
      if (incomingUpdatedAt && Number.isFinite(incomingUpdatedAt.getTime()) && existingProduct?.externalUpdatedAt && (existingProduct.externalUpdatedAt > incomingUpdatedAt || (existingProduct.rawStatus === 'DELETED' && existingProduct.externalUpdatedAt >= incomingUpdatedAt))) {
        // The provider did return this identifier in the snapshot, so keep it seen for
        // reconciliation without replacing the newer stored business values.
        await tx.commerceProduct.updateMany({ where: { organizationId, connectionId, externalId }, data: { syncedAt: now } });
        return;
      }
      const data = { organizationId, connectionId, externalId, name: String(record.name).slice(0,500), description: typeof record.description === 'string' ? record.description.slice(0,50000) : null, sku: typeof record.sku === 'string' ? record.sku.slice(0,160) : null, category: typeof record.category === 'string' ? record.category.slice(0,200) : null, productType: typeof record.productType === 'string' ? record.productType.slice(0,200) : null, taxonomyCategoryId: typeof record.taxonomyCategoryId === 'string' ? record.taxonomyCategoryId.slice(0,255) : null, taxonomyCategory: typeof record.taxonomyCategory === 'string' ? record.taxonomyCategory.slice(0,500) : null, collections: Array.isArray(record.collections) ? record.collections.slice(0,500).filter((item:any) => item && typeof item.externalId === 'string' && typeof item.title === 'string').map((item:any) => ({ externalId: item.externalId.slice(0,255), title: item.title.slice(0,200), handle: typeof item.handle === 'string' ? item.handle.slice(0,255) : null, membershipType: ['MANUAL','AUTOMATED'].includes(item.membershipType) ? item.membershipType : 'UNKNOWN' })) : [], collectionSearchTerms: Array.isArray(record.collections) ? [...new Set(record.collections.flatMap((item:any) => [item?.title, item?.handle]).filter((label:any): label is string => typeof label === 'string').flatMap((label:string) => label.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((term:string) => term.length > 1))].slice(0,2000) : [], vendor: typeof record.vendor === 'string' ? record.vendor.slice(0,200) : null, handle: typeof record.handle === 'string' ? record.handle.slice(0,255) : null, currency: /^[A-Z]{3}$/.test(record.currency ?? '') ? record.currency : null, price: record.price ?? null, compareAtPrice: record.compareAtPrice ?? null, createdAtSource: record.createdAt ? new Date(record.createdAt) : null, inventory: Number.isInteger(record.inventory) ? record.inventory : null, availabilityStatus: typeof record.availability === 'string' ? record.availability.slice(0,40) : null, rawStatus: typeof record.status === 'string' ? record.status.slice(0,80) : null, productUrl: this.safeUrl(record.productUrl), imageUrl: this.safeUrl(record.imageUrl), imageAltText: typeof record.imageAltText === 'string' ? record.imageAltText.slice(0,500) : null, imageWidth: Number.isInteger(record.imageWidth) && record.imageWidth > 0 && record.imageWidth < 100000 ? record.imageWidth : null, imageHeight: Number.isInteger(record.imageHeight) && record.imageHeight > 0 && record.imageHeight < 100000 ? record.imageHeight : null, imageEvidence: Array.isArray(record.imageEvidence) ? record.imageEvidence.slice(0,1000).flatMap((image:any) => { const url = this.safeUrl(image?.url); return url ? [{ externalId: typeof image.externalId === 'string' ? image.externalId.slice(0,255) : null, url, altText: typeof image.altText === 'string' ? image.altText.slice(0,500) : null, width: Number.isInteger(image.width) && image.width > 0 && image.width < 100000 ? image.width : null, height: Number.isInteger(image.height) && image.height > 0 && image.height < 100000 ? image.height : null }] : []; }) : [], externalUpdatedAt: incomingUpdatedAt && Number.isFinite(incomingUpdatedAt.getTime()) ? incomingUpdatedAt : null, syncedAt: now };
      const product = await tx.commerceProduct.upsert({ where: { connectionId_externalId: { connectionId, externalId: data.externalId } }, create: data, update: data, select: { id: true } });
      const variants = Array.isArray(record.variants) ? record.variants.slice(0,1000) : [];
      for (const variant of variants) await tx.commerceProductVariant.upsert({ where: { productId_externalId: { productId: product.id, externalId: String(variant.externalId).slice(0,255) } }, create: { productId: product.id, externalId: String(variant.externalId).slice(0,255), title: String(variant.title ?? 'Variant').slice(0,500), sku: typeof variant.sku === 'string' ? variant.sku.slice(0,160) : null, currency: /^[A-Z]{3}$/.test(variant.currency ?? '') ? variant.currency : data.currency, price: variant.price ?? null, compareAtPrice: variant.compareAtPrice ?? null, selectedOptions: Array.isArray(variant.selectedOptions) ? variant.selectedOptions.slice(0,20).map((o:any) => ({ name: String(o.name ?? '').slice(0,100), value: String(o.value ?? '').slice(0,200) })) : [], inventory: Number.isInteger(variant.inventory) ? variant.inventory : null, availabilityStatus: typeof variant.availability === 'string' ? variant.availability.slice(0,40) : null, rawStatus: typeof variant.status === 'string' ? variant.status.slice(0,80) : data.rawStatus }, update: { title: String(variant.title ?? 'Variant').slice(0,500), sku: typeof variant.sku === 'string' ? variant.sku.slice(0,160) : null, currency: /^[A-Z]{3}$/.test(variant.currency ?? '') ? variant.currency : data.currency, price: variant.price ?? null, compareAtPrice: variant.compareAtPrice ?? null, selectedOptions: Array.isArray(variant.selectedOptions) ? variant.selectedOptions.slice(0,20).map((o:any) => ({ name: String(o.name ?? '').slice(0,100), value: String(o.value ?? '').slice(0,200) })) : [], inventory: Number.isInteger(variant.inventory) ? variant.inventory : null, availabilityStatus: typeof variant.availability === 'string' ? variant.availability.slice(0,40) : null, rawStatus: typeof variant.status === 'string' ? variant.status.slice(0,80) : data.rawStatus } });
      if (record.variantsComplete === true) await tx.commerceProductVariant.deleteMany({ where: { productId: product.id, ...(variants.length ? { externalId: { notIn: variants.map((v:any) => String(v.externalId).slice(0,255)) } } : {}) } });
      return;
    }
    if (record.kind === 'ORDER') {
      const data = { organizationId, connectionId, externalId: String(record.externalId).slice(0,255), displayReference: typeof record.displayReference === 'string' ? record.displayReference.slice(0,160) : null, customerReference: null, financialStatus: typeof record.financialStatus === 'string' ? record.financialStatus.slice(0,80) : null, fulfillmentStatus: typeof record.fulfillmentStatus === 'string' ? record.fulfillmentStatus.slice(0,80) : null, currency: /^[A-Z]{3}$/.test(record.currency ?? '') ? record.currency : null, subtotal: record.subtotal ?? null, discountTotal: record.discountTotal ?? null, shippingTotal: record.shippingTotal ?? null, taxTotal: record.taxTotal ?? null, total: record.total ?? null, refundedTotal: record.refundedTotal ?? null, orderedAt: record.orderedAt ? new Date(record.orderedAt) : null, externalUpdatedAt: record.updatedAt ? new Date(record.updatedAt) : null, rawStatus: typeof record.status === 'string' ? record.status.slice(0,100) : null, syncedAt: now };
      const existingOrder = await tx.commerceOrder.findFirst({ where: { organizationId, connectionId, externalId: data.externalId }, select: { externalUpdatedAt: true } });
      if (data.externalUpdatedAt && existingOrder?.externalUpdatedAt && existingOrder.externalUpdatedAt > data.externalUpdatedAt) return;
      const order = await tx.commerceOrder.upsert({ where: { connectionId_externalId: { connectionId, externalId: data.externalId } }, create: data, update: data, select: { id: true } });
      const lines = Array.isArray(record.lines) ? record.lines.slice(0,1000) : [];
      for (const line of lines) await tx.commerceOrderLine.upsert({ where: { orderId_externalId: { orderId: order.id, externalId: String(line.externalId).slice(0,255) } }, create: { orderId: order.id, externalId: String(line.externalId).slice(0,255), productExternalId: typeof line.productExternalId === 'string' ? line.productExternalId.slice(0,255) : null, name: String(line.name ?? 'Item').slice(0,500), sku: typeof line.sku === 'string' ? line.sku.slice(0,160) : null, quantity: Number.isInteger(line.quantity) ? Math.max(0,line.quantity) : 0, currency: /^[A-Z]{3}$/.test(line.currency ?? '') ? line.currency : data.currency, unitPrice: line.unitPrice ?? null, total: line.total ?? null }, update: { productExternalId: typeof line.productExternalId === 'string' ? line.productExternalId.slice(0,255) : null, name: String(line.name ?? 'Item').slice(0,500), sku: typeof line.sku === 'string' ? line.sku.slice(0,160) : null, quantity: Number.isInteger(line.quantity) ? Math.max(0,line.quantity) : 0, currency: /^[A-Z]{3}$/.test(line.currency ?? '') ? line.currency : data.currency, unitPrice: line.unitPrice ?? null, total: line.total ?? null } });
      if (record.linesComplete === true) await tx.commerceOrderLine.deleteMany({ where: { orderId: order.id, ...(lines.length ? { externalId: { notIn: lines.map((line:any) => String(line.externalId).slice(0,255)) } } : {}) } });
      return;
    }
    if (record.kind === 'KNOWLEDGE') {
      const externalId = String(record.externalId).slice(0, 255);
      const canonicalKey = `connector_${createHash('sha256').update(`${connectionId}:${externalId}`).digest('hex').slice(0, 64)}`;
      const current = await tx.knowledgeSource.findFirst({ where: { organizationId, canonicalKey }, select: { id: true, status: true, sourceVersion: true, name: true, description: true, contentBody: true, category: true, sourceUrl: true, languageHint: true, visibility: true, connectorInstanceId: true, connectorDataCategory: true } });
      if (record.deleted === true) {
        if (current && current.status !== 'ARCHIVED') {
          await tx.knowledgeProcessingJob.updateMany({ where: { organizationId, sourceId: current.id, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'CANCELLED', errorCode: 'CONNECTOR_SOURCE_DELETED', leaseOwner: null, leasedAt: null, heartbeatAt: null } });
          await tx.knowledgeSource.update({ where: { id_organizationId: { id: current.id, organizationId } }, data: { status: 'ARCHIVED', deletedAt: now, processingStatus: 'NOT_PROCESSED', lastSyncAt: now, lastSuccessfulSyncAt: now } });
        }
        return;
      }
      const contentBody = `${String(record.title).trim()}\n\n${String(record.content).slice(0, 48000)}${record.updatedAt ? `\n\nSource updated: ${new Date(record.updatedAt).toISOString()}` : ''}`.slice(0, 50000);
      const visibility = connectorDataCategory === 'SHOPIFY_METAOBJECTS' && record.visibility === 'PUBLIC_REFERENCE' ? 'PUBLIC_REFERENCE' : 'INTERNAL_RESTRICTED';
      const data = { name: String(record.title).trim().slice(0, 200), description: `Synchronized from connected integration ${connectionId}`, contentBody, category: typeof record.category === 'string' ? record.category.slice(0, 120) : null, connectorInstanceId, connectorDataCategory: connectorDataCategory ?? null, sourceUrl: this.safeUrl(record.sourceUrl), visibility, languageHint: typeof record.language === 'string' && /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(record.language) ? record.language.slice(0, 35) : null };
      if (!current) {
        const source = await tx.knowledgeSource.create({ data: { organizationId, type: 'TEXT', status: 'REGISTERED', processingStatus: 'QUEUED', canonicalKey, lastSyncAt: now, lastSuccessfulSyncAt: now, ...data }, select: { id: true, sourceVersion: true } });
        await tx.knowledgeProcessingJob.create({ data: { organizationId, sourceId: source.id, sourceVersion: source.sourceVersion, kind: 'INDEX', status: 'QUEUED' } });
      } else {
        const changed = current.status !== 'REGISTERED' || current.name !== data.name || current.description !== data.description || current.contentBody !== data.contentBody || current.category !== data.category || current.sourceUrl !== data.sourceUrl || current.languageHint !== data.languageHint || current.visibility !== data.visibility || current.connectorInstanceId !== connectorInstanceId || current.connectorDataCategory !== data.connectorDataCategory;
        if (!changed) { await tx.knowledgeSource.update({ where: { id_organizationId: { id: current.id, organizationId } }, data: { lastSyncAt: now, lastSuccessfulSyncAt: now, lastSyncErrorCode: null } }); return; }
        const sourceVersion = current.sourceVersion + 1;
        await tx.knowledgeProcessingJob.updateMany({ where: { organizationId, sourceId: current.id, status: { in: ['QUEUED', 'PROCESSING', 'RETRY_WAIT'] } }, data: { status: 'CANCELLED', errorCode: 'SOURCE_VERSION_CHANGED', leaseOwner: null, leasedAt: null, heartbeatAt: null } });
        await tx.knowledgeSource.update({ where: { id_organizationId: { id: current.id, organizationId } }, data: { ...data, status: 'REGISTERED', deletedAt: null, sourceVersion, processingStatus: 'QUEUED', processingErrorCode: null, semanticIndexStatus: 'NOT_CONFIGURED', semanticIndexErrorCode: null, lastSyncAt: now, lastSuccessfulSyncAt: now, lastSyncErrorCode: null } });
        await tx.knowledgeProcessingJob.create({ data: { organizationId, sourceId: current.id, sourceVersion, kind: 'INDEX', status: 'QUEUED' } });
      }
      return;
    }
    throw new Error('CONNECTOR_SYNC_RECORD_INVALID');
  }
  private safeUrl(value: unknown): string | null { if (typeof value !== 'string') return null; try { const url = new URL(value); return url.protocol === 'https:' ? url.toString().slice(0,2048) : null; } catch { return null; } }
  private async retrySync(job: any, token: string, code: string) {
    const maximum = Math.min(Math.max(Number(process.env.CONNECTOR_SYNC_MAX_ATTEMPTS ?? 8), 1), 20);
    const terminal = ['CONNECTOR_NESTED_PAGINATION_LIMIT', 'CONNECTOR_NESTED_PAGINATION_INCOMPLETE', 'CONNECTOR_CURSOR_INVALID', 'CONNECTOR_SYNC_CURSOR_INVALID', 'CONNECTOR_SYNC_RESULT_INVALID', 'CONNECTOR_PROVIDER_RESPONSE_INVALID', 'CONNECTOR_METAOBJECT_DEFINITION_NOT_PUBLIC', 'CONNECTOR_METAOBJECT_DEFINITION_LIMIT', 'CONNECTOR_METAOBJECT_FIELD_LIMIT'].includes(code);
    const baseDelay = Math.min(3600000, 1000 * (2 ** Math.min(job.attemptCount, 12)));
    const exhausted = terminal || job.attemptCount >= maximum, delay = Math.floor(baseDelay * (0.8 + Math.random() * 0.4));
    await this.db.connectorSyncJob.updateMany({ where: { id: job.id, state: 'RUNNING', leaseToken: token }, data: { state: exhausted ? 'FAILED' : 'RETRY_WAIT', scheduledAt: new Date(Date.now() + delay), lastErrorCode: code, leaseToken: null, leaseUntil: null, ...(exhausted ? { finishedAt: new Date() } : {}) } });
    if (exhausted) { await this.db.connectorInstance.updateMany({ where: { id: job.connectorInstanceId, organizationId: job.organizationId, state: 'CONNECTED' }, data: { state: 'DEGRADED', lastErrorCode: code } }); const c=await this.db.connectorInstance.findFirst({where:{id:job.connectorInstanceId,organizationId:job.organizationId},select:{integrationConnectionId:true}}); if(c?.integrationConnectionId)await this.db.integrationConnection.updateMany({where:{id:c.integrationConnectionId,organizationId:job.organizationId},data:{state:'CONNECTED_WITH_WARNINGS',lastErrorCode:code,lastSyncAt:new Date()}}); }
  }
  private async cancelSync(id: string, token: string) { await this.db.connectorSyncJob.updateMany({ where: { id, state: 'RUNNING', leaseToken: token }, data: { state: 'CANCELLED', finishedAt: new Date(), leaseToken: null, leaseUntil: null } }); }

  private async processWebhook(lease: { id: string; token: string }) {
    const event = await this.db.connectorWebhookEvent.findFirst({ where: { id: lease.id, state: 'PROCESSING', leaseToken: lease.token }, include: { connector: { include: { credential: true } } } });
    if (!event) return;
    if (event.connector.state !== 'CONNECTED' || !event.connector.credential) return this.failWebhook(event, lease.token, 'CONNECTOR_DISCONNECTED');
    try {
      const adapter = this.registry.adapter(event.connector.connectorId);
      const credentials = this.vault.decrypt(event.connector.credential, `carteio:connector:${event.organizationId}:${event.connectorInstanceId}:${event.connector.connectorId}`);
      const decrypted = this.vault.decrypt({ ciphertext: event.rawBodyCiphertext, nonce: event.rawBodyNonce, authTag: event.rawBodyAuthTag, keyVersion: event.rawBodyKeyVersion }, `carteio:webhook:${event.organizationId}:${event.connectorInstanceId}:${event.externalEventId}`);
      const rawBody = Buffer.from(String(decrypted.body), 'base64'), payload = JSON.parse(rawBody.toString('utf8'));
      const eventTime = event.triggeredAt instanceof Date ? event.triggeredAt : event.receivedAt;
      await adapter.handleWebhook({ organizationId: event.organizationId, connectorInstanceId: event.connectorInstanceId }, { eventId: event.externalEventId, eventType: event.eventType, timestamp: Math.floor(eventTime.getTime() / 1000), rawBody, payload }, event.connector.configuration as Record<string, unknown>, credentials);
      await this.db.connectorWebhookEvent.updateMany({ where: { id: event.id, state: 'PROCESSING', leaseToken: lease.token }, data: { state: 'PROCESSED', processedAt: new Date(), leaseToken: null, leaseUntil: null, lastErrorCode: null } });
    } catch (error) { await this.failWebhook(event, lease.token, boundedError(error)); }
  }
  private async failWebhook(event: any, token: string, code: string) {
    const maximum = Math.min(Math.max(Number(process.env.CONNECTOR_SYNC_MAX_ATTEMPTS ?? 8), 1), 20), exhausted = event.attemptCount >= maximum;
    const baseDelay = Math.min(3600000, 1000 * (2 ** Math.min(event.attemptCount, 12)));
    const delay = Math.floor(baseDelay * (0.8 + Math.random() * 0.4));
    await this.db.connectorWebhookEvent.updateMany({ where: { id: event.id, state: 'PROCESSING', leaseToken: token }, data: { state: exhausted ? 'FAILED' : 'RECEIVED', nextAttemptAt: new Date(Date.now() + delay), lastErrorCode: code, leaseToken: null, leaseUntil: null } });
  }
}
