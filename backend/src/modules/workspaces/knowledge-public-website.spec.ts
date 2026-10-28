import { BadRequestException } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';

describe('website knowledge registration', () => {
  it('registers a normalized website only in the authorized organization', async () => {
    const source = {
      id: 'source-1', organizationId: 'org-1', createdById: 'user-1', type: 'WEBSITE',
      status: 'REGISTERED', processingStatus: 'QUEUED', visibility: 'PUBLIC_REFERENCE',
      name: 'shop.example.com', description: null, sourceUrl: 'https://shop.example.com/catalog',
      contentBody: null, category: null, languageHint: null, sourceVersion: 1,
      lastSyncAt: null, lastSuccessfulSyncAt: null, lastSyncErrorCode: null,
      activeIndexGeneration: null, processingErrorCode: null, semanticIndexStatus: 'NOT_CONFIGURED',
      semanticIndexErrorCode: null, verificationStatus: 'UNVERIFIED', verifiedAt: null,
      syncPolicy: 'MANUAL', syncPaused: false, nextSyncAt: null, lastSyncAttemptAt: null,
      crawlPathPrefix: '/', crawlMaxPages: 100, crawlMaxDepth: 3, deletedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'), updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const tx = {
      knowledgeSource: { create: jest.fn().mockResolvedValue(source) },
      knowledgeProcessingJob: { create: jest.fn().mockResolvedValue({ id: 'job-1' }) },
      knowledgeSyncRun: { create: jest.fn().mockResolvedValue({ id: 'run-1' }) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = { $transaction: jest.fn((callback: (client: any) => unknown) => callback(tx)) };
    const workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-1', role: 'OWNER' }) };
    const service = new KnowledgeService(prisma as never, workspaces as never);

    const result = await service.createWebsite('user-1', 'workspace', {
      sourceUrl: 'https://SHOP.example.com/catalog/#overview',
    });

    expect(workspaces.requireAccess).toHaveBeenCalledWith('user-1', 'workspace', ['OWNER', 'ADMIN']);
    expect(tx.knowledgeSource.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: 'org-1', createdById: 'user-1', type: 'WEBSITE',
        sourceUrl: 'https://shop.example.com/catalog', name: 'shop.example.com',
        visibility: 'PUBLIC_REFERENCE', status: 'REGISTERED', processingStatus: 'QUEUED',
        syncPolicy: 'MANUAL', lastSyncAttemptAt: expect.any(Date),
      }),
    }));
    expect(tx.knowledgeProcessingJob.create).toHaveBeenCalledWith({ data: { organizationId: 'org-1', sourceId: 'source-1', sourceVersion: 1, kind: 'CRAWL', status: 'QUEUED' }, select: { id: true } });
    expect(tx.knowledgeSyncRun.create).toHaveBeenCalledWith({ data: { organizationId: 'org-1', sourceId: 'source-1', jobId: 'job-1', status: 'QUEUED' } });
    expect(result).toMatchObject({ id: 'source-1', organizationId: 'org-1', type: 'website', verificationStatus: 'UNVERIFIED' });
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: 'org-1', actorUserId: 'user-1', action: 'knowledge.website_created' }),
    }));
  });

  it('rejects unsafe website URLs before persisting a source', async () => {
    const prisma = { $transaction: jest.fn() };
    const workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-1', role: 'OWNER' }) };
    const service = new KnowledgeService(prisma as never, workspaces as never);

    await expect(service.createWebsite('user-1', 'workspace', { sourceUrl: 'http://127.0.0.1/admin' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
