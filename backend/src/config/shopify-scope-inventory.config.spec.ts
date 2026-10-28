import {
  normalizeShopifyScopeInventory,
  SHOPIFY_SCOPE_INVENTORY_SOURCE,
  validateShopifyAdminReadScopeCandidates,
} from './shopify-scope-inventory.config';

describe('Shopify owner-supplied scope inventory', () => {
  const originalApiVersion = process.env.SHOPIFY_API_VERSION;
  beforeAll(() => { process.env.SHOPIFY_API_VERSION = '2026-10'; });
  afterAll(() => {
    if (originalApiVersion === undefined) delete process.env.SHOPIFY_API_VERSION;
    else process.env.SHOPIFY_API_VERSION = originalApiVersion;
  });

  it('normalizes, deduplicates and validates the full supplied inventory', () => {
    const normalized = normalizeShopifyScopeInventory();
    const sourceHandles = SHOPIFY_SCOPE_INVENTORY_SOURCE.split(/[\s,]+/).filter(Boolean);
    expect(normalized.malformed).toEqual([]);
    expect(normalized.duplicates).toEqual([]);
    expect(normalized.entries.map((entry) => entry.handle)).toEqual([...new Set(sourceHandles)]);
    expect(normalizeShopifyScopeInventory(' read_products, read_products ,bad;handle ').entries.map((entry) => entry.handle)).toEqual(['read_products']);
    expect(normalizeShopifyScopeInventory(' read_products, read_products ,bad;handle ').duplicates).toEqual(['read_products']);
    expect(normalizeShopifyScopeInventory(' read_products, read_products ,bad;handle ').malformed).toEqual(['bad;handle']);
  });

  it('separates Admin, Customer Account, Storefront and special scopes', () => {
    const { entries } = normalizeShopifyScopeInventory();
    expect(entries.find((entry) => entry.handle === 'read_products')).toMatchObject({ apiFamily: 'ADMIN_API', access: 'READ', risk: 'STANDARD', executable: false });
    expect(entries.find((entry) => entry.handle === 'read_content')).toMatchObject({ apiFamily: 'ADMIN_API', access: 'READ', risk: 'STANDARD', verification: 'DOCUMENTED_IN_2026_10' });
    expect(entries.find((entry) => entry.handle === 'read_app_proxy')).toMatchObject({ apiFamily: 'ADMIN_API', access: 'READ', verification: 'UNVERIFIED_FOR_CONFIGURED_API_VERSION' });
    expect(entries.find((entry) => entry.handle === 'customer_read_orders')).toMatchObject({ apiFamily: 'CUSTOMER_ACCOUNT_API', access: 'READ', risk: 'PROTECTED' });
    expect(entries.find((entry) => entry.handle === 'unauthenticated_write_checkouts')).toMatchObject({ apiFamily: 'STOREFRONT_API', access: 'WRITE' });
    expect(entries.find((entry) => entry.handle === 'shop_app:oauth')).toMatchObject({ apiFamily: 'SPECIAL_OR_UNSUPPORTED', access: 'OTHER', risk: 'UNKNOWN' });
    expect(entries.filter((entry) => entry.access === 'WRITE').every((entry) => entry.executable === false)).toBe(true);
  });

  it('accepts only version-documented, non-sensitive Admin read candidates', () => {
    expect(validateShopifyAdminReadScopeCandidates(['read_content'])).toEqual(['read_content']);
    expect(() => validateShopifyAdminReadScopeCandidates(['write_products'])).toThrow('SHOPIFY_SCOPE_UPGRADE_CANDIDATE_INVALID');
    expect(() => validateShopifyAdminReadScopeCandidates(['customer_read_customers'])).toThrow('SHOPIFY_SCOPE_UPGRADE_CANDIDATE_INVALID');
    expect(() => validateShopifyAdminReadScopeCandidates(['unauthenticated_read_product_listings'])).toThrow('SHOPIFY_SCOPE_UPGRADE_CANDIDATE_INVALID');
    expect(() => validateShopifyAdminReadScopeCandidates(['read_orders'])).toThrow('SHOPIFY_SCOPE_UPGRADE_CANDIDATE_INVALID');
  });
});
