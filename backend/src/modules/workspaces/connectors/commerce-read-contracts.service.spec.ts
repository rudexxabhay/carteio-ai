import { NotFoundException } from '@nestjs/common';
import { CommerceReadContracts, commerceProductCard, parseProductSearchFilters, type CommerceProductEvidence } from './commerce-read-contracts.service';

describe('CommerceReadContracts tenant and privacy boundary', () => {
  const prisma: any = { chatbot: { findFirst: jest.fn() }, commerceProduct: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() }, commerceOrder: { findFirst: jest.fn() }, connectorInstance: { findMany: jest.fn(), findFirst: jest.fn() }, connectorDataPermission: { findMany: jest.fn(), findFirst: jest.fn() }, assistantConnectorDataPermission: { findMany: jest.fn(), findFirst: jest.fn() } };
  const workspaces: any = { requireAccess: jest.fn() };
  const service = new CommerceReadContracts(prisma, workspaces);
  beforeEach(() => {
    jest.resetAllMocks();
    const connector = { id: 'connector-a', connectorId: 'shopify_v1', state: 'CONNECTED', integrationConnectionId: 'commerce-a', verifiedCapabilities: ['PRODUCT_CATALOG'], commerceConnection: { id: 'commerce-a', state: 'CONNECTED', grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date() } };
    prisma.connectorInstance.findMany.mockResolvedValue([connector]);
    prisma.connectorInstance.findFirst.mockResolvedValue(connector);
    prisma.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.connectorDataPermission.findFirst.mockResolvedValue(null);
    prisma.assistantConnectorDataPermission.findFirst.mockResolvedValue(null);
  });

  it('requires an active assistant in the same tenant and scopes product search to that tenant', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.commerceProduct.findMany.mockResolvedValue([]);
    await service.searchProducts('tenant-a', 'assistant-a', 'shoe');
    expect(prisma.chatbot.findFirst).toHaveBeenCalledWith({ where: { id: 'assistant-a', organizationId: 'tenant-a', status: 'ACTIVE', archivedAt: null }, select: { id: true } });
    expect(prisma.commerceProduct.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: 'tenant-a', connection: { is: { organizationId: 'tenant-a' } } });
  });

  it('uses an explicit model-selected browse operation and returns real tenant-scoped products', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', connectorId: 'shopify_v1', state: 'CONNECTED', integrationConnectionId: 'commerce-a', verifiedCapabilities: ['PRODUCT_CATALOG'], commerceConnection: { id: 'commerce-a', state: 'CONNECTED', grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date() } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.commerceProduct.findMany.mockResolvedValue([{ id: 'product-a', connectionId: 'commerce-a', externalId: 'gid://shopify/Product/1', name: 'Blue shirt', description: 'Cotton shirt', rawStatus: 'ACTIVE', syncedAt: new Date(), variants: [] }]);

    const products = await service.searchCatalog('tenant-a', 'assistant-a', ['Show me products available in this store.'], 2, true);

    expect(products.map((product) => product.name)).toEqual(['Blue shirt']);
    expect(products[0]).toMatchObject({ retrievalReason: 'catalog_browse', dataCompleteness: 'UNKNOWN' });
    const query = prisma.commerceProduct.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({ organizationId: 'tenant-a', connectionId: { in: ['commerce-a'] } });
    expect(query.where.AND).toHaveLength(1);
  });

  it('filters by collection search terms without fetching the filter-only field', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', connectorId: 'shopify_v1', state: 'CONNECTED', integrationConnectionId: 'commerce-a', verifiedCapabilities: ['PRODUCT_CATALOG'], commerceConnection: { id: 'commerce-a', state: 'CONNECTED', grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date() } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }, { connectorInstanceId: 'connector-a', category: 'CATEGORIES' }]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }, { connectorInstanceId: 'connector-a', category: 'CATEGORIES' }]);
    prisma.commerceProduct.findMany.mockResolvedValue([]);

    await service.searchCatalog('tenant-a', 'assistant-a', ['woven tote'], 5);

    const query = prisma.commerceProduct.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({ organizationId: 'tenant-a', connectionId: { in: ['commerce-a'] } });
    expect(JSON.stringify(query.where)).toContain('collectionSearchTerms');
    expect(query.select).not.toHaveProperty('collectionSearchTerms');
  });

  it('does not select collection search terms for product details or evidence revalidation', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', connectorId: 'shopify_v1', state: 'CONNECTED', integrationConnectionId: 'commerce-a', verifiedCapabilities: ['PRODUCT_CATALOG'], commerceConnection: { id: 'commerce-a', state: 'CONNECTED', grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date() } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.commerceProduct.findFirst.mockResolvedValue(null);
    prisma.commerceProduct.findMany.mockResolvedValue([]);

    await service.getProductDetails('tenant-a', 'assistant-a', 'external-product-a');
    await service.revalidateProducts('tenant-a', 'assistant-a', [{ id: 'product-a', connectionId: 'commerce-a', contentHash: 'hash-a', sourceVersion: 1 }]);

    const detailQuery = prisma.commerceProduct.findFirst.mock.calls[0][0];
    const revalidationQuery = prisma.commerceProduct.findMany.mock.calls[0][0];
    expect(detailQuery.where).toMatchObject({ organizationId: 'tenant-a', connectionId: { in: ['commerce-a'] } });
    expect(revalidationQuery.where).toMatchObject({ organizationId: 'tenant-a', connectionId: { in: ['commerce-a'] } });
    expect(detailQuery.select).not.toHaveProperty('collectionSearchTerms');
    expect(revalidationQuery.select).not.toHaveProperty('collectionSearchTerms');
  });

  it('does not manufacture a product result when an authorized broad catalog query has no synchronized rows', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', connectorId: 'shopify_v1', state: 'CONNECTED', integrationConnectionId: 'commerce-a', verifiedCapabilities: ['PRODUCT_CATALOG'], commerceConnection: { id: 'commerce-a', state: 'CONNECTED', grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date() } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.commerceProduct.findMany.mockResolvedValue([]);

    expect(await service.searchCatalog('tenant-a', 'assistant-a', ['Show me products available in this store.'], 2, true)).toEqual([]);
  });

  it('supports model-selected broad catalog browsing for natural-language queries without English browse keywords', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', connectorId: 'shopify_v1', state: 'CONNECTED', integrationConnectionId: 'commerce-a', verifiedCapabilities: ['PRODUCT_CATALOG'], commerceConnection: { id: 'commerce-a', state: 'CONNECTED', grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date() } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.commerceProduct.findMany.mockResolvedValue([{ id: 'product-a', connectionId: 'commerce-a', externalId: 'gid://shopify/Product/1', name: 'Blue shirt', description: null, rawStatus: 'ACTIVE', syncedAt: new Date(), variants: [] }]);

    const products = await service.searchCatalog('tenant-a', 'assistant-a', ['sab products dikhao'], 3, true);

    expect(products.map((product) => product.name)).toEqual(['Blue shirt']);
    expect(products[0]?.retrievalReason).toBe('catalog_browse');
    expect(prisma.commerceProduct.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: 'tenant-a', connectionId: { in: ['commerce-a'] } });
  });

  it('parses only explicit INR price ceilings', () => {
    expect(parseProductSearchFilters('₹1500 ke andar products dikhao')).toEqual({ maxPrice: 1500, currency: 'INR' });
    expect(parseProductSearchFilters('Products below INR 1,500')).toEqual({ maxPrice: 1500, currency: 'INR' });
    expect(parseProductSearchFilters('Show product 1500')).toEqual({});
  });

  it('filters by authorized persisted variant prices and returns only qualifying variants', async () => {
    const now = new Date();
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', connectorId: 'shopify_v1', state: 'CONNECTED', integrationConnectionId: 'commerce-a', verifiedCapabilities: ['PRODUCT_CATALOG', 'PRODUCT_PRICES'], commerceConnection: { id: 'commerce-a', state: 'CONNECTED', grantedScopes: ['read_products'], grantedScopesVerifiedAt: now } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }, { connectorInstanceId: 'connector-a', category: 'PRICES' }]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }, { connectorInstanceId: 'connector-a', category: 'PRICES' }]);
    prisma.commerceProduct.findMany.mockResolvedValue([{ id: 'product-a', connectionId: 'commerce-a', externalId: 'gid://shopify/Product/1', name: 'Canvas Tote', currency: 'INR', price: '1700.00', rawStatus: 'ACTIVE', syncedAt: now, variants: [
      { title: 'Small', sku: null, currency: 'INR', price: '1200.00', selectedOptions: [{ name: 'Size', value: 'Small' }], inventory: null },
      { title: 'Large', sku: null, currency: 'INR', price: '1700.00', selectedOptions: [{ name: 'Size', value: 'Large' }], inventory: null },
    ] }]);

    const filter = parseProductSearchFilters('₹1500 ke andar products dikhao');
    const results = await service.searchCatalog('tenant-a', 'assistant-a', ['products under ₹1500'], 5, false, filter);

    expect(prisma.commerceProduct.findMany.mock.calls[0]?.[0].where.AND).toEqual(expect.arrayContaining([
      expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ variants: expect.anything() })]) }),
    ]));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'Canvas Tote', price: '1200.00', currency: 'INR' });
    expect(results[0]?.variants.map((variant) => variant.price)).toEqual(['1200.00']);
  });

  it('searches persisted selected option values such as a Shopify variant color', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', connectorId: 'shopify_v1', state: 'CONNECTED', integrationConnectionId: 'commerce-a', verifiedCapabilities: ['PRODUCT_CATALOG'], commerceConnection: { id: 'commerce-a', state: 'CONNECTED', grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date() } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.commerceProduct.findMany.mockResolvedValue([{ id: 'product-blue', connectionId: 'commerce-a', externalId: 'gid://shopify/Product/2', name: 'Cotton Shirt', rawStatus: 'ACTIVE', syncedAt: new Date(), variants: [{ title: 'Small', sku: null, selectedOptions: [{ name: 'Color', value: 'Blue' }] }] }]);

    const results = await service.searchCatalog('tenant-a', 'assistant-a', ['Blue color mein available products dikhao'], 5);

    expect(results.map((product) => product.name)).toEqual(['Cotton Shirt']);
    expect(prisma.commerceProduct.findMany.mock.calls[0]?.[0].where.AND[1]).toMatchObject({ OR: expect.arrayContaining([expect.objectContaining({ variants: expect.anything() })]) });
  });

  it('does not expose customer orders until the channel can verify order ownership', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    await expect(service.getAuthorizedOrder({ organizationId: 'tenant-a', assistantId: 'assistant-a', orderReference: '#1001', principal: { type: 'CUSTOMER', verifiedCustomerReference: 'opaque-reference' } })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.commerceOrder.findFirst).not.toHaveBeenCalled();
  });

  it('requires Owner/Admin membership for workspace operator order reads', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    workspaces.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    prisma.commerceOrder.findFirst.mockResolvedValue(null);
    await service.getAuthorizedOrder({ organizationId: 'tenant-a', assistantId: 'assistant-a', orderReference: 'provider-order-1', principal: { type: 'WORKSPACE_OPERATOR', userId: 'user-a', workspaceSlug: 'workspace-a' } });
    expect(workspaces.requireAccess).toHaveBeenCalledWith('user-a', 'workspace-a', ['OWNER', 'ADMIN']);
    expect(prisma.commerceOrder.findFirst).not.toHaveBeenCalled();
  });

  it('resolves an authorized order without loading unrelated product permissions', async () => {
    const verifiedAt = new Date();
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    workspaces.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', lastVerifiedAt: verifiedAt, commerceConnection: { id: 'commerce-a', grantedScopesVerifiedAt: verifiedAt } }]);
    prisma.connectorInstance.findFirst.mockResolvedValue({ connectorId: 'shopify_v1', verifiedCapabilities: ['ORDERS'], lastVerifiedAt: verifiedAt, commerceConnection: { grantedScopes: ['read_orders'], grantedScopesVerifiedAt: verifiedAt } });
    prisma.connectorDataPermission.findFirst.mockResolvedValue({ id: 'workspace-order-permission' });
    prisma.assistantConnectorDataPermission.findFirst.mockResolvedValue({ id: 'assistant-order-permission' });
    prisma.commerceOrder.findFirst.mockResolvedValue({ externalId: 'order-a' });

    const result = await service.getAuthorizedOrder({ organizationId: 'tenant-a', assistantId: 'assistant-a', orderReference: 'order-a', principal: { type: 'WORKSPACE_OPERATOR', userId: 'user-a', workspaceSlug: 'workspace-a' } });

    expect(result).toEqual({ externalId: 'order-a' });
    expect(prisma.connectorInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'tenant-a' }) }));
    expect(prisma.connectorDataPermission.findMany).not.toHaveBeenCalled();
    expect(prisma.assistantConnectorDataPermission.findMany).not.toHaveBeenCalled();
    expect(prisma.commerceOrder.findFirst.mock.calls[0]?.[0].where).toMatchObject({ organizationId: 'tenant-a', connectionId: { in: ['commerce-a'] } });
  });

  it('denies an order read when the authenticated workspace resolves to a different tenant', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    workspaces.requireAccess.mockResolvedValue({ organizationId: 'tenant-b' });

    await expect(service.getAuthorizedOrder({ organizationId: 'tenant-a', assistantId: 'assistant-a', orderReference: 'foreign-order', principal: { type: 'WORKSPACE_OPERATOR', userId: 'user-b', workspaceSlug: 'workspace-b' } })).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.connectorInstance.findMany).not.toHaveBeenCalled();
    expect(prisma.commerceOrder.findFirst).not.toHaveBeenCalled();
  });

  it('rejects an assistant owned by another tenant before resolving order connections', async () => {
    prisma.chatbot.findFirst.mockResolvedValue(null);

    await expect(service.getAuthorizedOrder({ organizationId: 'tenant-a', assistantId: 'assistant-from-tenant-b', orderReference: 'order-a', principal: { type: 'WORKSPACE_OPERATOR', userId: 'user-a', workspaceSlug: 'workspace-a' } })).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.chatbot.findFirst).toHaveBeenCalledWith({ where: { id: 'assistant-from-tenant-b', organizationId: 'tenant-a', status: 'ACTIVE', archivedAt: null }, select: { id: true } });
    expect(workspaces.requireAccess).not.toHaveBeenCalled();
    expect(prisma.connectorInstance.findMany).not.toHaveBeenCalled();
    expect(prisma.commerceOrder.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed for order reads when the current Shopify scope snapshot is stale', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    workspaces.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', lastVerifiedAt: new Date('2020-01-01T00:00:00.000Z'), commerceConnection: { id: 'commerce-a', grantedScopesVerifiedAt: new Date('2020-01-01T00:00:00.000Z') } }]);
    prisma.connectorInstance.findFirst.mockResolvedValue({ connectorId: 'shopify_v1', verifiedCapabilities: ['ORDERS'], lastVerifiedAt: new Date('2020-01-01T00:00:00.000Z'), commerceConnection: { grantedScopes: ['read_orders'], grantedScopesVerifiedAt: new Date('2020-01-01T00:00:00.000Z') } });
    prisma.connectorDataPermission.findFirst.mockResolvedValue({ id: 'workspace-order-permission' });
    prisma.assistantConnectorDataPermission.findFirst.mockResolvedValue({ id: 'assistant-order-permission' });

    const result = await service.getAuthorizedOrder({ organizationId: 'tenant-a', assistantId: 'assistant-a', orderReference: 'order-a', principal: { type: 'WORKSPACE_OPERATOR', userId: 'user-a', workspaceSlug: 'workspace-a' } });

    expect(result).toBeNull();
    expect(prisma.commerceOrder.findFirst).not.toHaveBeenCalled();
    expect(prisma.connectorInstance.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'connector-a', organizationId: 'tenant-a' }) }));
  });

  it('revalidates connector state and ownership after permission lookup before an order read', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    workspaces.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', commerceConnection: { id: 'commerce-a' } }]);
    prisma.connectorDataPermission.findFirst.mockResolvedValue({ id: 'workspace-order-permission' });
    prisma.assistantConnectorDataPermission.findFirst.mockResolvedValue({ id: 'assistant-order-permission' });
    prisma.connectorInstance.findFirst.mockResolvedValueOnce(null);

    const result = await service.getAuthorizedOrder({ organizationId: 'tenant-a', assistantId: 'assistant-a', orderReference: 'order-a', principal: { type: 'WORKSPACE_OPERATOR', userId: 'user-a', workspaceSlug: 'workspace-a' } });

    expect(result).toBeNull();
    expect(prisma.connectorInstance.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'connector-a', organizationId: 'tenant-a', state: 'CONNECTED', integrationConnectionId: { not: null }, commerceConnection: { is: expect.objectContaining({ organizationId: 'tenant-a' }) } }) }));
    expect(prisma.commerceOrder.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed when assistant-specific order permission is revoked', async () => {
    const verifiedAt = new Date();
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    workspaces.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', lastVerifiedAt: verifiedAt, commerceConnection: { id: 'commerce-a', grantedScopesVerifiedAt: verifiedAt } }]);
    prisma.connectorInstance.findFirst.mockResolvedValue({ connectorId: 'shopify_v1', verifiedCapabilities: ['ORDERS'], lastVerifiedAt: verifiedAt, commerceConnection: { grantedScopes: ['read_orders'], grantedScopesVerifiedAt: verifiedAt } });
    prisma.connectorDataPermission.findFirst.mockResolvedValue({ id: 'workspace-order-permission' });
    prisma.assistantConnectorDataPermission.findFirst.mockResolvedValue(null);

    const result = await service.getAuthorizedOrder({ organizationId: 'tenant-a', assistantId: 'assistant-a', orderReference: 'order-a', principal: { type: 'WORKSPACE_OPERATOR', userId: 'user-a', workspaceSlug: 'workspace-a' } });

    expect(result).toBeNull();
    expect(prisma.assistantConnectorDataPermission.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'tenant-a', connectorInstanceId: 'connector-a', assistantId: 'assistant-a', category: 'ORDERS', enabled: true } }));
    expect(prisma.commerceOrder.findFirst).not.toHaveBeenCalled();
  });

  it('scopes order identity lookup to authorized tenant connections, excluding a foreign order ID', async () => {
    const verifiedAt = new Date();
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    workspaces.requireAccess.mockResolvedValue({ organizationId: 'tenant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', lastVerifiedAt: verifiedAt, commerceConnection: { id: 'commerce-a', grantedScopesVerifiedAt: verifiedAt } }]);
    prisma.connectorInstance.findFirst.mockResolvedValue({ connectorId: 'shopify_v1', verifiedCapabilities: ['ORDERS'], lastVerifiedAt: verifiedAt, commerceConnection: { grantedScopes: ['read_orders'], grantedScopesVerifiedAt: verifiedAt } });
    prisma.connectorDataPermission.findFirst.mockResolvedValue({ id: 'workspace-order-permission' });
    prisma.assistantConnectorDataPermission.findFirst.mockResolvedValue({ id: 'assistant-order-permission' });
    prisma.commerceOrder.findFirst.mockResolvedValue(null);

    const result = await service.getAuthorizedOrder({ organizationId: 'tenant-a', assistantId: 'assistant-a', orderReference: 'foreign-order-id', principal: { type: 'WORKSPACE_OPERATOR', userId: 'user-a', workspaceSlug: 'workspace-a' } });

    expect(result).toBeNull();
    expect(prisma.commerceOrder.findFirst.mock.calls[0]?.[0].where).toMatchObject({ organizationId: 'tenant-a', connectionId: { in: ['commerce-a'] }, OR: [{ externalId: 'foreign-order-id' }, { displayReference: 'foreign-order-id' }] });
  });

  it('omits price and inventory evidence unless both workspace and assistant permissions and Shopify scopes allow it', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', connectorId: 'shopify_v1', verifiedCapabilities: ['PRODUCT_CATALOG', 'PRODUCT_PRICES', 'INVENTORY'], commerceConnection: { id: 'commerce-a', grantedScopes: ['read_products', 'read_inventory'], grantedScopesVerifiedAt: new Date() } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }, { connectorInstanceId: 'connector-a', category: 'PRICES' }, { connectorInstanceId: 'connector-a', category: 'INVENTORY' }]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.commerceProduct.findMany.mockResolvedValue([{ id: 'product-a', connectionId: 'commerce-a', externalId: 'sku-a', name: 'Blue shirt', description: 'Cotton shirt', category: 'Clothing', sku: 'sku-a', currency: 'USD', price: '25.00', inventory: 4, availabilityStatus: 'IN_STOCK', rawStatus: 'ACTIVE', productUrl: null, externalUpdatedAt: null, syncedAt: new Date(), variants: [{ title: 'Small', sku: 'sku-a-s', currency: 'USD', price: '25.00', inventory: 4, availabilityStatus: 'IN_STOCK', rawStatus: 'ACTIVE' }] }]);
    const result = await service.searchProducts('tenant-a', 'assistant-a', 'blue shirt');
    expect(result).toHaveLength(1);
    const product = result[0];
    if (!product) throw new Error('Expected one authorized product result');
    expect(product).toMatchObject({ name: 'Blue shirt', price: null, currency: null, inventory: null, availabilityStatus: null, category: null });
    expect(product.variants[0]).toMatchObject({ price: null, currency: null, inventory: null, availabilityStatus: null });
    expect(prisma.commerceProduct.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: 'tenant-a', connectionId: { in: ['commerce-a'] } });
  });

  it('does not query catalog data if the assistant has no enabled product permission', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', connectorId: 'shopify_v1', verifiedCapabilities: ['PRODUCT_CATALOG'], commerceConnection: { id: 'commerce-a', grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date() } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([]);
    expect(await service.searchProducts('tenant-a', 'assistant-a', 'blue shirt')).toEqual([]);
    expect(prisma.commerceProduct.findMany).not.toHaveBeenCalled();
  });

  it('offers product search only when current Shopify permissions and query-ready catalog rows exist', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', connectorId: 'shopify_v1', state: 'CONNECTED', integrationConnectionId: 'commerce-a', verifiedCapabilities: ['PRODUCT_CATALOG'], commerceConnection: { id: 'commerce-a', state: 'CONNECTED', grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date() } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.commerceProduct.count.mockResolvedValue(2);
    await expect(service.canSearchProducts('tenant-a', 'assistant-a')).resolves.toBe(true);
    expect(prisma.commerceProduct.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'tenant-a', connectionId: { in: ['commerce-a'] } }) }));

    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([]);
    await expect(service.canSearchProducts('tenant-a', 'assistant-a')).resolves.toBe(false);
    await expect(service.productSearchReadiness('tenant-a', 'assistant-a')).resolves.toMatchObject({ eligible: false, reason: 'ASSISTANT_PERMISSION_DISABLED', recordCount: 0 });
  });

  it.each([
    ['missing', [], 'MISSING'],
    ['disabled', [{ connectorInstanceId: 'connector-a', category: 'PRODUCTS', enabled: false }], 'DISABLED'],
    ['enabled', [{ connectorInstanceId: 'connector-a', category: 'PRODUCTS', enabled: true }], 'ENABLED'],
  ])('reports %s assistant permission without changing authorization', async (_label, assistantRows, expected) => {
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', verifiedCapabilities: ['PRODUCT_CATALOG'], lastVerifiedAt: new Date(), commerceConnection: { id: 'commerce-a', grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date() } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS', enabled: true }]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue(assistantRows);
    prisma.commerceProduct.count.mockResolvedValue(3);
    const result = await service.productSearchReadiness('tenant-a', 'assistant-a');
    expect(result.permissionDiagnostics?.assistantProducts).toBe(expected);
    expect(result.eligible).toBe(expected === 'ENABLED');
  });

  it('reports missing workspace permission without returning connector identifiers', async () => {
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-secret', verifiedCapabilities: ['PRODUCT_CATALOG'], lastVerifiedAt: new Date(), commerceConnection: { id: 'commerce-a', grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date() } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-secret', category: 'PRODUCTS', enabled: true }]);
    const result = await service.productSearchReadiness('tenant-a', 'assistant-a');
    expect(result.permissionDiagnostics?.workspaceProducts).toBe('MISSING');
    expect(JSON.stringify(result.permissionDiagnostics)).not.toContain('connector-secret');
    expect(result).toMatchObject({ eligible: false, reason: 'WORKSPACE_PERMISSION_DISABLED' });
  });

  it('does not query catalog data when workspace AI permission is disabled', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', connectorId: 'shopify_v1', verifiedCapabilities: ['PRODUCT_CATALOG'], commerceConnection: { id: 'commerce-a', grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date() } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);

    expect(await service.searchCatalog('tenant-a', 'assistant-a', ['Show me products available in this store.'], 2)).toEqual([]);
    expect(prisma.commerceProduct.findMany).not.toHaveBeenCalled();
  });

  it('does not query catalog data when the Shopify grant snapshot is stale', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', connectorId: 'shopify_v1', verifiedCapabilities: ['PRODUCT_CATALOG'], commerceConnection: { id: 'commerce-a', grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);

    expect(await service.searchCatalog('tenant-a', 'assistant-a', ['Show me products available in this store.'], 2)).toEqual([]);
    expect(prisma.commerceProduct.findMany).not.toHaveBeenCalled();
  });

  it('rejects previously cached commerce evidence after assistant permission is removed', async () => {
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', connectorId: 'shopify_v1', verifiedCapabilities: ['PRODUCT_CATALOG'], commerceConnection: { id: 'commerce-a', grantedScopes: ['read_products'], grantedScopesVerifiedAt: new Date() } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue([{ connectorInstanceId: 'connector-a', category: 'PRODUCTS' }]);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue([]);

    const result = await service.revalidateProducts('tenant-a', 'assistant-a', [{ id: 'cached-product', connectionId: 'commerce-a', contentHash: 'old-hash', sourceVersion: 1 }]);
    expect(result).toEqual([]);
    expect(prisma.commerceProduct.findMany).not.toHaveBeenCalled();
  });

  it('maps verified catalog fields into a safe card without promoting stale stock, invalid prices, or admin URLs', () => {
    const product: CommerceProductEvidence = {
      id: 'product-a', connectionId: 'commerce-a', externalId: 'external-a', name: 'Product title', description: null,
      category: null, productType: null, taxonomyCategoryId: null, taxonomyCategory: null, collections: [], vendor: null, handle: 'product-title',
      compareAtPrice: '30.00', imageUrl: null, imageAltText: null, imageWidth: null, imageHeight: null,
      imageEvidence: [{ url: 'https://cdn.example.test/product.jpg', altText: 'Catalog image', width: 800, height: 600 }], sku: null,
      currency: 'USD', price: '20.00', inventory: 4, availabilityStatus: 'IN_STOCK', rawStatus: 'ACTIVE',
      productUrl: 'https://admin.shopify.com/store/private/products/1', syncedAt: new Date().toISOString(), externalUpdatedAt: null, stale: true,
      retrievalScore: 1, retrievalReason: 'catalog_browse', dataCompleteness: 'UNKNOWN', variants: [], contentHash: 'a'.repeat(64),
    };
    expect(commerceProductCard(product)).toMatchObject({
      id: 'product-a', title: 'Product title', imageUrl: 'https://cdn.example.test/product.jpg', imageAltText: 'Catalog image',
      price: '20.00', currency: 'USD', compareAtPrice: '30.00', availability: null, productUrl: null, stale: true,
    });
    expect(commerceProductCard({ ...product, imageUrl: 'javascript:alert(1)', imageAltText: 'Untrusted primary image' })).toMatchObject({ imageUrl: 'https://cdn.example.test/product.jpg', imageAltText: 'Catalog image' });
    expect(commerceProductCard({ ...product, price: 'invalid', compareAtPrice: '19.00', productUrl: 'https://store.example.test/products/item', stale: false })).toMatchObject({ price: null, compareAtPrice: null, availability: 'IN_STOCK', productUrl: 'https://store.example.test/products/item' });
  });
});
