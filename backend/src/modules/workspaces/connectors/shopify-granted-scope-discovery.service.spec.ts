import { ShopifyGrantedScopeDiscoveryService, isShopifyScopeSnapshotFresh, shopifyScopeAllows, shopifyScopeAccessType, shopifyScopeClassification, SHOPIFY_SCOPE_OPERATION_REGISTRY } from './shopify-granted-scope-discovery.service';

describe('Shopify granted scope discovery', () => {
  const http: any = { post: jest.fn() };
  const db: any = { integrationConnection: { updateMany: jest.fn() } };
  const service = new ShopifyGrantedScopeDiscoveryService(http, db);
  const input = { organizationId: 'tenant-a', connectorInstanceId: 'connector-a', shopDomain: 'sample.myshopify.com', accessToken: 'opaque-access-token-12345' };
  const response = (scopes: unknown[], domain = input.shopDomain, storefrontUrl?: string) => ({ status: 200, body: Buffer.from(JSON.stringify({ data: { shop: { id: 'gid://shopify/Shop/10', myshopifyDomain: domain, ...(storefrontUrl ? { primaryDomain: { url: storefrontUrl } } : {}) }, currentAppInstallation: { accessScopes: scopes } } })) });
  beforeEach(() => jest.clearAllMocks());

  it('discovers a small installed grant set and retains provider descriptions', async () => {
    http.post.mockResolvedValue(response([{ handle: 'read_products', description: 'Read products' }, { handle: 'read_inventory', description: 'Read inventory' }, { handle: 'read_orders', description: 'Read orders' }], input.shopDomain, 'https://store.example.com/'));
    const result = await service.discover(input);
    expect(result.scopes).toHaveLength(3);
    expect(result.scopes[0]).toEqual({ handle: 'read_inventory', description: 'Read inventory' });
    expect(result.storefrontUrl).toBe('https://store.example.com');
    expect(http.post.mock.calls[0][0]).toContain('/admin/api/2026-10/graphql.json');
    expect(http.post.mock.calls[0][2]).toContain('query CarteioGrantedScopes');
  });

  it('does not trust an unsafe provider storefront URL as a crawl origin', async () => {
    http.post.mockResolvedValue(response([{ handle: 'read_products', description: null }], input.shopDomain, 'http://127.0.0.1/admin'));
    const result = await service.discover(input);
    expect(result.storefrontUrl).toBeNull();
  });

  it('supports 50+ actual scopes, preserves unknown future handles, and deduplicates entries', async () => {
    const rows = Array.from({ length: 55 }, (_, i) => ({ handle: `read_future_${i}`, description: `Future resource ${i}` }));
    rows.push({ handle: 'read_new_resource', description: 'Unknown future resource' }, { handle: 'read_new_resource', description: 'Duplicate' });
    http.post.mockResolvedValue(response(rows));
    const result = await service.discover(input);
    expect(result.scopes).toHaveLength(new Set(rows.map((scope) => scope.handle)).size);
    expect(result.scopes.find((scope) => scope.handle === 'read_new_resource')).toEqual({ handle: 'read_new_resource', description: 'Unknown future resource' });
    expect(shopifyScopeAllows(result.scopes.map((scope) => scope.handle), 'PRODUCTS')).toBe(false);
    expect(shopifyScopeAllows(['write_products', 'read_new_resource'], 'PRODUCTS')).toBe(false);
    expect(shopifyScopeAllows(['read_products'], 'ORDERS')).toBe(false);
  });

  it('maps only explicit read scopes to supported operations and keeps orders restricted', () => {
    expect(SHOPIFY_SCOPE_OPERATION_REGISTRY.read_products.map((operation) => operation.category)).toEqual(['PRODUCTS', 'PRICES', 'CATEGORIES']);
    expect(SHOPIFY_SCOPE_OPERATION_REGISTRY.read_orders[0]).toMatchObject({ category: 'ORDERS', assistantEligible: false, sensitivity: 'RESTRICTED' });
    expect(Object.keys(SHOPIFY_SCOPE_OPERATION_REGISTRY)).not.toContain('write_products');
    expect(SHOPIFY_SCOPE_OPERATION_REGISTRY.read_products.every((operation) => operation.accessType === 'READ' && operation.executable)).toBe(true);
    expect(SHOPIFY_SCOPE_OPERATION_REGISTRY.read_orders[0]).toMatchObject({ accessType: 'READ', dataClassification: 'PROTECTED', customerIdentityRequired: true });
    expect(shopifyScopeAccessType('write_products')).toBe('WRITE');
    expect(shopifyScopeClassification('read_future_resource')).toBe('UNKNOWN');
  });

  it('rejects malformed scope handles and mismatched store identities', async () => {
    http.post.mockResolvedValue(response([{ handle: 'read_products;write_orders', description: null }]));
    await expect(service.discover(input)).rejects.toThrow('CONNECTOR_PROVIDER_RESPONSE_INVALID');
    http.post.mockResolvedValue(response([{ handle: 'read_products', description: null }], 'other.myshopify.com'));
    await expect(service.discover(input)).rejects.toThrow('CONNECTOR_SHOPIFY_SCOPE_DISCOVERY_FAILED');
  });

  it('preserves failures without persisting and treats expired snapshots as unavailable', async () => {
    http.post.mockRejectedValue(new Error('provider unavailable'));
    await expect(service.discover(input)).rejects.toThrow('provider unavailable');
    expect(db.integrationConnection.updateMany).not.toHaveBeenCalled();
    expect(isShopifyScopeSnapshotFresh(new Date(Date.now() - 25 * 60 * 60 * 1000))).toBe(false);
    expect(isShopifyScopeSnapshotFresh(new Date())).toBe(true);
  });

  it('writes each verified snapshot to only its owning organization and store connection', async () => {
    await service.persist({ organizationId: 'tenant-b', connectionId: 'connection-b', scopes: [{ handle: 'read_products', description: 'Read products' }] });
    expect(db.integrationConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'connection-b', organizationId: 'tenant-b', platform: 'SHOPIFY' },
      data: expect.objectContaining({ grantedScopes: ['read_products'], grantedScopeMetadata: [{ handle: 'read_products', description: 'Read products' }], grantedScopesVerifiedAt: expect.any(Date) }),
    }));
  });
});
