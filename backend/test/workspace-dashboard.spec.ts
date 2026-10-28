import 'reflect-metadata';
import type { PrismaService } from '../src/infrastructure/database/prisma.service';
import { WorkspaceService } from '../src/modules/workspaces/workspace.service';

function dashboardDatabase() {
  return {
    organization: { findUnique: jest.fn().mockResolvedValue({ businessType: 'ECOMMERCE', websiteUrl: null, timezone: 'UTC', updatedAt: new Date() }) },
    integrationConnection: {
      groupBy: jest.fn().mockResolvedValue([{ state: 'CONNECTED', _count: { _all: 1 } }]),
      findMany: jest.fn().mockResolvedValue([{ id: 'connection-1', platform: 'SHOPIFY', displayName: 'Store', state: 'CONNECTED', lastSyncAt: null, lastSuccessfulSyncAt: null, lastErrorCode: null }]),
    },
    commerceProduct: {
      count: jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(1),
      groupBy: jest.fn().mockResolvedValue([{ rawStatus: 'active', _count: { _all: 3 } }, { rawStatus: 'draft', _count: { _all: 1 } }]),
    },
    commerceOrder: {
      count: jest.fn().mockResolvedValue(2),
      groupBy: jest.fn().mockResolvedValue([{ financialStatus: 'paid', _count: { _all: 2 } }]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    chatbot: {
      groupBy: jest.fn().mockResolvedValue([{ status: 'ACTIVE', _count: { _all: 1 } }]),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue({ id: 'assistant-1' }),
    },
    knowledgeBase: { count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue(null) },
    knowledgeSource: { groupBy: jest.fn().mockResolvedValue([]) },
    auditEvent: { findMany: jest.fn().mockResolvedValue([]) },
    playgroundConversation: { count: jest.fn().mockResolvedValue(3) },
    $queryRaw: jest.fn().mockResolvedValue([{ currency: 'INR', orderCount: 2, netSales: '2400.00' }]),
  };
}

describe('workspace dashboard aggregates', () => {
  it('returns tenant-scoped commerce and training data without mixing currency totals', async () => {
    const db = dashboardDatabase();
    const service = new WorkspaceService(db as unknown as PrismaService);
    jest.spyOn(service, 'requireAccess').mockResolvedValue({ organizationId: 'org-1', role: 'OWNER' });

    const summary = await service.dashboardSummary('user-1', 'shop');

    expect(db.commerceProduct.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1' }) }));
    expect(db.commerceOrder.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1' }) }));
    expect(summary).toMatchObject({
      workspace: { businessType: 'ECOMMERCE', role: 'owner' },
      integrations: { connectedCount: 1 },
      commerce: { status: 'AVAILABLE', productCount: 4, activeProductCount: 3, outOfStockCount: 1, orderCount: 2 },
      sales: { status: 'AVAILABLE', currencyTotals: [{ currency: 'INR', netSales: '2400.00' }] },
      playground: { status: 'success', data: { sessions: 3, kind: 'PLAYGROUND_ONLY' } },
    });
  });

  it('does not execute or expose sales aggregates to workspace members', async () => {
    const db = dashboardDatabase();
    const service = new WorkspaceService(db as unknown as PrismaService);
    jest.spyOn(service, 'requireAccess').mockResolvedValue({ organizationId: 'org-1', role: 'MEMBER' });

    const summary = await service.dashboardSummary('user-2', 'shop');

    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(summary.sales).toEqual({ status: 'PERMISSION_REQUIRED' });
  });
});
