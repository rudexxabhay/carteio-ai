import { createHash } from 'node:crypto';
import { ConnectorSyncWorker, isCompleteAuthoritativeProductSnapshot, validateConnectorSyncPage } from './connector-sync-worker.service';

describe('ConnectorSyncWorker lease behavior', () => {
  it('reconciles missing products only after a complete full Shopify product snapshot', () => {
    expect(isCompleteAuthoritativeProductSnapshot({ connectorId: 'shopify_v1', resourceType: 'PRODUCTS', mode: 'FULL', complete: true })).toBe(true);
    expect(isCompleteAuthoritativeProductSnapshot({ connectorId: 'shopify_v1', resourceType: 'PRODUCTS', mode: 'FULL', complete: false })).toBe(false);
    expect(isCompleteAuthoritativeProductSnapshot({ connectorId: 'shopify_v1', resourceType: 'PRODUCTS', mode: 'INCREMENTAL', complete: true })).toBe(false);
  });
  it('rejects an incomplete page whose cursor is repeated in its persisted checkpoint trail', () => {
    const previousCursor = 'replayed-page';
    const hash = createHash('sha256').update(previousCursor).digest('hex');
    expect(() => validateConnectorSyncPage({ itemCount: 0, records: [], cursor: previousCursor, complete: false }, 'shopify_v1', 'different-page', [hash])).toThrow('CONNECTOR_SYNC_CURSOR_INVALID');
  });
  it('refuses to persist Shopify product records whose image page is incomplete', () => {
    expect(() => validateConnectorSyncPage({ itemCount: 1, records: [{ kind: 'PRODUCT', variantsComplete: true, imagesComplete: false }], complete: true }, 'shopify_v1')).toThrow('CONNECTOR_NESTED_PAGINATION_INCOMPLETE');
  });
  it('accepts a complete Shopify product page with complete variants and images', () => {
    expect(() => validateConnectorSyncPage({ itemCount: 1, records: [{ kind: 'PRODUCT', variantsComplete: true, imagesComplete: true }], complete: true }, 'shopify_v1')).not.toThrow();
  });
  it('locks the tenant-scoped Shopify connector before checking a leased sync for publication', async () => {
    const now = new Date();
    const job = {
      id: 'job-a', organizationId: 'tenant-a', connectorInstanceId: 'connector-a',
      resourceType: 'PRODUCTS', mode: 'INCREMENTAL', cursor: null, checkpoint: null,
      connector: {
        connectorId: 'shopify_v1', state: 'CONNECTED', credential: { id: 'credential-a' },
        configuration: { shopDomain: 'store.myshopify.com' }, verifiedCapabilities: ['PRODUCT_CATALOG'],
        lastVerifiedAt: now, commerceConnection: { state: 'CONNECTED', grantedScopes: ['read_products'], grantedScopesVerifiedAt: now },
      },
    };
    const lock = jest.fn().mockResolvedValue([{ id: 'connector-a' }]);
    const leaseCheck = jest.fn().mockResolvedValue(null);
    const tx: any = { $queryRaw: lock, connectorSyncJob: { findFirst: leaseCheck } };
    const db: any = {
      connectorSyncJob: { findFirst: jest.fn().mockResolvedValue(job) },
      connectorDataPermission: { findMany: jest.fn().mockResolvedValue([{ category: 'PRODUCTS' }]) },
      $transaction: jest.fn((callback: any) => callback(tx)),
    };
    const adapter = { sync: jest.fn().mockResolvedValue({ records: [], itemCount: 0, complete: true }) };
    const worker = new ConnectorSyncWorker(db, { adapter: jest.fn().mockReturnValue(adapter), assertResourceSupport: jest.fn() } as any, { decrypt: jest.fn().mockReturnValue({ accessToken: 'opaque' }) } as any);

    await worker['processSync']({ id: 'job-a', token: 'lease-a' });

    expect(lock).toHaveBeenCalledTimes(1);
    expect(leaseCheck).toHaveBeenCalledTimes(1);
    expect(lock.mock.invocationCallOrder[0]!).toBeLessThan(leaseCheck.mock.invocationCallOrder[0]!);
    expect(leaseCheck).toHaveBeenCalledWith({ where: { id: 'job-a', state: 'RUNNING', leaseToken: 'lease-a' }, select: { id: true } });
  });
  it('claims only due, connected tenant-scoped work with PostgreSQL skip-locked semantics', async () => {
    const tx: any = { $queryRaw: jest.fn().mockResolvedValue([]) };
    const prisma: any = { $transaction: jest.fn((callback: any) => callback(tx)) };
    const worker = new ConnectorSyncWorker(prisma, {} as any, {} as any);
    const claimed = await worker['claimSyncJobs'](new Date(), 10);
    expect(claimed).toEqual([]);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const sql = tx.$queryRaw.mock.calls[0]?.[0].join(' ');
    expect(sql).toContain('SKIP LOCKED');
    expect(sql).toContain('organizationId');
    expect(sql).toContain('CONNECTED');
  });

  it('enqueues a due refresh policy once and advances its persisted schedule', async () => {
    const now = new Date('2026-10-17T12:00:00Z');
    const schedule = { id: 'schedule-1', organizationId: 'tenant-a', connectorInstanceId: 'connector-a', resourceType: 'PRODUCTS', mode: 'INCREMENTAL', intervalMinutes: 360, nextRunAt: new Date('2026-10-17T11:00:00Z'), connector: { state: 'CONNECTED', connectorId: 'business_api', verifiedCapabilities: ['PRODUCT_CATALOG'] } };
    const tx: any = { connectorSyncSchedule: { findFirst: jest.fn().mockResolvedValue({ id: schedule.id }), update: jest.fn() }, connectorSyncJob: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn() } };
    const db: any = { connectorSyncSchedule: { findMany: jest.fn().mockResolvedValue([schedule]) }, connectorDataPermission: { findMany: jest.fn().mockResolvedValue([{ organizationId: 'tenant-a', connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]) }, $transaction: jest.fn((callback: any) => callback(tx)) };
    const worker = new ConnectorSyncWorker(db, {} as any, {} as any);
    await expect(worker['enqueueScheduledSyncs'](now, 10)).resolves.toBe(1);
    expect(tx.connectorSyncJob.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ organizationId: 'tenant-a', connectorInstanceId: 'connector-a', resourceType: 'PRODUCTS', state: 'PENDING' }) }));
    expect(tx.connectorSyncSchedule.update).toHaveBeenCalledWith({ where: { id: schedule.id }, data: { lastRunAt: now, nextRunAt: new Date(now.getTime() + 360 * 60_000) } });
  });

  it('does not enqueue scheduled Shopify work when the verified grant snapshot is stale', async () => {
    const now = new Date();
    const schedule = { id: 'schedule-2', organizationId: 'tenant-a', connectorInstanceId: 'shop-a', resourceType: 'PRODUCTS', mode: 'INCREMENTAL', intervalMinutes: 1440, nextRunAt: new Date(now.getTime() - 1000), connector: { state: 'CONNECTED', connectorId: 'shopify_v1', verifiedCapabilities: ['PRODUCT_CATALOG'], lastVerifiedAt: new Date(now.getTime() - 10 * 86_400_000), commerceConnection: { grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date(now.getTime() - 10 * 86_400_000) } } };
    const tx: any = { connectorSyncSchedule: { findFirst: jest.fn().mockResolvedValue({ id: schedule.id }), update: jest.fn() }, connectorSyncJob: { findFirst: jest.fn(), upsert: jest.fn() } };
    const db: any = { connectorSyncSchedule: { findMany: jest.fn().mockResolvedValue([schedule]) }, connectorDataPermission: { findMany: jest.fn().mockResolvedValue([{ organizationId: 'tenant-a', connectorInstanceId: 'shop-a', category: 'PRODUCTS' }]) }, $transaction: jest.fn((callback: any) => callback(tx)) };
    const worker = new ConnectorSyncWorker(db, {} as any, {} as any);
    await expect(worker['enqueueScheduledSyncs'](now, 10)).resolves.toBe(0);
    expect(tx.connectorSyncJob.upsert).not.toHaveBeenCalled();
    expect(tx.connectorSyncSchedule.update).toHaveBeenCalled();
  });

  it('does not create another scheduled job while the resource already has active work', async () => {
    const now = new Date();
    const schedule = { id: 'schedule-3', organizationId: 'tenant-a', connectorInstanceId: 'connector-a', resourceType: 'PRODUCTS', mode: 'INCREMENTAL', intervalMinutes: 60, nextRunAt: new Date(now.getTime() - 1000), connector: { state: 'CONNECTED', connectorId: 'business_api', verifiedCapabilities: ['PRODUCT_CATALOG'] } };
    const tx: any = { connectorSyncSchedule: { findFirst: jest.fn().mockResolvedValue({ id: schedule.id }), update: jest.fn() }, connectorSyncJob: { findFirst: jest.fn().mockResolvedValue({ id: 'already-running' }), upsert: jest.fn() } };
    const db: any = { connectorSyncSchedule: { findMany: jest.fn().mockResolvedValue([schedule]) }, connectorDataPermission: { findMany: jest.fn().mockResolvedValue([{ organizationId: 'tenant-a', connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]) }, $transaction: jest.fn((callback: any) => callback(tx)) };
    const worker = new ConnectorSyncWorker(db, {} as any, {} as any);
    await expect(worker['enqueueScheduledSyncs'](now, 10)).resolves.toBe(0);
    expect(tx.connectorSyncJob.upsert).not.toHaveBeenCalled();
  });

  it('persists normalized Shopify product and variants idempotently with bounded safe image evidence', async () => {
    const tx: any = { commerceProduct: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({ id: 'db-product' }) }, commerceProductVariant: { upsert: jest.fn(), deleteMany: jest.fn() } };
    const worker = new ConnectorSyncWorker({} as any, {} as any, {} as any);
    await worker['persistCommerceRecord'](tx, 'tenant-a', 'connection-a', 'connector-a', undefined, { kind: 'PRODUCT', externalId: 'gid://shopify/Product/1', name: 'Tee', productType: 'Clothing', taxonomyCategoryId: 'gid://shopify/TaxonomyCategory/1', taxonomyCategory: 'Apparel', collections: [{ externalId: 'gid://shopify/Collection/1', title: 'Summer', membershipType: 'MANUAL' }], price: '10.00', compareAtPrice: '12.00', currency: 'USD', imageEvidence: [{ url: 'https://cdn.example/tee.jpg', width: 400, height: 400 }], variants: [{ externalId: 'gid://shopify/ProductVariant/1', title: 'Blue / M', sku: 'TEE-M', selectedOptions: [{ name: 'Size', value: 'M' }], price: '10.00', compareAtPrice: '12.00', currency: 'USD' }], variantsComplete: true });
    expect(tx.commerceProduct.upsert.mock.calls[0][0].where).toEqual({ connectionId_externalId: { connectionId: 'connection-a', externalId: 'gid://shopify/Product/1' } });
    expect(tx.commerceProduct.upsert.mock.calls[0][0].create).toMatchObject({ organizationId: 'tenant-a', productType: 'Clothing', taxonomyCategoryId: 'gid://shopify/TaxonomyCategory/1', compareAtPrice: '12.00', collections: [{ title: 'Summer' }], imageEvidence: [{ url: 'https://cdn.example/tee.jpg' }] });
    expect(tx.commerceProductVariant.upsert.mock.calls[0][0].create).toMatchObject({ productId: 'db-product', externalId: 'gid://shopify/ProductVariant/1', compareAtPrice: '12.00', selectedOptions: [{ name: 'Size', value: 'M' }] });
    expect(tx.commerceProductVariant.deleteMany).toHaveBeenCalledWith({ where: { productId: 'db-product', externalId: { notIn: ['gid://shopify/ProductVariant/1'] } } });
  });

  it('does not let an older Shopify product update overwrite a newer persisted version', async () => {
    const newer = new Date('2026-10-17T12:00:00Z');
    const tx: any = { commerceProduct: { findFirst: jest.fn().mockResolvedValue({ externalUpdatedAt: newer, rawStatus: 'ACTIVE' }), updateMany: jest.fn(), upsert: jest.fn() } };
    const worker = new ConnectorSyncWorker({} as any, {} as any, {} as any);
    await worker['persistCommerceRecord'](tx, 'tenant-a', 'connection-a', 'connector-a', undefined, { kind: 'PRODUCT', externalId: 'gid://shopify/Product/1', name: 'Old title', updatedAt: '2026-10-17T11:00:00Z' });
    expect(tx.commerceProduct.upsert).not.toHaveBeenCalled();
  });

  it('does not revive a product with an update at or before its delete watermark', async () => {
    const deletedAt = new Date('2026-10-17T12:00:00Z');
    const tx: any = { commerceProduct: { findFirst: jest.fn().mockResolvedValue({ externalUpdatedAt: deletedAt, rawStatus: 'DELETED' }), updateMany: jest.fn(), upsert: jest.fn() } };
    const worker = new ConnectorSyncWorker({} as any, {} as any, {} as any);
    await worker['persistCommerceRecord'](tx, 'tenant-a', 'connection-a', 'connector-a', undefined, { kind: 'PRODUCT', externalId: 'gid://shopify/Product/1', name: 'Delayed update', updatedAt: deletedAt.toISOString() });
    expect(tx.commerceProduct.upsert).not.toHaveBeenCalled();
  });

  it('marks a provider-deleted product unavailable for retrieval within its tenant connection', async () => {
    const tx: any = { commerceProduct: { updateMany: jest.fn() } };
    const worker = new ConnectorSyncWorker({} as any, {} as any, {} as any);
    await worker['persistCommerceRecord'](tx, 'tenant-a', 'connection-a', 'connector-a', undefined, { kind: 'PRODUCT_DELETE', externalId: 'gid://shopify/Product/1' });
    expect(tx.commerceProduct.updateMany).toHaveBeenCalledWith({ where: { organizationId: 'tenant-a', connectionId: 'connection-a', externalId: 'gid://shopify/Product/1' }, data: { rawStatus: 'DELETED', syncedAt: expect.any(Date) } });
  });
});
