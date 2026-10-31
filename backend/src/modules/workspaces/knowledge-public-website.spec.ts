import { BadRequestException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';

describe('Shopify-discovered website knowledge registration', () => {
  it('registers normalized public storefront metadata only in the authorized organization', async () => {
    const source = {
      id: 'source-1', organizationId: 'org-1', createdById: 'user-1', type: 'WEBSITE',
      status: 'REGISTERED', processingStatus: 'NOT_PROCESSED', visibility: 'PUBLIC_REFERENCE',
      name: 'shop.example.com', description: 'Storefront discovered from the authorized connection.', sourceUrl: 'https://shop.example.com/catalog',
      contentBody: null, category: 'SHOPIFY_STOREFRONT', languageHint: null, sourceVersion: 1,
      lastSyncAt: null, lastSuccessfulSyncAt: null, lastSyncErrorCode: null,
      activeIndexGeneration: null, processingErrorCode: null, semanticIndexStatus: 'NOT_CONFIGURED',
      semanticIndexErrorCode: null, verificationStatus: 'UNVERIFIED', verifiedAt: null, verificationTokenHash: null,
      syncPolicy: 'MANUAL', syncPaused: false, nextSyncAt: null, lastSyncAttemptAt: null,
      canonicalKey: 'website-key', crawlPathPrefix: '/', crawlMaxPages: 100, crawlMaxDepth: 3,
      knowledgeSection: null,
      deletedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const tx = {
      knowledgeSource: { create: jest.fn().mockResolvedValue(source) },
      knowledgeProcessingJob: { create: jest.fn() },
      knowledgeSyncRun: { create: jest.fn() },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback: (client: typeof tx) => unknown) => callback(tx)) };
    const workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-1', role: 'OWNER' }) };
    const service = new KnowledgeService(prisma as never, workspaces as never);

    const result = await service.createShopifyDiscoveredWebsite('user-1', 'workspace', {
      sourceUrl: 'https://SHOP.example.com/catalog/#overview', name: 'shop.example.com',
      description: 'Storefront discovered from the authorized connection.', visibility: 'PUBLIC_REFERENCE',
    });

    expect(workspaces.requireAccess).toHaveBeenCalledWith('user-1', 'workspace', ['OWNER', 'ADMIN']);
    expect(tx.knowledgeSource.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: 'org-1', createdById: 'user-1', type: 'WEBSITE',
        sourceUrl: 'https://shop.example.com/catalog', name: 'shop.example.com',
        category: 'SHOPIFY_STOREFRONT', description: 'Storefront discovered from the authorized connection.',
        visibility: 'PUBLIC_REFERENCE', status: 'REGISTERED', processingStatus: 'NOT_PROCESSED',
        verificationStatus: 'UNVERIFIED', syncPolicy: 'MANUAL',
      }),
    }));
    expect(tx.knowledgeProcessingJob.create).not.toHaveBeenCalled();
    expect(tx.knowledgeSyncRun.create).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: 'source-1', organizationId: 'org-1', type: 'website', verificationStatus: 'UNVERIFIED', processingStatus: 'not_processed' });
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: 'org-1', actorUserId: 'user-1', action: 'knowledge.shopify_storefront_discovered' }),
    }));
  });

  it('rejects unsafe website URLs before persisting a source', async () => {
    const prisma = { $transaction: jest.fn() };
    const workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-1', role: 'OWNER' }) };
    const service = new KnowledgeService(prisma as never, workspaces as never);

    await expect(service.createShopifyDiscoveredWebsite('user-1', 'workspace', {
      sourceUrl: 'http://127.0.0.1/admin', name: 'unsafe-host', description: 'Fixture', visibility: 'PUBLIC_REFERENCE',
    }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
