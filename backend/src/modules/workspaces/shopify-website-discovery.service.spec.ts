import { ShopifyWebsiteDiscoveryService } from './shopify-website-discovery.service';

describe('Shopify website discovery authorization', () => {
  const db: any = { connectorInstance: { findFirst: jest.fn() }, knowledgeSource: { findFirst: jest.fn() } };
  const workspaces: any = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'tenant-a' }) };
  const knowledge: any = { createShopifyDiscoveredWebsite: jest.fn() };
  const processing: any = { enqueueWebsite: jest.fn() };
  const verification: any = { challenge: jest.fn(), verify: jest.fn() };
  const service = new ShopifyWebsiteDiscoveryService(db, workspaces, knowledge, processing, verification);
  beforeEach(() => jest.clearAllMocks());

  it('registers Shopify primary storefront metadata as a normal unverified website source', async () => {
    db.connectorInstance.findFirst.mockResolvedValue({ id: 'connector-a', commerceConnection: { siteUrl: 'https://shop.example.com' } });
    db.knowledgeSource.findFirst.mockResolvedValueOnce(null);
    knowledge.createShopifyDiscoveredWebsite.mockResolvedValue({ id: 'website-a', sourceUrl: 'https://shop.example.com/', verificationStatus: 'UNVERIFIED', verifiedAt: null });

    const result = await service.discover('user-a', 'workspace-a', 'connector-a');

    expect(workspaces.requireAccess).toHaveBeenCalledWith('user-a', 'workspace-a', ['OWNER', 'ADMIN']);
    expect(knowledge.createShopifyDiscoveredWebsite).toHaveBeenCalledWith('user-a', 'workspace-a', expect.objectContaining({ sourceUrl: 'https://shop.example.com/', visibility: 'PUBLIC_REFERENCE' }));
    expect(result).toMatchObject({ sourceId: 'website-a', authorizationStatus: 'UNVERIFIED', crawlAllowed: false });
    expect(processing.enqueueWebsite).not.toHaveBeenCalled();
  });

  it('refuses unsafe storefront URL metadata instead of registering a crawl source', async () => {
    db.connectorInstance.findFirst.mockResolvedValue({ id: 'connector-a', commerceConnection: { siteUrl: 'https://127.0.0.1/' } });
    await expect(service.discover('user-a', 'workspace-a', 'connector-a')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'SHOPIFY_STOREFRONT_DOMAIN_INVALID' }) });
    expect(knowledge.createShopifyDiscoveredWebsite).not.toHaveBeenCalled();
  });

  it('loads only a connected Shopify instance owned by the requested tenant', async () => {
    db.connectorInstance.findFirst.mockResolvedValue(null);
    await expect(service.status('user-a', 'workspace-a', 'connector-other')).rejects.toMatchObject({ response: expect.objectContaining({ code: 'SHOPIFY_CONNECTION_NOT_FOUND' }) });
    expect(db.connectorInstance.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'connector-other', organizationId: 'tenant-a', connectorId: 'shopify_v1', state: 'CONNECTED' }) }));
  });
});
