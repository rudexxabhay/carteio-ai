import { KnowledgeBaseService } from './knowledge-base.service';

const hash = 'a'.repeat(64);
const verifiedDocument = {
  provenance: 'AUTHENTICATED_PDF_EXTRACTION_V1', filename: 'policy.pdf', bytes: 100,
  hash, contentHash: hash, sourceLanguage: 'en', extracted: true, pageCount: 1,
  pages: [{ page: 1, start: 0, end: 20, contentHash: hash, wordCount: 3 }],
};
const source = (overrides: Record<string, unknown> = {}) => ({
  id: 'source-a', organizationId: 'workspace-a', type: 'TEXT', status: 'REGISTERED',
  processingStatus: 'READY', visibility: 'PUBLIC_REFERENCE', document: verifiedDocument,
  sourceVersion: 1, activeIndexGeneration: 3, deletedAt: null,
  semanticIndexStatus: 'READY', ...overrides,
});

describe('KnowledgeBaseService customer authorization resolution', () => {
  const setup = (sourceRow = source(), assigned = true, orgId = 'workspace-a') => {
    const base = { id: 'base-a', name: 'Policies', status: 'ACTIVE' };
    const db: any = {
      chatbot: { findFirst: jest.fn().mockResolvedValue({ id: 'assistant-a', status: 'ACTIVE', useAllEligibleWorkspaceKnowledge: false }) },
      knowledgeBase: { findMany: jest.fn().mockResolvedValue([base]) },
      assistantKnowledgeBase: { findMany: jest.fn().mockResolvedValue(assigned ? [{ knowledgeBaseId: 'base-a', knowledgeBase: base }] : []) },
      assistantKnowledgeSource: { findMany: jest.fn().mockResolvedValue([]) },
      knowledgeBaseSource: { findMany: jest.fn().mockResolvedValue(assigned ? [{ knowledgeBaseId: 'base-a', source: sourceRow, knowledgeBase: base }] : []) },
      knowledgeSource: { findMany: jest.fn().mockResolvedValue([]) },
      knowledgeChunk: { groupBy: jest.fn().mockResolvedValue([{ sourceId: 'source-a', sourceVersion: 1, generation: 3, _count: { _all: 1 } }]) },
    };
    const service = new KnowledgeBaseService(db, {} as any);
    return { service, db, run: () => service.resolveEffectiveSources(orgId, 'assistant-a', { publicOnly: true }) };
  };

  it('allows current authenticated PDF under the assigned assistant and workspace', async () => {
    const { run } = setup();
    const result = await run();
    expect(result.sources.map((item: any) => item.id)).toEqual(['source-a']);
  });

  it.each([
    ['legacy FAQ', { type: 'FAQ', document: null }],
    ['legacy Website', { type: 'WEBSITE', document: null }],
    ['legacy manual Text', { type: 'TEXT', document: null }],
    ['historical PDF without trusted provenance', { document: { ...verifiedDocument, provenance: undefined } }],
    ['internal-only source', { visibility: 'INTERNAL_RESTRICTED' }],
    ['deleted source', { deletedAt: new Date() }],
    ['revoked source', { status: 'DISABLED' }],
    ['source without current generation', { activeIndexGeneration: null }],
  ])('denies %s', async (_label, overrides) => {
    const { run } = setup(source(overrides));
    expect((await run()).sources).toEqual([]);
  });

  it('denies an assistant with no Knowledge Base assignment', async () => {
    const { run } = setup(source(), false);
    expect((await run()).sources).toEqual([]);
  });

  it('scopes effective source lookup to the requesting workspace', async () => {
    const { run, db } = setup(source(), true, 'workspace-a');
    await run();
    expect(db.knowledgeBase.findMany.mock.calls[0][0].where.organizationId).toBe('workspace-a');
    expect(db.knowledgeBaseSource.findMany.mock.calls[0][0].where.organizationId).toBe('workspace-a');
  });
});
