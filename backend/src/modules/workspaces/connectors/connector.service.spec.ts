import { CONNECTOR_DATA_CATEGORIES, ConnectorService } from './connector.service';

describe('ConnectorService tenant and verification boundaries', () => {
  const workspace = { requireAccess: jest.fn() }, registry = { catalog: jest.fn(), capabilitiesFor: jest.fn(), validateConfiguration: jest.fn(), adapter: jest.fn(), assertResourceSupport: jest.fn() }, vault = { encrypt: jest.fn(), decrypt: jest.fn() };
  const db: any = { connectorInstance: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(), create: jest.fn(), findMany: jest.fn() }, connectorCredential: { findFirst: jest.fn(), deleteMany: jest.fn() }, connectorSyncJob: { updateMany: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), upsert: jest.fn() }, integrationConnection: { updateMany: jest.fn() }, commerceProduct: { deleteMany: jest.fn(), updateMany: jest.fn() }, commerceProductVariant: { updateMany: jest.fn() }, commerceOrder: { deleteMany: jest.fn() }, connectorDataPermission: { createMany: jest.fn(), findFirst: jest.fn() }, assistantConnectorDataPermission: { createMany: jest.fn(), upsert: jest.fn() }, chatbot: { findMany: jest.fn(), findFirst: jest.fn() }, knowledgeSource: { findMany: jest.fn(), updateMany: jest.fn() }, knowledgeChunk: { deleteMany: jest.fn() }, knowledgeProcessingJob: { updateMany: jest.fn() }, auditEvent: { create: jest.fn() }, $queryRaw: jest.fn().mockResolvedValue([{ requestCount: 1 }]), $transaction: jest.fn((callback: any) => callback(db)) };
  const scopeDiscovery = { discover: jest.fn() };
  const service = new ConnectorService(db, workspace as any, registry as any, vault as any, scopeDiscovery as any);

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.resetAllMocks();
    db.$queryRaw.mockResolvedValue([{ requestCount: 1 }]);
    db.$transaction.mockImplementation((callback: any) => callback(db));
  });
  const prepareVerification = () => {
    const claimedAt = new Date('2026-10-16T12:00:00.000Z');
    const row = { id: 'connector-a', organizationId: 'tenant-a', connectorId: 'shopify_v1', connectorType: 'SHOPIFY', connectorVersion: '1.0.0', displayName: 'Store', configuration: { shopDomain: 'store.myshopify.com' }, state: 'DRAFT', verifiedCapabilities: [], integrationConnectionId: 'commerce-a', webhookPublicId: null, updatedAt: new Date('2026-10-16T11:59:00.000Z'), credential: { id: 'credential-a' } };
    const adapter = { definition: { id: 'shopify_v1', capabilities: ['CONNECTOR_HEALTH_CHECK', 'PRODUCT_CATALOG', 'PRODUCT_PRICES', 'INVENTORY', 'ORDERS', 'FULFILLMENT'], webhooks: { supported: true } }, connect: jest.fn(), verify: jest.fn().mockResolvedValue({ verified: true, externalAccountId: 'gid://shopify/Shop/1', grantedScopes: ['read_products', 'read_inventory', 'read_orders'], grantedScopeMetadata: [{ handle: 'read_products', description: 'Read products' }], capabilities: ['CONNECTOR_HEALTH_CHECK', 'PRODUCT_CATALOG', 'PRODUCT_PRICES', 'INVENTORY', 'ORDERS', 'FULFILLMENT'] }) };
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    registry.adapter.mockReturnValue(adapter);
    vault.decrypt.mockReturnValue({ accessToken: 'opaque-token-value-12345' });
    db.connectorInstance.findFirst.mockResolvedValueOnce(row).mockResolvedValueOnce({ updatedAt: claimedAt }).mockResolvedValueOnce({ ...row, state: 'CONNECTED', verifiedCapabilities: adapter.definition.capabilities, updatedAt: claimedAt });
    db.connectorInstance.updateMany.mockResolvedValue({ count: 1 });
    db.connectorSyncJob.updateMany.mockResolvedValue({ count: 0 });
    db.integrationConnection.updateMany.mockResolvedValue({ count: 1 });
    db.connectorDataPermission.createMany.mockResolvedValue({ count: CONNECTOR_DATA_CATEGORIES.length });
    db.assistantConnectorDataPermission.createMany.mockResolvedValue({ count: 3 });
    db.chatbot.findMany.mockResolvedValue([{ id: 'assistant-a' }]);
    db.knowledgeSource.findMany.mockResolvedValue([]);
    db.knowledgeSource.updateMany.mockResolvedValue({ count: 0 });
    db.knowledgeChunk.deleteMany.mockResolvedValue({ count: 0 });
    db.knowledgeProcessingJob.updateMany.mockResolvedValue({ count: 0 });
    db.auditEvent.create.mockResolvedValue({});
    return { adapter, row };
  };
  it('scopes instance lookup to the organization returned by workspace authorization', async () => {
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    db.connectorInstance.findFirst.mockResolvedValue(null);
    await expect(service['instance']('tenant-a', 'instance-id')).rejects.toThrow();
    expect(db.connectorInstance.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'instance-id', organizationId: 'tenant-a' } }));
  });

  it('refuses to queue synchronization before genuine connector verification', async () => {
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    db.connectorInstance.findFirst.mockResolvedValue({ id: 'id', organizationId: 'tenant-a', state: 'DRAFT' });
    await expect(service.queueSync('user', 'workspace', 'id', { resourceType: 'products', mode: 'FULL', idempotencyKey: 'stable-key' })).rejects.toThrow();
  });

  it('returns a stable next cursor for tenant-scoped sync history pages', async () => {
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    db.connectorInstance.findFirst.mockResolvedValue({ id: 'connector-a', organizationId: 'tenant-a' });
    const createdAt = new Date('2026-10-20T10:00:00.000Z');
    const row = { id: '10000000-0000-4000-8000-000000000001', createdAt };
    db.connectorSyncJob.findMany.mockResolvedValue([row, { ...row, id: '10000000-0000-4000-8000-000000000002' }]);

    const result = await service.syncHistory('owner', 'workspace', 'connector-a', undefined, 1);

    expect(db.connectorSyncJob.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'tenant-a', connectorInstanceId: 'connector-a' }, take: 2 }));
    expect(result).toEqual({ items: [row], hasMore: true, nextCursor: `${createdAt.toISOString()}~${row.id}` });
  });

  it('keeps Shopify assistant order access disabled without verified customer ownership', async () => {
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    db.connectorInstance.findFirst.mockResolvedValue({ id: 'connector-a', connectorId: 'shopify_v1', integrationConnectionId: 'commerce-a' });
    db.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    await expect(service.updatePermission('user', 'workspace', 'connector-a', { category: 'ORDERS', enabled: true, assistantId: 'assistant-a' })).rejects.toMatchObject({ status: 403, response: expect.objectContaining({ code: 'SHOPIFY_AI_SENSITIVE_ACCESS_UNAVAILABLE' }) });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('does not infer requested or granted status from SHOPIFY_SCOPES', async () => {
    const previousScopes = process.env.SHOPIFY_SCOPES;
    process.env.SHOPIFY_SCOPES = 'read_products,read_inventory,read_orders';
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    db.connectorInstance.findFirst.mockResolvedValue({
      id: 'connector-a', organizationId: 'tenant-a', connectorId: 'shopify_v1', state: 'CONNECTED',
      configuration: { shopDomain: 'store.myshopify.com' }, verifiedCapabilities: ['PRODUCT_CATALOG'],
      commerceConnection: { state: 'CONNECTED', grantedScopes: ['read_products'], grantedScopeMetadata: [{ handle: 'read_products', description: 'Read products' }], grantedScopesVerifiedAt: new Date() },
      dataPermissions: [], assistantDataPermissions: [],
    });
    db.chatbot.findMany.mockResolvedValue([]);

    try {
      const result = await service.permissions('user-a', 'workspace-a', 'connector-a');
      const inventory = result.categories.find((category: any) => category.category === 'INVENTORY');
      expect(inventory).toMatchObject({ providerStatus: 'UNKNOWN', requested: null, providerGranted: false, effective: false, reauthorizationRequired: null });
      const shopifyScopeSnapshot = result.shopifyScopeSnapshot;
      if (!shopifyScopeSnapshot) throw new Error('Expected Shopify scope snapshot for Shopify connector.');
      expect(shopifyScopeSnapshot.scopes.map((scope: any) => scope.handle)).toEqual(['read_products']);
    } finally {
      if (previousScopes === undefined) delete process.env.SHOPIFY_SCOPES;
      else process.env.SHOPIFY_SCOPES = previousScopes;
    }
  });

  it('returns each customer organization’s own Shopify grant snapshot', async () => {
    workspace.requireAccess.mockImplementation(async (_user: string, slug: string) => ({ organizationId: slug === 'customer-a' ? 'tenant-a' : 'tenant-b' }));
    const connection = (organizationId: string, grantedScopes: string[]) => ({
      id: `connector-${organizationId}`, organizationId, connectorId: 'shopify_v1', state: 'CONNECTED',
      configuration: { shopDomain: `${organizationId}.myshopify.com` }, verifiedCapabilities: ['PRODUCT_CATALOG', 'INVENTORY'],
      commerceConnection: { state: 'CONNECTED', grantedScopes, grantedScopeMetadata: [], grantedScopesVerifiedAt: new Date() },
      dataPermissions: [], assistantDataPermissions: [], shopifyOAuthStates: [], integrationConnectionId: null,
    });
    db.connectorInstance.findFirst.mockResolvedValueOnce(connection('tenant-a', ['read_products'])).mockResolvedValueOnce(connection('tenant-b', ['read_inventory']));
    db.chatbot.findMany.mockResolvedValue([]);

    const customerA = await service.permissions('user-a', 'customer-a', 'connector-tenant-a');
    const customerB = await service.permissions('user-b', 'customer-b', 'connector-tenant-b');

    expect(customerA.shopifyScopeSnapshot?.scopes.map((scope: any) => scope.handle)).toEqual(['read_products']);
    expect(customerB.shopifyScopeSnapshot?.scopes.map((scope: any) => scope.handle)).toEqual(['read_inventory']);
    expect(db.connectorInstance.findFirst.mock.calls.map((call: any[]) => call[0].where.organizationId)).toEqual(['tenant-a', 'tenant-b']);
  });

  it('reflects assistant permission revocation in the Shopify permission response', async () => {
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    const assistantConnection = (enabled: boolean) => ({
      id: 'connector-a', organizationId: 'tenant-a', connectorId: 'shopify_v1', state: 'CONNECTED',
      configuration: { shopDomain: 'store.myshopify.com' }, verifiedCapabilities: ['PRODUCT_CATALOG'],
      commerceConnection: { state: 'CONNECTED', grantedScopes: ['read_products'], grantedScopeMetadata: [], grantedScopesVerifiedAt: new Date() },
      dataPermissions: [{ category: 'PRODUCTS', enabled: true, syncEnabled: true }],
      assistantDataPermissions: [{ category: 'PRODUCTS', enabled }], shopifyOAuthStates: [], integrationConnectionId: null,
    });
    db.connectorInstance.findFirst.mockResolvedValueOnce(assistantConnection(false)).mockResolvedValueOnce(assistantConnection(true));
    db.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });

    const disabled = await service.permissions('user-a', 'workspace-a', 'connector-a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    const enabled = await service.permissions('user-a', 'workspace-a', 'connector-a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    expect(disabled.categories.find((category: any) => category.category === 'PRODUCTS')).toMatchObject({ assistantEnabled: false, effective: false });
    expect(enabled.categories.find((category: any) => category.category === 'PRODUCTS')).toMatchObject({ assistantEnabled: true, effective: true });
  });

  it('saves the assistant-scoped product permission and returns the value read back from persisted state', async () => {
    const assistantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    const savedAssistantRows: Array<{ category: string; enabled: boolean }> = [];
    const persistedConnector = {
      id: 'connector-a', organizationId: 'tenant-a', connectorId: 'shopify_v1', state: 'CONNECTED',
      configuration: { shopDomain: 'store.myshopify.com' }, verifiedCapabilities: ['PRODUCT_CATALOG'],
      lastVerifiedAt: new Date(), integrationConnectionId: 'commerce-a',
      commerceConnection: { state: 'CONNECTED', grantedScopes: ['read_products'], grantedScopeMetadata: [], grantedScopesVerifiedAt: new Date() },
      dataPermissions: [{ category: 'PRODUCTS', enabled: true, syncEnabled: true }],
      get assistantDataPermissions() { return savedAssistantRows; }, shopifyOAuthStates: [],
    };
    db.connectorInstance.findFirst.mockResolvedValue(persistedConnector);
    db.chatbot.findFirst.mockResolvedValue({ id: assistantId });
    db.connectorDataPermission.findFirst.mockResolvedValue({ enabled: true });
    db.assistantConnectorDataPermission.upsert.mockImplementation(async (args: any) => {
      const row = { category: args.create.category, enabled: args.create.enabled };
      const index = savedAssistantRows.findIndex((entry) => entry.category === row.category);
      if (index < 0) savedAssistantRows.push(row); else savedAssistantRows[index] = row;
      return row;
    });
    db.commerceProduct.count = jest.fn().mockResolvedValue(1);
    db.commerceProductVariant.count = jest.fn().mockResolvedValue(1);
    db.commerceOrder.count = jest.fn().mockResolvedValue(0);
    db.knowledgeSource.count = jest.fn().mockResolvedValue(0);
    db.connectorSyncJob.findFirst.mockResolvedValue(null);
    db.auditEvent.create.mockResolvedValue({});
    const permissionsSnapshot = jest.spyOn(service, 'permissions');

    const updated = await service.updatePermission('user-a', 'workspace-a', 'connector-a', { category: 'PRODUCTS', enabled: true, assistantId });
    await service.updatePermission('user-a', 'workspace-a', 'connector-a', { category: 'PRODUCTS', enabled: true, assistantId });
    const refreshed = await service.permissions('user-a', 'workspace-a', 'connector-a', assistantId);

    expect(db.connectorInstance.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'connector-a', organizationId: 'tenant-a' } }));
    expect(db.assistantConnectorDataPermission.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId_connectorInstanceId_assistantId_category: { organizationId: 'tenant-a', connectorInstanceId: 'connector-a', assistantId, category: 'PRODUCTS' } } }));
    expect(db.assistantConnectorDataPermission.upsert).toHaveBeenCalledTimes(2);
    expect(permissionsSnapshot).toHaveBeenCalledTimes(3); // One post-commit snapshot per PATCH plus the explicit GET read below.
    expect(updated.categories.find((entry: any) => entry.category === 'PRODUCTS')?.assistantEnabled).toBe(true);
    expect(refreshed.categories.find((entry: any) => entry.category === 'PRODUCTS')).toMatchObject({ assistantEnabled: true, effective: true });
    expect(refreshed.shopifyScopeSnapshot?.operations.find((entry: any) => entry.category === 'PRODUCTS')).toMatchObject({ assistantPermissionGranted: true, eligible: true, dataStatus: 'QUERY_READY' });
  });

  it('rejects an assistant permission write when the assistant belongs to another workspace', async () => {
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    db.connectorInstance.findFirst.mockResolvedValue({ id: 'connector-a', connectorId: 'shopify_v1' });
    db.chatbot.findFirst.mockResolvedValue(null);

    await expect(service.updatePermission('user-a', 'workspace-a', 'connector-a', { category: 'PRODUCTS', enabled: true, assistantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })).rejects.toThrow('Assistant not found in this workspace.');
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.assistantConnectorDataPermission.upsert).not.toHaveBeenCalled();
  });

  it('does not build a successful permission response when the write transaction fails', async () => {
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    db.connectorInstance.findFirst.mockResolvedValue({
      id: 'connector-a', connectorId: 'shopify_v1', integrationConnectionId: null,
      verifiedCapabilities: ['PRODUCT_CATALOG'], commerceConnection: { grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date() },
    });
    db.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    db.connectorDataPermission.findFirst.mockResolvedValue({ enabled: true });
    db.$transaction.mockRejectedValueOnce(new Error('database write failed'));
    const permissionsRead = jest.spyOn(service, 'permissions');

    await expect(service.updatePermission('user-a', 'workspace-a', 'connector-a', { category: 'PRODUCTS', enabled: true, assistantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })).rejects.toThrow('database write failed');
    expect(permissionsRead).not.toHaveBeenCalled();
  });

  it('reports persisted Shopify record counts from tenant scoped storage queries', async () => {
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    const now = new Date();
    db.connectorInstance.findFirst.mockResolvedValue({ id: 'connector-a', organizationId: 'tenant-a', connectorId: 'shopify_v1', state: 'CONNECTED', configuration: { shopDomain: 'store.myshopify.com' }, verifiedCapabilities: ['PRODUCT_CATALOG', 'PRODUCT_PRICES', 'INVENTORY'], integrationConnectionId: 'commerce-a', commerceConnection: { id: 'commerce-a', state: 'CONNECTED', grantedScopes: ['read_products', 'read_inventory'], grantedScopeMetadata: [], grantedScopesVerifiedAt: now, lastSuccessfulSyncAt: now }, shopifyOAuthStates: [], dataPermissions: [{ category: 'PRODUCTS', enabled: true, syncEnabled: true }, { category: 'PRICES', enabled: true, syncEnabled: true }, { category: 'INVENTORY', enabled: true, syncEnabled: true }], assistantDataPermissions: [] });
    db.commerceProduct.count = jest.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(10).mockResolvedValueOnce(8).mockResolvedValueOnce(9);
    db.commerceProductVariant.count = jest.fn().mockResolvedValue(24);
    db.commerceOrder.count = jest.fn().mockResolvedValue(0);
    db.knowledgeSource.count = jest.fn().mockResolvedValue(0);
    db.connectorSyncJob.findFirst.mockResolvedValue({ id: 'job-a', resourceType: 'PRODUCTS', state: 'SUCCEEDED', itemCount: 12 });
    db.$queryRaw.mockResolvedValue([{ count: 3 }]);
    db.chatbot.findMany.mockResolvedValue([]);

    const result = await service.permissions('user-a', 'workspace-a', 'connector-a');

    expect(result.storedRecordCounts).toMatchObject({ products: 12, variants: 24, productsWithPrices: 10, productsWithInventory: 8, categorizedProducts: 9, collections: 3, orders: 0 });
    expect(result.visibleProductCount).toBe(12);
    expect(db.commerceProductVariant.count).toHaveBeenCalledWith(expect.objectContaining({ where: { product: expect.objectContaining({ organizationId: 'tenant-a', connectionId: 'commerce-a' }) } }));
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('persists Shopify scope revocations and purges data protected by the revoked grants', async () => {
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    db.connectorInstance.findFirst.mockResolvedValue({
      id: 'connector-a', organizationId: 'tenant-a', connectorId: 'shopify_v1', state: 'CONNECTED',
      configuration: { shopDomain: 'store.myshopify.com' }, verifiedCapabilities: ['PRODUCT_CATALOG', 'PRODUCT_PRICES', 'INVENTORY', 'ORDERS', 'FULFILLMENT'],
      integrationConnectionId: 'commerce-a', credential: { id: 'credential-a' },
      commerceConnection: { id: 'commerce-a', grantedScopes: ['read_products', 'read_inventory', 'read_orders'] },
    });
    vault.decrypt.mockReturnValue({ accessToken: 'encrypted-token-is-not-returned' });
    scopeDiscovery.discover.mockResolvedValue({ shopId: 'gid://shopify/Shop/1', shopDomain: 'store.myshopify.com', scopes: [{ handle: 'read_inventory', description: 'Read inventory' }] });
    db.integrationConnection.updateMany.mockResolvedValue({ count: 1 });
    db.connectorInstance.updateMany.mockResolvedValue({ count: 1 });
    db.commerceProduct.updateMany.mockResolvedValue({ count: 1 });
    db.commerceProductVariant.updateMany.mockResolvedValue({ count: 1 });
    db.commerceProduct.deleteMany.mockResolvedValue({ count: 1 });
    db.commerceOrder.deleteMany.mockResolvedValue({ count: 1 });
    db.auditEvent.create.mockResolvedValue({});
    jest.spyOn(service, 'permissions').mockResolvedValue({} as any);

    await service.refreshShopifyPermissions('user-a', 'workspace-a', 'connector-a');

    expect(db.integrationConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'commerce-a', organizationId: 'tenant-a', platform: 'SHOPIFY' },
      data: expect.objectContaining({ externalAccountId: 'gid://shopify/Shop/1', grantedScopes: ['read_inventory'], grantedScopeMetadata: [{ handle: 'read_inventory', description: 'Read inventory' }] }),
    }));
    expect(db.commerceProduct.deleteMany).toHaveBeenCalledWith({ where: { organizationId: 'tenant-a', connectionId: 'commerce-a' } });
    expect(db.commerceProduct.updateMany).not.toHaveBeenCalledWith({ where: { organizationId: 'tenant-a', connectionId: 'commerce-a' }, data: { inventory: null, availabilityStatus: null } });
    expect(db.commerceOrder.deleteMany).toHaveBeenCalledWith({ where: { organizationId: 'tenant-a', connectionId: 'commerce-a' } });
    expect(db.connectorInstance.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { verifiedCapabilities: ['INVENTORY'] } }));
  });

  it('never decrypts or returns stored credential material in connector listing', async () => {
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    db.connectorInstance.findMany.mockResolvedValue([{ id: 'id', credential: { ciphertext: 'encrypted-only' }, displayName: 'Test' }]);
    const result = await service.list('user', 'workspace');
    expect(vault.decrypt).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('encrypted-only');
    expect(result.items[0]).toHaveProperty('hasCredentials', true);
  });

  it('retries only a failed job belonging to the authorized tenant and connector', async () => {
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    db.connectorInstance.findFirst.mockResolvedValue({ id: 'connector-a', organizationId: 'tenant-a', connectorId: 'shopify_v1', state: 'CONNECTED', configuration: {}, verifiedCapabilities: [], lastVerifiedAt: null, lastErrorCode: null, createdAt: new Date(), updatedAt: new Date() });
    db.connectorSyncJob.findFirst.mockResolvedValue({ id: 'job-a', organizationId: 'tenant-a', connectorInstanceId: 'connector-a', resourceType: 'PRODUCTS', mode: 'INCREMENTAL', cursor: 'cursor-2', checkpoint: { updatedAt: '2026-10-01T00:00:00Z' }, attemptCount: 8 });
    db.connectorSyncJob.upsert.mockResolvedValue({ id: 'retry-a', state: 'PENDING' });
    await service.retrySyncJob('user', 'workspace', 'connector-a', 'job-a');
    expect(db.connectorSyncJob.findFirst).toHaveBeenCalledWith({ where: { id: 'job-a', organizationId: 'tenant-a', connectorInstanceId: 'connector-a', state: 'FAILED' } });
    expect(db.connectorSyncJob.upsert.mock.calls[0][0].create).toMatchObject({ organizationId: 'tenant-a', connectorInstanceId: 'connector-a', resourceType: 'PRODUCTS', cursor: 'cursor-2', idempotencyKey: 'retry:job-a:8' });
  });

  it('runs slow Shopify verification outside Prisma transactions and atomically persists capabilities and scopes', async () => {
    const { adapter } = prepareVerification();
    let transactionActive = false;
    db.$transaction.mockImplementation(async (callback: any) => {
      transactionActive = true;
      try { return await callback(db); } finally { transactionActive = false; }
    });
    adapter.connect.mockImplementation(async () => { expect(transactionActive).toBe(false); });
    adapter.verify.mockImplementation(async () => {
      expect(transactionActive).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { verified: true, externalAccountId: 'gid://shopify/Shop/1', grantedScopes: ['read_products', 'read_inventory', 'read_orders'], grantedScopeMetadata: [{ handle: 'read_products', description: 'Read products' }], capabilities: ['CONNECTOR_HEALTH_CHECK', 'PRODUCT_CATALOG', 'PRODUCT_PRICES', 'INVENTORY', 'ORDERS', 'FULFILLMENT'] };
    });

    const result = await service.verify('user-a', 'workspace-a', 'connector-a');

    expect(result.state).toBe('CONNECTED');
    expect(db.integrationConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'commerce-a', organizationId: 'tenant-a' }, data: expect.objectContaining({ grantedScopes: ['read_products', 'read_inventory', 'read_orders'], grantedScopeMetadata: [{ handle: 'read_products', description: 'Read products' }] }) }));
    expect(db.connectorDataPermission.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(db.assistantConnectorDataPermission.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    expect(db.$transaction).toHaveBeenLastCalledWith(expect.any(Function), { maxWait: 5_000, timeout: 10_000 });
  });

  it('does not report a connector verified when final Prisma persistence fails with P2028', async () => {
    prepareVerification();
    db.$transaction.mockImplementationOnce((callback: any) => callback(db)).mockRejectedValueOnce(Object.assign(new Error('Transaction already closed'), { code: 'P2028', meta: { timeout: 5000, timeTaken: 5001 } }));

    await expect(service.verify('user-a', 'workspace-a', 'connector-a')).rejects.toMatchObject({ status: 503, response: expect.objectContaining({ code: 'CONNECTOR_DATABASE_TRANSACTION_FAILED' }) });
    expect(db.connectorInstance.updateMany).toHaveBeenCalledTimes(2);
    expect(db.connectorInstance.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'connector-a', organizationId: 'tenant-a', state: 'CONNECTING' }),
      data: { state: 'DRAFT', lastErrorCode: 'CONNECTOR_DATABASE_TRANSACTION_FAILED' },
    }));
    expect(db.integrationConnection.updateMany).not.toHaveBeenCalled();
  });

  it('does not start a second verification while the persisted CONNECTING claim is still fresh', async () => {
    const { row, adapter } = prepareVerification();
    row.state = 'CONNECTING';
    row.updatedAt = new Date();

    await expect(service.verify('user-a', 'workspace-a', 'connector-a')).rejects.toMatchObject({ status: 409, response: expect.objectContaining({ code: 'CONNECTOR_VERIFICATION_IN_PROGRESS' }) });
    expect(adapter.verify).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('allows an explicit verification request to recover a stale CONNECTING claim', async () => {
    const { row } = prepareVerification();
    row.state = 'CONNECTING';
    row.updatedAt = new Date(Date.now() - 180_000);

    const result = await service.verify('user-a', 'workspace-a', 'connector-a');

    expect(result.state).toBe('CONNECTED');
    expect(db.connectorInstance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'connector-a', organizationId: 'tenant-a', updatedAt: row.updatedAt }),
      data: expect.objectContaining({ state: 'CONNECTING' }),
    }));
  });

  it('prevents a stale verification attempt from persisting scopes after its claim is superseded', async () => {
    prepareVerification();
    db.connectorInstance.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await expect(service.verify('user-a', 'workspace-a', 'connector-a')).rejects.toMatchObject({ status: 409 });
    expect(db.integrationConnection.updateMany).not.toHaveBeenCalled();
  });

  it('removes only the disconnected Shopify connection commerce records and preserves crawler knowledge', async () => {
    workspace.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    const row = { id: 'connector-a', organizationId: 'tenant-a', connectorId: 'shopify_v1', configuration: { shopDomain: 'store.myshopify.com' }, integrationConnectionId: 'commerce-a', credential: null };
    db.connectorInstance.findFirst.mockResolvedValue(row);
    db.connectorInstance.update.mockResolvedValue({ id: row.id, state: 'DISCONNECTED' });
    db.connectorCredential.deleteMany.mockResolvedValue({ count: 0 });
    db.connectorSyncJob.updateMany.mockResolvedValue({ count: 0 });
    db.commerceProduct.deleteMany.mockResolvedValue({ count: 3 });
    db.commerceOrder.deleteMany.mockResolvedValue({ count: 2 });
    db.integrationConnection.updateMany.mockResolvedValue({ count: 1 });
    db.auditEvent.create.mockResolvedValue({});

    await service.disconnect('user-a', 'workspace-a', 'connector-a');

    expect(db.commerceProduct.deleteMany).toHaveBeenCalledWith({ where: { organizationId: 'tenant-a', connectionId: 'commerce-a' } });
    expect(db.commerceOrder.deleteMany).toHaveBeenCalledWith({ where: { organizationId: 'tenant-a', connectionId: 'commerce-a' } });
    expect(db.$queryRaw.mock.calls.some((call: any[]) => call[0].join('').includes('FOR UPDATE'))).toBe(true);
    expect(db.knowledgeSource.updateMany).not.toHaveBeenCalled();
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ deletedCommerceProducts: 3, deletedCommerceOrders: 2, crawlerSourcesPreserved: true }) }) }));
  });
});
