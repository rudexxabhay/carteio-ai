import { ShopifyOAuthService } from './shopify-oauth.service';

describe('Shopify OAuth installation compatibility', () => {
  const originalEnvironment = {
    SHOPIFY_CLIENT_ID: process.env.SHOPIFY_CLIENT_ID,
    SHOPIFY_CLIENT_SECRET: process.env.SHOPIFY_CLIENT_SECRET,
    SHOPIFY_CALLBACK_URL: process.env.SHOPIFY_CALLBACK_URL,
    SHOPIFY_SCOPES: process.env.SHOPIFY_SCOPES,
    NODE_ENV: process.env.NODE_ENV,
  };
  const db = {
    connectorInstance: { findFirst: jest.fn() },
    shopifyOAuthState: { create: jest.fn() },
  };
  const workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-1' }) };
  const connectors = { create: jest.fn().mockResolvedValue({ id: 'connector-1' }) };
  const service = new ShopifyOAuthService(db as any, workspaces as any, connectors as any, {} as any, {} as any, {} as any);

  beforeEach(() => {
    process.env.SHOPIFY_CLIENT_ID = 'shopify-client-id';
    process.env.SHOPIFY_CLIENT_SECRET = 'shopify-client-secret';
    process.env.SHOPIFY_CALLBACK_URL = 'https://api.example.test/api/v1/connectors/shopify/callback';
    process.env.SHOPIFY_SCOPES = 'read_products,read_inventory,read_orders';
    process.env.NODE_ENV = 'test';
    db.connectorInstance.findFirst.mockReset();
    db.shopifyOAuthState.create.mockReset();
    connectors.create.mockReset().mockResolvedValue({ id: 'connector-1' });
    workspaces.requireAccess.mockReset().mockResolvedValue({ organizationId: 'org-1' });
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('keeps the legacy three-scope authorization-code request intact for new installs', async () => {
    db.connectorInstance.findFirst.mockResolvedValue(null);

    const result = await service.begin('user-1', 'workspace', { shopDomain: 'store.myshopify.com' });
    const authorization = new URL(result.authorizationUrl);

    expect(authorization.pathname).toBe('/admin/oauth/authorize');
    expect(authorization.searchParams.get('scope')).toBe('read_products,read_inventory,read_orders');
    expect(authorization.searchParams.get('redirect_uri')).toBe(process.env.SHOPIFY_CALLBACK_URL);
    expect(authorization.searchParams.get('state')).toMatch(/^install\./);
    expect(connectors.create).toHaveBeenCalledTimes(1);
    expect(db.shopifyOAuthState.create).toHaveBeenCalledTimes(1);
    expect(db.shopifyOAuthState.create.mock.calls[0][0].data.requestedScopes).toEqual(['read_products', 'read_inventory', 'read_orders']);
  });

  it('keeps the existing connected store untouched while the upgrade allow-list is empty', async () => {
    db.connectorInstance.findFirst.mockResolvedValue({
      id: 'connector-1', state: 'CONNECTED', credential: { id: 'credential-1' },
      commerceConnection: { state: 'CONNECTED', grantedScopes: ['read_products', 'read_inventory', 'read_orders'], externalAccountId: 'gid://shopify/Shop/1' },
    });

    await expect(service.begin('user-1', 'workspace', { shopDomain: 'store.myshopify.com' }, true))
      .rejects.toThrow('No Shopify scope-upgrade scopes are configured');
    expect(connectors.create).not.toHaveBeenCalled();
    expect(db.shopifyOAuthState.create).not.toHaveBeenCalled();
  });

  it('rejects invalid callbacks before consulting stored credentials', async () => {
    await expect(service.callback({ shop: '127.0.0.1', state: 'x', code: 'x', timestamp: String(Math.floor(Date.now() / 1000)), hmac: '00' })).rejects.toThrow();
  });

  it('rejects Customer Account and Storefront scopes from the Admin OAuth request list', () => {
    expect(() => service['configuredScopes']('customer_read_orders', 'SHOPIFY_SCOPES')).toThrow('Admin API scope handles only');
    expect(() => service['configuredScopes']('unauthenticated_read_product_listings', 'SHOPIFY_SCOPES')).toThrow('Admin API scope handles only');
  });
});
