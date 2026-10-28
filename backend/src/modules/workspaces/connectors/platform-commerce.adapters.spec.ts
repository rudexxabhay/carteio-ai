import { createHmac } from 'node:crypto';
import { isPublicSafeMetaobjectDefinition, lowestShopifyVariantPrice, ShopifyConnectorAdapter, shopifyWebhookSyncTarget, WooCommerceConnectorAdapter } from './shopify.adapter';
import { SHOPIFY_SCOPE_OPERATION_REGISTRY } from './shopify-granted-scope-discovery.service';

describe('Phase 16 platform adapter security and normalization', () => {
  it('uses the lowest valid variant price and its matching compare-at value for the product summary', () => {
    expect(lowestShopifyVariantPrice([
      { price: '24.00', compareAtPrice: '30.00' },
      { price: '8.50', compareAtPrice: '12.00' },
      { price: 'invalid', compareAtPrice: '99.00' },
    ])).toEqual({ price: '8.50', compareAtPrice: '12.00' });
    expect(lowestShopifyVariantPrice([])).toEqual({ price: null, compareAtPrice: null });
  });

  it('routes documented business webhook topics to bounded refresh resources and rejects unrelated topics', () => {
    expect(shopifyWebhookSyncTarget('products/update')).toEqual({ resourceType: 'PRODUCTS', mode: 'INCREMENTAL' });
    expect(shopifyWebhookSyncTarget('inventory_levels/disconnect')).toEqual({ resourceType: 'PRODUCTS', mode: 'FULL' });
    expect(shopifyWebhookSyncTarget('inventory_items/update')).toEqual({ resourceType: 'PRODUCTS', mode: 'FULL' });
    expect(shopifyWebhookSyncTarget('collections/update')).toEqual({ resourceType: 'PRODUCTS', mode: 'FULL' });
    expect(shopifyWebhookSyncTarget('profiles/update')).toEqual({ resourceType: 'CONTENT', mode: 'INCREMENTAL' });
    expect(shopifyWebhookSyncTarget('pages/update')).toBeNull();
    expect(shopifyWebhookSyncTarget('markets/delete')).toEqual({ resourceType: 'CONTENT', mode: 'INCREMENTAL' });
    expect(shopifyWebhookSyncTarget('markets_backup_region/update')).toEqual({ resourceType: 'CONTENT', mode: 'INCREMENTAL' });
    expect(shopifyWebhookSyncTarget('discounts/update')).toEqual({ resourceType: 'CONTENT', mode: 'INCREMENTAL' });
    expect(shopifyWebhookSyncTarget('metaobjects/delete')).toEqual({ resourceType: 'CONTENT', mode: 'INCREMENTAL' });
    expect(shopifyWebhookSyncTarget('themes/update')).toBeNull();
    expect(shopifyWebhookSyncTarget('orders/not_a_real_topic')).toBeNull();
    expect(shopifyWebhookSyncTarget('products/not_a_real_topic')).toBeNull();
  });
  const prisma: any = { connectorCredential: { updateMany: jest.fn() }, connectorInstance: { findFirst: jest.fn() }, connectorSyncJob: { upsert: jest.fn() }, commerceProduct: { updateMany: jest.fn() }, integrationConnection: { updateMany: jest.fn() }, $transaction: jest.fn((fn: any) => fn(prisma)) };
  const http: any = { post: jest.fn(), request: jest.fn() };
  const vault: any = { encrypt: jest.fn(() => ({ ciphertext: Buffer.from('x'), nonce: Buffer.alloc(12), authTag: Buffer.alloc(16), keyVersion: 'v1' })) };
  const scopeDiscovery: any = { discover: jest.fn().mockResolvedValue({ shopId: 'gid://shopify/Shop/1', shopDomain: 'sample.myshopify.com', scopes: [{ handle: 'read_products', description: 'Read products' }, { handle: 'read_inventory', description: 'Read inventory' }] }) };
  const shopify = new ShopifyConnectorAdapter(http, prisma, vault, scopeDiscovery), woo = new WooCommerceConnectorAdapter(http, prisma);
  beforeEach(() => jest.clearAllMocks());
  it('requires Shopify read_products and validates scopes through the provider response', async () => {
    http.post.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify({ data: { products: { nodes: [{ id: 'gid://shopify/Product/1' }] } } })) });
    const verified = await shopify.verify({ organizationId: 'org', connectorInstanceId: 'connector' }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' });
    expect(verified.grantedScopes).toEqual(['read_products', 'read_inventory']);
    expect(verified.grantedScopeMetadata?.[0]).toMatchObject({ handle: 'read_products', description: 'Read products' });
    expect(verified.capabilities).toContain('INVENTORY');
    expect(verified.capabilities).not.toContain('ORDERS');
  });
  it('advertises an added read capability only after an authenticated provider probe succeeds', async () => {
    scopeDiscovery.discover.mockResolvedValueOnce({ shopId: 'gid://shopify/Shop/1', shopDomain: 'sample.myshopify.com', scopes: [{ handle: 'read_products', description: 'Read products' }, { handle: 'read_locations', description: 'Read locations' }] });
    http.post.mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify({ data: { products: { nodes: [{ id: 'p1' }] } } })) }).mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify({ data: { locations: { nodes: [{ id: 'l1' }] } } })) });
    const verified = await shopify.verify({ organizationId: 'tenant-a', connectorInstanceId: 'connector-a' }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' });
    expect(verified.capabilities).toContain('SHOPIFY_LOCATIONS');
    expect(verified.capabilities).toContain('WEBSITE_CONTENT');
    expect(verified.capabilities).not.toContain('SHOPIFY_SHIPPING');
  });
  it('refreshes an expiring Shopify token before discovering installed scopes', async () => {
    const oldClientId = process.env.SHOPIFY_CLIENT_ID, oldClientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    process.env.SHOPIFY_CLIENT_ID = 'test-client-id';
    process.env.SHOPIFY_CLIENT_SECRET = 'test-client-secret';
    try {
      const refreshedCredentials = {
        accessToken: 'refreshed-access-token-12345',
        refreshToken: 'rotated-refresh-token-12345',
        accessTokenExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      };
      scopeDiscovery.discover.mockImplementationOnce(async (input: any) => {
        expect(input.accessToken).toBe(refreshedCredentials.accessToken);
        return { shopId: 'gid://shopify/Shop/1', shopDomain: 'sample.myshopify.com', scopes: [{ handle: 'read_products', description: 'Read products' }] };
      });
      http.post
        .mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify({ access_token: refreshedCredentials.accessToken, refresh_token: refreshedCredentials.refreshToken, expires_in: 3600 })) })
        .mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify({ data: { products: { nodes: [] } } })) });

      const result = await shopify.verify(
        { organizationId: 'org', connectorInstanceId: 'connector' },
        { shopDomain: 'sample.myshopify.com' },
        { accessToken: 'expired-access-token-12345', refreshToken: 'old-refresh-token-12345', accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(), refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString() },
      );

      expect(result.verified).toBe(true);
      expect(http.post.mock.calls[0][0]).toBe('https://sample.myshopify.com/admin/oauth/access_token');
      expect(scopeDiscovery.discover).toHaveBeenCalledTimes(1);
      expect(prisma.connectorCredential.updateMany).toHaveBeenCalledTimes(1);
    } finally {
      if (oldClientId === undefined) delete process.env.SHOPIFY_CLIENT_ID; else process.env.SHOPIFY_CLIENT_ID = oldClientId;
      if (oldClientSecret === undefined) delete process.env.SHOPIFY_CLIENT_SECRET; else process.env.SHOPIFY_CLIENT_SECRET = oldClientSecret;
    }
  });
  it('checks Shopify signatures against exact raw bytes and shop origin', async () => {
    process.env.SHOPIFY_CLIENT_SECRET = 'test-secret';
    const rawBody = Buffer.from('{"id":17}'), signature = createHmac('sha256', 'test-secret').update(rawBody).digest('base64');
    expect(await shopify.verifyWebhook({ organizationId: 'org', connectorInstanceId: 'c' }, { eventId: 'evt', eventType: 'products/update', timestamp: 1, rawBody, payload: {} }, { 'x-shopify-hmac-sha256': signature, 'x-shopify-shop-domain': 'sample.myshopify.com' }, { shopDomain: 'sample.myshopify.com' })).toBe(true);
    expect(await shopify.verifyWebhook({ organizationId: 'org', connectorInstanceId: 'c' }, { eventId: 'evt', eventType: 'products/update', timestamp: 1, rawBody, payload: {} }, { 'x-shopify-hmac-sha256': signature, 'x-shopify-shop-domain': 'other.myshopify.com' }, { shopDomain: 'sample.myshopify.com' })).toBe(false);
    delete process.env.SHOPIFY_CLIENT_SECRET;
  });
  it('verifies WooCommerce with a real products request and only grants permitted order capability', async () => {
    http.request.mockResolvedValueOnce({ status: 200, headers: {}, body: Buffer.from('[]') }).mockResolvedValueOnce({ status: 403, headers: {}, body: Buffer.from('{}') });
    const result = await woo.verify({ organizationId: 'org', connectorInstanceId: 'c' }, { storeUrl: 'https://shop.example.com' }, { consumerKey: 'ck_test_12345678', consumerSecret: 'cs_test_12345678' });
    expect(result.capabilities).toContain('PRODUCT_CATALOG');
    expect(result.capabilities).not.toContain('ORDERS');
  });
  it('normalizes provider products without inventing currency or inventory', async () => {
    http.request.mockResolvedValue({ status: 200, headers: { 'x-wp-totalpages': '1' }, body: Buffer.from(JSON.stringify([{ id: 7, name: 'Item', price: '12.5000', stock_quantity: null, stock_status: 'instock', status: 'publish', permalink: 'https://shop.example.com/item', images: [], variations: [], date_modified_gmt: '2026-01-01T00:00:00' }])) });
    const page = await woo.sync({ organizationId: 'org', connectorInstanceId: 'c' }, { resourceType: 'PRODUCTS', mode: 'FULL' }, { storeUrl: 'https://shop.example.com' }, { consumerKey: 'ck_test_12345678', consumerSecret: 'cs_test_12345678' });
    expect(page.records?.[0]).toMatchObject({ kind: 'PRODUCT', externalId: '7', price: '12.5000', currency: null, inventory: null });
  });
  it('preserves WooCommerce publication and stock status independently and never converts missing stock to zero', async () => {
    http.request.mockResolvedValue({ status: 200, headers: { 'x-wp-totalpages': '1' }, body: Buffer.from(JSON.stringify([{ id: 8, name: 'Back order', price: '0.00', stock_quantity: null, stock_status: 'onbackorder', status: 'publish', variations: [], images: [], date_modified_gmt: '2026-10-01T00:00:00' }])) });
    const page = await woo.sync({ organizationId: 'org', connectorInstanceId: 'c' }, { resourceType: 'PRODUCTS', mode: 'FULL' }, { storeUrl: 'https://shop.example.com' }, { consumerKey: 'ck_test_12345678', consumerSecret: 'cs_test_12345678' });
    expect(page.records?.[0]).toMatchObject({ inventory: null, availability: 'ONBACKORDER', status: 'publish', price: '0.00' });
  });
  it('retries a WooCommerce page on rate limits instead of treating it as completed', async () => {
    http.request.mockResolvedValue({ status: 429, headers: { 'retry-after': '3' }, body: Buffer.from('{}') });
    await expect(woo.sync({ organizationId: 'org', connectorInstanceId: 'c' }, { resourceType: 'PRODUCTS', mode: 'FULL' }, { storeUrl: 'https://shop.example.com' }, { consumerKey: 'ck_test_12345678', consumerSecret: 'cs_test_12345678' })).rejects.toThrow('CONNECTOR_RATE_LIMITED');
  });
  it('rejects a WooCommerce webhook with a mismatched source even when its signature is valid', async () => {
    const rawBody = Buffer.from('{"id":17}'), secret = 'long-webhook-secret-12345';
    const signature = createHmac('sha256', secret).update(rawBody).digest('base64');
    expect(await woo.verifyWebhook({ organizationId: 'org', connectorInstanceId: 'c' }, { eventId: 'evt', eventType: 'product.updated', timestamp: 1, rawBody, payload: {} }, { 'x-wc-webhook-signature': signature, 'x-wc-webhook-source': 'https://attacker.example' }, { storeUrl: 'https://shop.example.com' }, { webhookSecret: secret })).toBe(false);
  });
  it('validates WooCommerce HTTPS and requires both API credentials', async () => {
    await expect(woo.connect({ organizationId: 'org', connectorInstanceId: 'c' }, { storeUrl: 'http://shop.example.com' }, { consumerKey: 'ck_test_12345678', consumerSecret: 'cs_test_12345678' })).rejects.toThrow('CONNECTOR_CONFIG_INVALID');
    await expect(woo.connect({ organizationId: 'org', connectorInstanceId: 'c' }, { storeUrl: 'https://shop.example.com' }, { consumerKey: 'ck_test_12345678' })).rejects.toThrow('CONNECTOR_CREDENTIALS_REQUIRED');
  });
  it('uses a real provider cursor and requests changes after the last successful checkpoint', async () => {
    http.post.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify({ data: { shop: { currencyCode: 'USD' }, products: { pageInfo: { hasNextPage: true, endCursor: 'next-page' }, nodes: [] } } })) });
    const page = await shopify.sync({ organizationId: 'org', connectorInstanceId: 'c' }, { resourceType: 'PRODUCTS', mode: 'INCREMENTAL', checkpoint: { updatedAt: '2026-10-01T00:00:00.000Z' } }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' });
    expect(page).toMatchObject({ complete: false, cursor: 'next-page', records: [] });
    const request = JSON.parse(http.post.mock.calls[0][2]);
    expect(request.variables.filter).toContain("updated_at:>='2026-10-01T00:00:00.000Z'");
  });
  it('normalizes Shopify product type, taxonomy, collections, variant options, compare-at price, and safe image metadata', async () => {
    http.post.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify({ data: { shop: { currencyCode: 'USD' }, products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'gid://shopify/Product/9', title: 'Blue shirt', descriptionHtml: '<p>Cotton</p>', handle: 'blue-shirt', productType: 'Apparel', vendor: 'Acme', status: 'ACTIVE', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', category: { id: 'gid://shopify/TaxonomyCategory/aa-1', name: 'Apparel & Accessories' }, onlineStoreUrl: 'https://shop.example/products/blue-shirt', featuredImage: { url: 'https://cdn.example/blue.jpg', altText: 'Blue shirt', width: 800, height: 800 }, images: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, collections: { nodes: [{ id: 'gid://shopify/Collection/2', title: 'Summer', handle: 'summer', ruleSet: null }], pageInfo: { hasNextPage: false, endCursor: null } }, variants: { nodes: [{ id: 'gid://shopify/ProductVariant/3', title: 'Blue / M', sku: 'BLUE-M', price: '20.00', compareAtPrice: '25.00', selectedOptions: [{ name: 'Color', value: 'Blue' }, { name: 'Size', value: 'M' }] }], pageInfo: { hasNextPage: false, endCursor: null } } }] } } })) });
    const page = await shopify.sync({ organizationId: 'org', connectorInstanceId: 'c' }, { resourceType: 'PRODUCTS', mode: 'FULL' }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' });
    expect(page.records?.[0]).toMatchObject({ kind: 'PRODUCT', externalId: 'gid://shopify/Product/9', productType: 'Apparel', taxonomyCategoryId: 'gid://shopify/TaxonomyCategory/aa-1', taxonomyCategory: 'Apparel & Accessories', vendor: 'Acme', handle: 'blue-shirt', collections: [{ externalId: 'gid://shopify/Collection/2', title: 'Summer', handle: 'summer', membershipType: 'MANUAL' }], price: '20.00', compareAtPrice: '25.00', imageUrl: 'https://cdn.example/blue.jpg', imageAltText: 'Blue shirt', imageWidth: 800, imageHeight: 800, createdAt: '2026-10-01T00:00:00Z', variants: [{ selectedOptions: [{ name: 'Color', value: 'Blue' }, { name: 'Size', value: 'M' }], compareAtPrice: '25.00' }] });
  });
  it('syncs verified Shopify locations as scoped, normalized knowledge records', async () => {
    http.post.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify({ data: { locations: { nodes: [{ id: 'gid://shopify/Location/2', name: 'Main Store', isActive: true, fulfillsOnlineOrders: true, address: { formatted: '1 Main Street, Toronto' } }], pageInfo: { hasNextPage: false, endCursor: null } } } })) });
    const page = await shopify.sync({ organizationId: 'tenant-a', connectorInstanceId: 'connector-a' }, { resourceType: 'CONTENT', mode: 'FULL', enabledCategories: ['SHOPIFY_LOCATIONS'], grantedScopes: ['read_locations'] }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' });
    expect(page.records?.[0]).toMatchObject({ kind: 'KNOWLEDGE', externalId: 'gid://shopify/Location/2', permissionCategory: 'SHOPIFY_LOCATIONS', title: 'Shopify location: Main Store' });
    expect(page.records?.[0]?.kind === 'KNOWLEDGE' ? page.records[0].content : '').toContain('Toronto');
    expect(JSON.parse(http.post.mock.calls[0][2]).query).toContain('locations(first:50');
  });
  it('does not issue a Shopify content query when the current verified grants omit its scope', async () => {
    await expect(shopify.sync({ organizationId: 'tenant-a', connectorInstanceId: 'connector-a' }, { resourceType: 'CONTENT', mode: 'FULL', enabledCategories: ['SHOPIFY_LOCATIONS'], grantedScopes: [] }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' })).rejects.toThrow('CONNECTOR_SCOPE_NOT_GRANTED');
    expect(http.post).not.toHaveBeenCalled();
  });
  it('returns a retryable connector rate-limit error for Shopify HTTP and GraphQL throttling', async () => {
    http.post.mockResolvedValueOnce({ status: 429, body: Buffer.from('{}') });
    await expect(shopify.sync({ organizationId: 'tenant-a', connectorInstanceId: 'connector-a' }, { resourceType: 'CONTENT', mode: 'FULL', enabledCategories: ['SHOPIFY_LOCATIONS'], grantedScopes: ['read_locations'] }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' })).rejects.toThrow('CONNECTOR_RATE_LIMITED');
    http.post.mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify({ errors: [{ extensions: { code: 'THROTTLED' } }] })) });
    await expect(shopify.sync({ organizationId: 'tenant-a', connectorInstanceId: 'connector-a' }, { resourceType: 'CONTENT', mode: 'FULL', enabledCategories: ['SHOPIFY_LOCATIONS'], grantedScopes: ['read_locations'] }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' })).rejects.toThrow('CONNECTOR_RATE_LIMITED');
  });
  it('continues Shopify online-page pagination and strips active script markup before indexing', async () => {
    http.post.mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify({ data: { pages: { nodes: [{ id: 'page-1', title: 'About', handle: 'about', body: '<p>Welcome</p><script>secret()</script>', updatedAt: '2026-10-01T00:00:00Z' }], pageInfo: { hasNextPage: true, endCursor: 'page-cursor-1' } } } })) }).mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify({ data: { pages: { nodes: [{ id: 'page-2', title: 'Returns', handle: 'returns', bodySummary: 'Our returns policy' }], pageInfo: { hasNextPage: false, endCursor: 'page-cursor-2' } } } })) });
    const first = await shopify.sync({ organizationId: 'tenant-a', connectorInstanceId: 'connector-a' }, { resourceType: 'CONTENT', mode: 'FULL', enabledCategories: ['SHOPIFY_ONLINE_STORE_PAGES'], grantedScopes: ['read_online_store_pages'] }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' });
    const next = await shopify.sync({ organizationId: 'tenant-a', connectorInstanceId: 'connector-a' }, { resourceType: 'CONTENT', mode: 'FULL', cursor: first.cursor, enabledCategories: ['SHOPIFY_ONLINE_STORE_PAGES'], grantedScopes: ['read_online_store_pages'] }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' });
    expect(first).toMatchObject({ complete: false, cursor: 'content:SHOPIFY_ONLINE_STORE_PAGES:page-cursor-1' });
    expect(first.records?.[0]).toMatchObject({ kind: 'KNOWLEDGE', permissionCategory: 'SHOPIFY_ONLINE_STORE_PAGES', content: 'Welcome' });
    expect(JSON.stringify(first.records)).not.toContain('secret()');
    expect(next).toMatchObject({ complete: true, records: [{ kind: 'KNOWLEDGE', externalId: 'page-2', title: 'Shopify online store page: Returns' }] });
    expect(JSON.parse(http.post.mock.calls[1][2]).variables).toEqual({ after: 'page-cursor-1' });
  });
  it.each([
    ['SHOPIFY_SHIPPING', 'read_shipping', 'deliveryProfiles', { id: 'profile-1' }],
    ['SHOPIFY_LEGAL_POLICIES', 'read_legal_policies', 'shopPolicies', { id: 'policy-1', title: 'Returns', body: 'Return policy' }],
    ['SHOPIFY_MARKETS', 'read_markets', 'markets', { id: 'market-1', name: 'Canada' }],
    ['SHOPIFY_DISCOUNTS', 'read_discounts', 'discountNodes', { id: 'discount-1', discount: { __typename: 'DiscountCodeBasic', title: 'WELCOME' } }],
    ['SHOPIFY_METAOBJECT_DEFINITIONS', 'read_metaobject_definitions', 'metaobjectDefinitions', { id: 'definition-1', name: 'Author', type: 'author' }],
  ])('queries and normalizes %s only when its verified scope is supplied', async (category, scope, root, node) => {
    const connection = { nodes: [node], pageInfo: { hasNextPage: false, endCursor: null } };
    http.post.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify({ data: root === 'shopPolicies' ? { shop: { shopPolicies: [node] } } : { [root]: connection } })) });
    const page = await shopify.sync({ organizationId: 'tenant-a', connectorInstanceId: 'connector-a' }, { resourceType: 'CONTENT', mode: 'FULL', enabledCategories: [category], grantedScopes: [scope] }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' });
    expect(page.records?.[0]).toMatchObject({ kind: 'KNOWLEDGE', permissionCategory: category });
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(JSON.parse(http.post.mock.calls[0][2]).query).toContain(root === 'shopPolicies' ? 'shopPolicies' : root);
  });
  it('registers metaobject reads only behind both definition and entry scopes', () => {
    const operation = SHOPIFY_SCOPE_OPERATION_REGISTRY.read_metaobjects[0];
    expect(operation.requiredScopes).toEqual(['read_metaobjects', 'read_metaobject_definitions']);
    expect(operation.executable).toBe(true);
    expect(operation.assistantEligible).toBe(true);
  });
  it('rejects private, sensitive, or unknown metaobject definition fields', () => {
    const base = { type: 'faq', access: { storefront: 'PUBLIC_READ' }, fieldDefinitions: [{ key: 'question', type: { name: 'single_line_text_field' } }, { key: 'answer', type: { name: 'multi_line_text_field' } }] };
    expect(isPublicSafeMetaobjectDefinition(base)).toBe(true);
    expect(isPublicSafeMetaobjectDefinition({ ...base, access: { storefront: 'NONE' } })).toBe(false);
    expect(isPublicSafeMetaobjectDefinition({ ...base, fieldDefinitions: [...base.fieldDefinitions, { key: 'customer_email', type: { name: 'single_line_text_field' } }] })).toBe(false);
    expect(isPublicSafeMetaobjectDefinition({ ...base, fieldDefinitions: [{ key: 'question', type: { name: 'list.metaobject_reference' } }] })).toBe(false);
  });
  it('syncs entries only for currently public safe definitions and filters undeclared entry fields', async () => {
    const definition = { id: 'definition-1', type: 'faq', access: { storefront: 'PUBLIC_READ' }, fieldDefinitions: [{ key: 'question', type: { name: 'single_line_text_field' } }, { key: 'answer', type: { name: 'multi_line_text_field' } }] };
    const definitions = { nodes: [definition, { ...definition, type: 'private', access: { storefront: 'NONE' } }], pageInfo: { hasNextPage: false, endCursor: null } };
    http.post.mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify({ data: { metaobjectDefinitions: definitions } })) })
      .mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify({ data: { metaobjectDefinitions: definitions } })) })
      .mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify({ data: { metaobjects: { nodes: [{ id: 'entry-1', handle: 'returns', type: 'faq', updatedAt: '2026-10-01T00:00:00Z', fields: [{ key: 'question', value: 'How do returns work?' }, { key: 'answer', value: '<p>Contact us</p><script>ignore()</script>' }, { key: 'customer_email', value: 'private@example.com' }] }], pageInfo: { hasNextPage: false, endCursor: null } } } })) });
    const page = await shopify.sync({ organizationId: 'tenant-a', connectorInstanceId: 'connector-a' }, { resourceType: 'CONTENT', mode: 'FULL', enabledCategories: ['SHOPIFY_METAOBJECTS'], grantedScopes: ['read_metaobjects', 'read_metaobject_definitions'] }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' });
    expect(page.records?.[0]).toMatchObject({ kind: 'KNOWLEDGE', permissionCategory: 'SHOPIFY_METAOBJECTS', visibility: 'PUBLIC_REFERENCE', title: 'Public Shopify content (faq): returns' });
    expect(JSON.stringify(page.records)).toContain('Contact us');
    expect(JSON.stringify(page.records)).not.toContain('private@example.com');
    expect(JSON.stringify(page.records)).not.toContain('ignore()');
    expect(JSON.parse(http.post.mock.calls[2][2]).variables).toMatchObject({ type: 'faq', after: null });
  });
  it('continues collection pagination to include remaining pages', async () => {
    http.post.mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify({ data: { shop: { currencyCode: 'USD' }, products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'gid://shopify/Product/9', title: 'Item', images: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, collections: { nodes: [{ id: 'c1', title: 'One' }], pageInfo: { hasNextPage: true, endCursor: 'collections-next' } }, variants: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }] } } })) }).mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify({ data: { node: { collections: { nodes: [{ id: 'c2', title: 'Two' }], pageInfo: { hasNextPage: false, endCursor: null } } } } })) });
    const page = await shopify.sync({ organizationId: 'org', connectorInstanceId: 'c' }, { resourceType: 'PRODUCTS', mode: 'FULL' }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' });
    expect(page.records?.[0]).toMatchObject({ collections: [{ externalId: 'c1', title: 'One' }, { externalId: 'c2', title: 'Two' }] });
  });
  it('retrieves product images across cursors in order and removes duplicate IDs', async () => {
    http.post.mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify({ data: { shop: { currencyCode: 'USD' }, products: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'gid://shopify/Product/10', title: 'Many images', images: { nodes: [{ id: 'image-1', url: 'https://cdn.example/1.jpg', altText: 'One', width: 100, height: 90 }, { id: 'image-2', url: 'https://cdn.example/2.jpg', altText: 'Two', width: 200, height: 190 }], pageInfo: { hasNextPage: true, endCursor: 'image-next' } }, collections: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, variants: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }] } } })) }).mockResolvedValueOnce({ status: 200, body: Buffer.from(JSON.stringify({ data: { node: { images: { nodes: [{ id: 'image-2', url: 'https://cdn.example/duplicate.jpg' }, { id: 'image-3', url: 'https://cdn.example/3.jpg', altText: 'Three', width: 300, height: 290 }], pageInfo: { hasNextPage: false, endCursor: 'image-last' } } } } })) });
    const page = await shopify.sync({ organizationId: 'org', connectorInstanceId: 'c' }, { resourceType: 'PRODUCTS', mode: 'FULL' }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' });
    expect(page.records?.[0]).toMatchObject({ imagesComplete: true, imageEvidence: [{ externalId: 'image-1', altText: 'One', width: 100 }, { externalId: 'image-2', altText: 'Two', width: 200 }, { externalId: 'image-3', altText: 'Three', width: 300 }] });
    expect(JSON.parse(http.post.mock.calls[1][2]).variables).toEqual({ id: 'gid://shopify/Product/10', after: 'image-next' });
  });
  it('fails shipping sync when nested delivery zone or method pages are truncated', async () => {
    const response = {
      data: {
        deliveryProfiles: {
          nodes: [
            {
              id: 'profile-1',
              profileLocationGroups: [
                {
                  locationGroup: {
                    locations: {
                      nodes: [],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                  locationGroupZones: {
                    edges: [
                      {
                        node: {
                          methodDefinitions: {
                            edges: [],
                            pageInfo: { hasNextPage: true, endCursor: 'method-next' },
                          },
                        },
                      },
                    ],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              ],
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };
    http.post.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify(response)) });
    await expect(shopify.sync({ organizationId: 'org', connectorInstanceId: 'c' }, { resourceType: 'CONTENT', mode: 'FULL', enabledCategories: ['SHOPIFY_SHIPPING'], grantedScopes: ['read_shipping'] }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' })).rejects.toThrow('CONNECTOR_NESTED_PAGINATION_INCOMPLETE');
    expect(JSON.parse(http.post.mock.calls[0][2]).query).toContain('locationGroupZones(first:250)');
    expect(JSON.parse(http.post.mock.calls[0][2]).query).toContain('methodDefinitions(first:250)');
  });
  it('normalizes Shopify order totals and provider update time without selecting customer data', async () => {
    http.post.mockResolvedValue({ status: 200, body: Buffer.from(JSON.stringify({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'gid://shopify/Order/1', name: '#1001', displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'FULFILLED', currencyCode: 'USD', totalPriceSet: { shopMoney: { amount: '12.50' } }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', lineItems: { nodes: [{ id: 'line-1', name: 'Book', sku: 'B1', quantity: 1, variant: { id: 'gid://shopify/ProductVariant/1' }, originalUnitPriceSet: { shopMoney: { amount: '12.50' } }, discountedTotalSet: { shopMoney: { amount: '12.50' } } }], pageInfo: { hasNextPage: false, endCursor: null } } }] } } })) });
    const page = await shopify.sync({ organizationId: 'org', connectorInstanceId: 'c' }, { resourceType: 'ORDERS', mode: 'FULL' }, { shopDomain: 'sample.myshopify.com' }, { accessToken: 'opaque-token-value-12345' });
    expect(page.records?.[0]).toMatchObject({ kind: 'ORDER', externalId: 'gid://shopify/Order/1', total: '12.50', updatedAt: '2026-10-02T00:00:00Z', linesComplete: true });
    expect(http.post.mock.calls[0][2]).not.toContain('email');
  });
});
