import { KnowledgeProcessingService } from './knowledge-processing.service';

describe('Shopify-backed knowledge permission filtering', () => {
  const grantedScopes = ['read_locations'];
  const verifiedAt = new Date();
  const prisma: any = {
    knowledgeSource: { findMany: jest.fn() },
    chatbot: { findFirst: jest.fn() },
    connectorInstance: { findMany: jest.fn() },
    connectorDataPermission: { findMany: jest.fn() },
    assistantConnectorDataPermission: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const workspaces: any = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'tenant-a' }) };
  const bases = { resolveEffectiveSources: jest.fn().mockResolvedValue({ sources: [{ id: 'source-location', type: 'TEXT', visibility: 'PUBLIC_REFERENCE' }] }) };
  const service = new KnowledgeProcessingService(prisma, workspaces, bases as any);

  beforeEach(() => jest.clearAllMocks());

  const prepare = (scopeRows: string[], workspaceEnabled: boolean, assistantEnabled: boolean) => {
    prisma.knowledgeSource.findMany.mockResolvedValue([{ id: 'source-location', connectorInstanceId: 'connector-a', connectorDataCategory: 'SHOPIFY_LOCATIONS' }]);
    prisma.connectorInstance.findMany.mockResolvedValue([{ id: 'connector-a', connectorId: 'shopify_v1', verifiedCapabilities: ['WEBSITE_CONTENT', 'SHOPIFY_LOCATIONS'], lastVerifiedAt: verifiedAt, commerceConnection: { grantedScopes: scopeRows, grantedScopesVerifiedAt: verifiedAt } }]);
    prisma.connectorDataPermission.findMany.mockResolvedValue(workspaceEnabled ? [{ connectorInstanceId: 'connector-a', category: 'SHOPIFY_LOCATIONS' }] : []);
    prisma.assistantConnectorDataPermission.findMany.mockResolvedValue(assistantEnabled ? [{ connectorInstanceId: 'connector-a', category: 'SHOPIFY_LOCATIONS' }] : []);
  };

  it('returns only tenant-owned Shopify content with a fresh grant and both merchant permissions', async () => {
    prepare(grantedScopes, true, true);
    await expect(service['filterConnectorKnowledgeSources']('tenant-a', 'assistant-a', ['source-location'])).resolves.toEqual(['source-location']);
    expect(prisma.connectorInstance.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'tenant-a', id: { in: ['connector-a'] }, state: 'CONNECTED' } }));
  });

  it.each([
    ['missing actual grant', [], true, true],
    ['workspace permission disabled', grantedScopes, false, true],
    ['assistant permission disabled', grantedScopes, true, false],
  ])('blocks Shopify evidence when %s', async (_case, scopes, workspaceEnabled, assistantEnabled) => {
    prepare(scopes as string[], workspaceEnabled as boolean, assistantEnabled as boolean);
    await expect(service['filterConnectorKnowledgeSources']('tenant-a', 'assistant-a', ['source-location'])).resolves.toEqual([]);
  });

  it('rechecks Shopify grants before returning cached public evidence', async () => {
    prepare([], true, true);
    prisma.chatbot.findFirst.mockResolvedValue({ id: 'assistant-a' });
    prisma.$queryRaw.mockResolvedValue([{ chunkId: 'chunk-a', sourceId: 'source-location', content: 'cached content' }]);
    await expect(service.revalidatePublicEvidence('user-a', 'workspace-a', 'assistant-a', ['chunk-a'])).resolves.toEqual([]);
  });
});
