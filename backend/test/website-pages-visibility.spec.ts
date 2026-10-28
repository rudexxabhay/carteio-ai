import { ForbiddenException } from '@nestjs/common';
import { KnowledgeProcessingService } from '../src/modules/workspaces/knowledge-processing.service';

describe('stored website page visibility', () => {
  const source = { id: 'source-a', name: 'Store site', sourceUrl: 'https://shop.example', verificationStatus: 'UNVERIFIED', verifiedAt: null, visibility: 'PUBLIC_REFERENCE', syncPolicy: 'MANUAL', syncPaused: false, processingStatus: 'READY', activeIndexGeneration: 2, sourceVersion: 3, processingErrorCode: null, semanticIndexStatus: 'READY', semanticIndexErrorCode: null, lastSyncErrorCode: null, assistantLinks: [{ assistant: { id: 'assistant-a', name: 'Store assistant', status: 'ACTIVE', website: { domain: 'shop.example', status: 'ACTIVE', verificationStatus: 'VERIFIED' } } }], knowledgeBaseLinks: [], syncRuns: [] };
  const page = { id: 'page-a', sourceId: 'source-a', organizationId: 'org-a', title: 'Returns', canonicalUrl: 'https://shop.example/returns', pageCategory: 'RETURNS', status: 'READY', content: 'Our return policy is available within 30 days.', contentHash: 'a'.repeat(64), sourceVersion: 3, generation: 2, fetchedAt: new Date('2026-01-01T00:00:00Z'), indexedAt: new Date('2026-01-01T00:01:00Z'), source };

  function setup(role = 'OWNER') {
    const db: any = {
      knowledgePage: { findMany: jest.fn().mockResolvedValue([page]), count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue(page) },
      knowledgeSource: { findMany: jest.fn().mockResolvedValue([{ ...source, _count: { pages: 1 }, lastSyncAttemptAt: page.fetchedAt, lastSuccessfulSyncAt: page.fetchedAt }]), findFirst: jest.fn() },
      knowledgeChunk: { count: jest.fn().mockResolvedValue(2), groupBy: jest.fn().mockResolvedValue([{ pageId: 'page-a', sourceVersion: 3, generation: 2, _count: { _all: 2 } }]) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'page-a', preview: page.content.slice(0, 360) }]),
    };
    const workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-a', role }) };
    const service = new KnowledgeProcessingService(db, workspaces as any, {} as any, {} as any);
    return { service, db, workspaces };
  }

  it('lists actual saved tenant pages with current-generation chunk readiness and source assignment', async () => {
    const { service, db } = setup();
    const result = await service.listWebsitePages('user-a', 'workspace-a', { page: 1, pageSize: 20, search: 'returns' });
    expect(db.knowledgePage.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: 20, where: expect.objectContaining({ organizationId: 'org-a', source: { is: expect.objectContaining({ organizationId: 'org-a', type: 'WEBSITE', status: 'REGISTERED' }) } }) }));
    expect(result.pages[0]).toMatchObject({ id: 'page-a', title: 'Returns', indexedChunkCount: 2, searchReady: true, assignedAssistants: [{ id: 'assistant-a', name: 'Store assistant' }] });
    expect(result.sources[0]).toMatchObject({ pageCount: 1, syncPolicy: 'MANUAL' });
  });

  it('returns stored full page content only through the manager-scoped detail method', async () => {
    const { service, db } = setup();
    const result = await service.getWebsitePage('user-a', 'workspace-a', 'page-a');
    expect(db.knowledgePage.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'page-a', organizationId: 'org-a' }) }));
    expect(result.content).toContain('30 days');
    expect(result.searchReady).toBe(true);
  });

  it('keeps indexed public knowledge ready even when no assistant matches the widget domain', async () => {
    const linkedButIneligible = { ...source, assistantLinks: [], knowledgeBaseLinks: [{ knowledgeBase: { assistantLinks: [{ assistant: { id: 'assistant-b', name: 'Support Draft', status: 'DRAFT', website: { domain: null, status: 'INACTIVE', verificationStatus: 'UNVERIFIED' } } }] } }] };
    const row = { ...page, source: linkedButIneligible };
    const { service, db } = setup();
    db.knowledgePage.findMany.mockResolvedValue([row]);
    db.knowledgeSource.findMany.mockResolvedValue([{ ...linkedButIneligible, _count: { pages: 1 }, lastSyncAttemptAt: page.fetchedAt, lastSuccessfulSyncAt: null }]);
    const result = await service.listWebsitePages('user-a', 'workspace-a', { page: 1, pageSize: 20 });
    expect(result.pages[0]).toMatchObject({ assignedAssistants: [], linkedAssistants: [{ id: 'assistant-b', name: 'Support Draft' }], domainEligibleAssistants: [], searchReady: true, availability: 'AI_READY' });
    expect(result.sources[0]).toMatchObject({ assignedAssistants: [], linkedAssistants: [{ id: 'assistant-b', name: 'Support Draft' }], domainEligibleAssistants: [], freshness: 'UNAVAILABLE' });
  });

  it('does not report AI readiness while source processing is still pending', async () => {
    const processing = { ...source, processingStatus: 'PROCESSING' };
    const row = { ...page, source: processing };
    const { service, db } = setup();
    db.knowledgePage.findMany.mockResolvedValue([row]);
    const result = await service.listWebsitePages('user-a', 'workspace-a', { page: 1, pageSize: 20 });
    expect(result.pages[0]).toMatchObject({ searchReady: false, availability: 'INDEX_PENDING' });
  });

  it('blocks members without owner/admin access from viewing saved page contents', async () => {
    const { service, workspaces } = setup('MEMBER');
    workspaces.requireAccess.mockRejectedValue(new ForbiddenException());
    await expect(service.getWebsitePage('user-a', 'workspace-a', 'page-a')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps an empty database state empty instead of synthesizing page counts', async () => {
    const { service, db } = setup();
    db.knowledgePage.findMany.mockResolvedValue([]); db.knowledgePage.count.mockResolvedValue(0); db.knowledgeSource.findMany.mockResolvedValue([]);
    const result = await service.listWebsitePages('user-a', 'workspace-a', { page: 1, pageSize: 20 });
    expect(result).toMatchObject({ pages: [], sources: [], total: 0, pageCount: 0 });
  });
});
