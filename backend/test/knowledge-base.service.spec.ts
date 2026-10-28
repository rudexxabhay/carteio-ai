import 'reflect-metadata';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { KnowledgeBaseService } from '../src/modules/workspaces/knowledge-base.service';
import { KnowledgeBaseSourceQueryDto } from '../src/modules/workspaces/knowledge-base.dto';
import type { PrismaService } from '../src/infrastructure/database/prisma.service';
import type { WorkspaceService } from '../src/modules/workspaces/workspace.service';

const base = (overrides: Record<string, unknown> = {}) => ({ id: 'base-a', organizationId: 'org-a', name: 'Company Information', nameKey: 'company information', description: null, status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date(), archivedAt: null, _count: { sources: 0, assistantLinks: 0 }, ...overrides });
const source = (id: string, overrides: Record<string, unknown> = {}) => ({ id, type: 'TEXT', status: 'REGISTERED', deletedAt: null, processingStatus: 'READY', sourceVersion: 2, visibility: 'INTERNAL_RESTRICTED', ...overrides });

describe('KnowledgeBaseService', () => {
  let service: KnowledgeBaseService;
  let db: Record<string, any>;
  let workspaces: { requireAccess: jest.Mock };
  beforeEach(() => {
    db = {
      knowledgeBase: { create: jest.fn().mockResolvedValue(base()), findFirst: jest.fn().mockResolvedValue(base()), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), update: jest.fn().mockResolvedValue(base()) },
      knowledgeSource: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), groupBy: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), update: jest.fn() },
      knowledgeChunk: { groupBy: jest.fn().mockImplementation(async ({ where }: any) => (where.OR ?? []).map((item: any) => { const source = item.sourceId; const generation = item.generation; const version = item.sourceVersion; return { sourceId: source, generation, sourceVersion: version, _count: { _all: 1 } }; })) },
      knowledgePage: { groupBy: jest.fn().mockResolvedValue([]) },
      knowledgeBaseSource: { createMany: jest.fn().mockResolvedValue({ count: 0 }), deleteMany: jest.fn().mockResolvedValue({ count: 0 }), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      assistantKnowledgeBase: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({ count: 0 }), deleteMany: jest.fn().mockResolvedValue({ count: 0 }), groupBy: jest.fn().mockResolvedValue([]) },
      assistantKnowledgeSource: { findMany: jest.fn().mockResolvedValue([]) },
      chatbot: { findFirst: jest.fn().mockResolvedValue({ id: 'assistant-a', status: 'ACTIVE', useAllEligibleWorkspaceKnowledge: false }), findMany: jest.fn().mockResolvedValue([]) },
      auditEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    db.$transaction = jest.fn((callback: (tx: any) => unknown) => callback(db));
    workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId: 'org-a', role: 'OWNER' }) };
    service = new KnowledgeBaseService(db as unknown as PrismaService, workspaces as unknown as WorkspaceService);
  });

  it('creates a normalized workspace-owned base and translates duplicate names', async () => {
    await service.create('user-a', 'alpha', { name: '  Company   Information  ', description: ' About ' });
    expect(db.knowledgeBase.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org-a', createdById: 'user-a', name: 'Company Information', nameKey: 'company information', description: 'About' }) }));
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'knowledge_base.created', metadata: {} }) }));
    db.knowledgeBase.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.create('user-a', 'alpha', { name: 'company information' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('edits and archives a base without deleting its source or assistant memberships', async () => {
    await service.update('user-a', 'alpha', 'base-a', { description: 'Updated description' });
    expect(db.knowledgeBase.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id_organizationId: { id: 'base-a', organizationId: 'org-a' } } }));
    await service.archive('user-a', 'alpha', 'base-a');
    expect(db.knowledgeBase.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ARCHIVED', archivedAt: expect.any(Date) }) }));
    expect(db.knowledgeBaseSource.deleteMany).not.toHaveBeenCalled();
    expect(db.assistantKnowledgeBase.deleteMany).not.toHaveBeenCalled();
  });

  it('persists the opt-in auto-link policy through a tenant-qualified manager update', async () => {
    await service.update('user-a', 'alpha', 'base-a', { autoAddEligibleSources: true });
    expect(db.knowledgeBase.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id_organizationId: { id: 'base-a', organizationId: 'org-a' } },
      data: { autoAddEligibleSources: true },
    }));
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'knowledge_base.updated', metadata: { changedFields: ['autoAddEligibleSources'] } }) }));
  });

  it('requires manager membership and rejects cross-tenant sources in bulk assignment', async () => {
    workspaces.requireAccess.mockRejectedValueOnce(new ForbiddenException());
    await expect(service.create('member-a', 'alpha', { name: 'Support' })).rejects.toBeInstanceOf(ForbiddenException);
    db.knowledgeSource.findMany.mockResolvedValueOnce([{ id: 'source-a' }]);
    await expect(service.addSources('user-a', 'alpha', 'base-a', { sourceIds: ['source-a', 'source-b'] })).rejects.toBeInstanceOf(NotFoundException);
    expect(db.knowledgeBaseSource.createMany).not.toHaveBeenCalled();
  });

  it('uses bounded database pagination and name search for collection lists', async () => {
    await service.list('user-a', 'alpha', { search: 'support', status: 'ACTIVE', sort: 'name', direction: 'asc', page: 2, pageSize: 20, includeLinked: true });
    expect(db.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a', name: { contains: 'support', mode: 'insensitive' } }), skip: 20, take: 20, orderBy: [{ name: 'asc' }, { id: 'asc' }] }));
    expect(db.knowledgeBase.count).toHaveBeenCalled();
  });

  it('lists only sources without membership in any active base using bounded workspace filters', async () => {
    db.knowledgeSource.findMany.mockResolvedValueOnce([source('source-a')]);
    const result = await service.unassignedSources('user-a', 'alpha', { search: 'policy', type: 'TEXT', processingStatus: 'READY', sort: 'updatedAt', direction: 'desc', page: 2, pageSize: 10 });
    expect(result).toMatchObject({ total: 0, page: 2, pageSize: 10 });
    expect(db.knowledgeSource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: 'org-a', status: { not: 'ARCHIVED' }, knowledgeBaseLinks: { none: { organizationId: 'org-a', knowledgeBase: { status: 'ACTIVE' } } }, name: { contains: 'policy', mode: 'insensitive' }, type: 'TEXT', processingStatus: 'READY' }),
      skip: 10, take: 10,
    }));
  });

  it('filters a collection by its persisted section and scopes section summaries to that tenant and base', async () => {
    await service.sources('user-a', 'alpha', 'base-a', { knowledgeSection: 'SHIPPING_DELIVERY', page: 1, pageSize: 10 } as KnowledgeBaseSourceQueryDto);
    expect(db.knowledgeBaseSource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: 'org-a', knowledgeBaseId: 'base-a',
        source: expect.objectContaining({ organizationId: 'org-a', knowledgeSection: 'SHIPPING_DELIVERY' }),
      }),
    }));
    expect(db.knowledgeSource.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      by: ['knowledgeSection'],
      where: expect.objectContaining({ organizationId: 'org-a', knowledgeBaseLinks: { some: { organizationId: 'org-a', knowledgeBaseId: 'base-a' } } }),
    }));
  });

  it('filters unassigned knowledge by persisted section without crossing workspace scope', async () => {
    await service.unassignedSources('user-a', 'alpha', { knowledgeSection: 'SHIPPING_DELIVERY', page: 1, pageSize: 10 } as KnowledgeBaseSourceQueryDto);
    expect(db.knowledgeSource.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: 'org-a', knowledgeSection: 'SHIPPING_DELIVERY' }),
    }));
  });

  it('reports current-generation page/chunk counts and indexing time rather than total stale records', async () => {
    const indexedAt = new Date('2026-10-22T12:00:00.000Z');
    db.knowledgeSource.findMany.mockResolvedValueOnce([source('indexed', { status: 'REGISTERED', processingStatus: 'READY', sourceVersion: 3, activeIndexGeneration: 8 })]);
    db.knowledgeChunk.groupBy.mockResolvedValueOnce([
      { sourceId: 'indexed', sourceVersion: 3, generation: 8, _count: { _all: 2 }, _max: { indexedAt } },
      { sourceId: 'indexed', sourceVersion: 2, generation: 7, _count: { _all: 5 }, _max: { indexedAt: new Date('2026-10-01T00:00:00.000Z') } },
    ]);
    db.knowledgePage.groupBy.mockResolvedValueOnce([{ sourceId: 'indexed', sourceVersion: 3, generation: 8, _count: { _all: 1 } }]);
    const result = await service.unassignedSources('user-a', 'alpha', new KnowledgeBaseSourceQueryDto());
    expect(result.sources[0]).toMatchObject({ activeChunkCount: 2, indexedPageCount: 1, activeIndexSearchable: true, lastIndexedAt: indexedAt });
  });

  it('normalizes source enum values for collection UI contracts while preserving website verification state', async () => {
    db.knowledgeSource.findMany.mockResolvedValueOnce([source('website-a', { type: 'WEBSITE', verificationStatus: 'VERIFIED', syncPolicy: 'DAILY' })]);
    const result = await service.unassignedSources('user-a', 'alpha', new KnowledgeBaseSourceQueryDto());
    expect(result.sources[0]).toMatchObject({ type: 'website', status: 'registered', processingStatus: 'ready', verificationStatus: 'VERIFIED', syncPolicy: 'DAILY' });
  });

  it('adds unique memberships in a bounded transaction and reports duplicates accurately', async () => {
    db.knowledgeSource.findMany.mockResolvedValueOnce([{ id: 'source-a', status: 'REGISTERED', visibility: 'PUBLIC_REFERENCE', processingStatus: 'READY', activeIndexGeneration: 2 }, { id: 'source-b', status: 'REGISTERED', visibility: 'PUBLIC_REFERENCE', processingStatus: 'READY', activeIndexGeneration: 2 }]);
    db.knowledgeBaseSource.createMany.mockResolvedValueOnce({ count: 1 });
    await expect(service.addSources('user-a', 'alpha', 'base-a', { sourceIds: ['source-a', 'source-b'] })).resolves.toEqual({ requested: 2, added: 1, alreadyPresent: 1, restrictedVisibility: 0, processingBlocked: 0, failedProcessing: 0, statusBlocked: 0 });
    expect(db.knowledgeBaseSource.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it('reports restricted visibility and processing blockers without changing those source records', async () => {
    db.knowledgeSource.findMany.mockResolvedValueOnce([{ id: 'private-faq', status: 'REGISTERED', visibility: 'INTERNAL_RESTRICTED', processingStatus: 'FAILED', activeIndexGeneration: null }]);
    db.knowledgeBaseSource.createMany.mockResolvedValueOnce({ count: 1 });
    await expect(service.addSources('user-a', 'alpha', 'base-a', { sourceIds: ['private-faq'] })).resolves.toEqual({ requested: 1, added: 1, alreadyPresent: 0, restrictedVisibility: 1, processingBlocked: 1, failedProcessing: 1, statusBlocked: 0 });
    expect(db.knowledgeSource.update).not.toHaveBeenCalled();
    expect(db.knowledgeBaseSource.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it('reuses a canonical source in different bases and removes memberships without removing the source', async () => {
    db.knowledgeSource.findMany.mockResolvedValue([{ id: 'source-a' }]);
    db.knowledgeBaseSource.createMany.mockResolvedValue({ count: 1 });
    await service.addSources('user-a', 'alpha', 'base-a', { sourceIds: ['source-a'] });
    await service.addSources('user-a', 'alpha', 'base-b', { sourceIds: ['source-a'] });
    expect(db.knowledgeBaseSource.createMany).toHaveBeenNthCalledWith(2, { data: [{ organizationId: 'org-a', knowledgeBaseId: 'base-b', sourceId: 'source-a' }], skipDuplicates: true });
    db.knowledgeBaseSource.deleteMany.mockResolvedValueOnce({ count: 1 });
    await service.removeSources('user-a', 'alpha', 'base-a', { sourceIds: ['source-a'] });
    expect(db.knowledgeBaseSource.deleteMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ knowledgeBaseId: 'base-a', sourceId: { in: ['source-a'] } }) }));
    expect(db.knowledgeSource.deleteMany).not.toHaveBeenCalled();
  });

  it('allows one base to link to multiple assistants and rejects archived-base links', async () => {
    await service.addBaseAssistant('user-a', 'alpha', 'base-a', 'assistant-a');
    await service.addBaseAssistant('user-a', 'alpha', 'base-a', 'assistant-b');
    expect(db.assistantKnowledgeBase.create).toHaveBeenNthCalledWith(2, { data: { organizationId: 'org-a', assistantId: 'assistant-b', knowledgeBaseId: 'base-a' } });
    db.knowledgeBase.findFirst.mockResolvedValueOnce(null);
    await expect(service.addBaseAssistant('user-a', 'alpha', 'archived-base', 'assistant-a')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('offers only active assistants for new Knowledge Base links and blocks inactive IDs server-side', async () => {
    db.assistantKnowledgeBase.findMany.mockResolvedValueOnce([{ assistantId: 'assistant-linked', assistant: { id: 'assistant-linked', name: 'Linked assistant', status: 'INACTIVE' } }]);
    db.chatbot.findMany.mockResolvedValueOnce([{ id: 'assistant-active', name: 'Active assistant', status: 'ACTIVE' }]);
    const assignments = await service.baseAssistants('user-a', 'alpha', 'base-a');
    expect(assignments.linked).toEqual([{ id: 'assistant-linked', name: 'Linked assistant', status: 'inactive' }]);
    expect(assignments.available).toEqual([{ id: 'assistant-active', name: 'Active assistant', status: 'active' }]);
    expect(db.chatbot.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a', status: 'ACTIVE' } }));
    db.chatbot.findFirst.mockResolvedValueOnce({ id: 'assistant-draft', status: 'DRAFT' });
    await expect(service.addBaseAssistant('user-a', 'alpha', 'base-a', 'assistant-draft')).rejects.toBeInstanceOf(BadRequestException);
    expect(db.assistantKnowledgeBase.create).not.toHaveBeenCalled();
  });

  it('keeps assistant links organization-scoped and reports duplicate relationship attempts', async () => {
    db.chatbot.findFirst.mockResolvedValueOnce(null);
    await expect(service.addBaseAssistant('user-a', 'alpha', 'base-a', 'assistant-org-b')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.chatbot.findFirst).toHaveBeenCalledWith({ where: { id: 'assistant-org-b', organizationId: 'org-a' }, select: { id: true, status: true, useAllEligibleWorkspaceKnowledge: true } });
    expect(db.assistantKnowledgeBase.create).not.toHaveBeenCalled();

    db.assistantKnowledgeBase.create.mockRejectedValueOnce({ code: 'P2002' });
    await expect(service.addBaseAssistant('user-a', 'alpha', 'base-a', 'assistant-a')).rejects.toBeInstanceOf(ConflictException);
  });

  it('replaces assistant/base links atomically without changing legacy direct source links', async () => {
    db.knowledgeBase.findMany.mockResolvedValueOnce([{ id: 'base-b' }]);
    db.assistantKnowledgeBase.findMany.mockResolvedValueOnce([{ knowledgeBaseId: 'base-a' }]).mockResolvedValueOnce([{ knowledgeBase: base({ id: 'base-b' }) }]);
    await expect(service.replaceAssistantBases('user-a', 'alpha', 'assistant-a', { knowledgeBaseIds: ['base-b'] })).resolves.toMatchObject({ added: 1, removed: 1, linked: [expect.objectContaining({ id: 'base-b' })] });
    expect(db.assistantKnowledgeBase.deleteMany).toHaveBeenCalled();
    expect(db.assistantKnowledgeBase.createMany).toHaveBeenCalled();
    expect(db.assistantKnowledgeSource.findMany).not.toHaveBeenCalled();
  });

  it('rejects archived or cross-tenant bases before replacing assistant links', async () => {
    db.knowledgeBase.findMany.mockResolvedValueOnce([]);
    await expect(service.replaceAssistantBases('user-a', 'alpha', 'assistant-a', { knowledgeBaseIds: ['base-org-b'] })).rejects.toBeInstanceOf(NotFoundException);
    expect(db.assistantKnowledgeBase.deleteMany).not.toHaveBeenCalled();
  });

  it('resolves ready sources from direct and base links once, excluding archived bases', async () => {
    db.knowledgeBase.findMany.mockResolvedValueOnce([base({ status: 'ACTIVE' })]);
    db.assistantKnowledgeBase.findMany.mockResolvedValueOnce([{ knowledgeBaseId: 'base-a', knowledgeBase: { id: 'base-a', name: 'Company Information', status: 'ACTIVE' } }]);
    db.assistantKnowledgeSource.findMany.mockResolvedValueOnce([{ source: source('shared', { activeIndexGeneration: 2 }) }]);
    db.knowledgeBaseSource.findMany.mockResolvedValueOnce([{ source: source('shared', { activeIndexGeneration: 2 }), knowledgeBase: { id: 'base-a', name: 'Company Information', status: 'ACTIVE' } }, { source: source('base-only', { activeIndexGeneration: 2 }), knowledgeBase: { id: 'base-a', name: 'Company Information', status: 'ACTIVE' } }]);
    const result = await service.resolveEffectiveSources('org-a', 'assistant-a');
    expect(result.sources.map((item: any) => item.id)).toEqual(['shared', 'base-only']);
    expect(result.sources).toEqual([
      expect.objectContaining({ id: 'shared', accessPath: 'MULTIPLE', accessPaths: ['DIRECT', 'KNOWLEDGE_BASE'], knowledgeBaseIds: ['base-a'] }),
      expect.objectContaining({ id: 'base-only', accessPath: 'KNOWLEDGE_BASE', accessPaths: ['KNOWLEDGE_BASE'] }),
    ]);
    expect(db.knowledgeBaseSource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a', knowledgeBase: expect.objectContaining({ status: 'ACTIVE' }), OR: [{ knowledgeBaseId: { in: ['base-a'] } }, { knowledgeBaseId: 'base-a', source: { visibility: 'PUBLIC_REFERENCE' } }] }) }));
  });

  it('uses a sole active base automatically for public ready sources while keeping its restricted sources private', async () => {
    db.knowledgeBase.findMany.mockResolvedValueOnce([base({ status: 'ACTIVE' })]);
    db.knowledgeBaseSource.findMany.mockResolvedValueOnce([
      { source: source('public-faq', { activeIndexGeneration: 3, visibility: 'PUBLIC_REFERENCE' }), knowledgeBase: { id: 'base-a', name: 'Company Information', status: 'ACTIVE' } },
      { source: source('public-site', { type: 'WEBSITE', activeIndexGeneration: 5, visibility: 'PUBLIC_REFERENCE' }), knowledgeBase: { id: 'base-a', name: 'Company Information', status: 'ACTIVE' } },
      { source: source('restricted-text', { activeIndexGeneration: 4, visibility: 'INTERNAL_RESTRICTED' }), knowledgeBase: { id: 'base-a', name: 'Company Information', status: 'ACTIVE' } },
      { source: source('not-indexed', { activeIndexGeneration: null, visibility: 'PUBLIC_REFERENCE' }), knowledgeBase: { id: 'base-a', name: 'Company Information', status: 'ACTIVE' } },
    ]);
    const result = await service.resolveEffectiveSources('org-a', 'assistant-a', { publicOnly: true });
    expect(result.resolution).toBe('SINGLE_ACTIVE_BASE_DEFAULT');
    expect(result.defaultKnowledgeBaseId).toBe('base-a');
    expect(result.knowledgeBases).toEqual([expect.objectContaining({ id: 'base-a', assignment: 'WORKSPACE_DEFAULT', eligibleSourceCount: 2, retrievalEnabled: true })]);
    expect(result.sources.map((item: any) => item.id)).toEqual(['public-faq', 'public-site']);
    expect(db.knowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a', status: 'ACTIVE', archivedAt: null }, take: 2 }));
    expect(db.assistantKnowledgeBase.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a', assistantId: 'assistant-a', knowledgeBase: { status: 'ACTIVE', archivedAt: null } } }));
  });

  it('includes directly assigned public sources in public effective retrieval while keeping the query tenant-scoped', async () => {
    db.knowledgeBase.findMany.mockResolvedValueOnce([]);
    db.assistantKnowledgeBase.findMany.mockResolvedValueOnce([]);
    db.assistantKnowledgeSource.findMany.mockResolvedValueOnce([{ source: source('direct-public', { visibility: 'PUBLIC_REFERENCE', activeIndexGeneration: 3 }) }]);
    const result = await service.resolveEffectiveSources('org-a', 'assistant-a', { publicOnly: true });
    expect(result.sources.map((item: any) => item.id)).toEqual(['direct-public']);
    expect(db.assistantKnowledgeSource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a', assistantId: 'assistant-a', source: expect.objectContaining({ visibility: 'PUBLIC_REFERENCE', status: 'REGISTERED', processingStatus: 'READY' }) }) }));
  });

  it('resolves all existing public indexed workspace sources under the assistant-level policy without duplicate paths', async () => {
    db.chatbot.findFirst.mockResolvedValueOnce({ id: 'assistant-a', status: 'ACTIVE', useAllEligibleWorkspaceKnowledge: true });
    db.knowledgeBase.findMany.mockResolvedValueOnce([]);
    db.assistantKnowledgeBase.findMany.mockResolvedValueOnce([]);
    db.assistantKnowledgeSource.findMany.mockResolvedValueOnce([{ source: source('faq-existing', { visibility: 'PUBLIC_REFERENCE', activeIndexGeneration: 4 }) }]);
    db.knowledgeSource.findMany.mockResolvedValueOnce([
      source('faq-existing', { visibility: 'PUBLIC_REFERENCE', activeIndexGeneration: 4 }),
      source('website-existing', { type: 'WEBSITE', visibility: 'PUBLIC_REFERENCE', activeIndexGeneration: 2 }),
    ]);
    const result = await service.resolveEffectiveSources('org-a', 'assistant-a', { publicOnly: true });
    expect(result).toMatchObject({ useAllEligibleWorkspaceKnowledge: true, resolution: 'ALL_ELIGIBLE_WORKSPACE_KNOWLEDGE', effectiveSourceCount: 2 });
    expect(result.sources.map((item: any) => item.id)).toEqual(['faq-existing', 'website-existing']);
    expect(result.sources[0]).toMatchObject({ id: 'faq-existing', accessPath: 'MULTIPLE', accessPaths: ['DIRECT', 'WORKSPACE_POLICY'] });
    expect(result.sources[1]).toMatchObject({ id: 'website-existing', accessPath: 'WORKSPACE_POLICY', accessPaths: ['WORKSPACE_POLICY'] });
    expect(db.knowledgeSource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a', type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, visibility: 'PUBLIC_REFERENCE' }) }));
  });

  it('does not resolve restricted or unindexed sources for public automatic access', async () => {
    db.chatbot.findFirst.mockResolvedValueOnce({ id: 'assistant-a', status: 'ACTIVE', useAllEligibleWorkspaceKnowledge: true });
    db.knowledgeBase.findMany.mockResolvedValueOnce([]);
    db.assistantKnowledgeBase.findMany.mockResolvedValueOnce([]);
    db.assistantKnowledgeSource.findMany.mockResolvedValueOnce([]);
    db.knowledgeSource.findMany.mockResolvedValueOnce([]);
    const result = await service.resolveEffectiveSources('org-a', 'assistant-a', { publicOnly: true });
    expect(result.sources).toEqual([]);
    expect(db.knowledgeSource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ visibility: 'PUBLIC_REFERENCE', deletedAt: null }) }));
  });

  it('includes a newly indexed public source on the next resolver call without writing an assignment row', async () => {
    db.chatbot.findFirst.mockResolvedValueOnce({ id: 'assistant-a', status: 'ACTIVE', useAllEligibleWorkspaceKnowledge: true });
    db.knowledgeBase.findMany.mockResolvedValueOnce([]);
    db.assistantKnowledgeBase.findMany.mockResolvedValueOnce([]);
    db.assistantKnowledgeSource.findMany.mockResolvedValueOnce([]);
    db.knowledgeSource.findMany.mockResolvedValueOnce([source('new-faq', { type: 'FAQ', visibility: 'PUBLIC_REFERENCE', status: 'REGISTERED', processingStatus: 'READY', activeIndexGeneration: 6 })]);
    const result = await service.resolveEffectiveSources('org-a', 'assistant-a', { publicOnly: true });
    expect(result.sources).toEqual([expect.objectContaining({ id: 'new-faq', activeIndexGeneration: 6, activeChunkCount: 1, accessPath: 'WORKSPACE_POLICY' })]);
    expect(db.assistantKnowledgeSource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a', assistantId: 'assistant-a' }) }));
    expect(db.assistantKnowledgeSource.create).toBeUndefined();
  });

  it('requires explicit assignments when multiple active bases exist and preserves tenant scoping', async () => {
    db.knowledgeBase.findMany.mockResolvedValueOnce([base({ id: 'base-a' }), base({ id: 'base-b', name: 'Policies' })]);
    db.assistantKnowledgeBase.findMany.mockResolvedValueOnce([{ knowledgeBaseId: 'base-b', knowledgeBase: { id: 'base-b', name: 'Policies', status: 'ACTIVE' } }]);
    db.knowledgeBaseSource.findMany.mockResolvedValueOnce([{ source: source('policy', { activeIndexGeneration: 2, visibility: 'PUBLIC_REFERENCE' }), knowledgeBase: { id: 'base-b', name: 'Policies', status: 'ACTIVE' } }]);
    const result = await service.resolveEffectiveSources('org-a', 'assistant-a', { publicOnly: true });
    expect(result.resolution).toBe('EXPLICIT_ASSIGNMENTS');
    expect(result.defaultKnowledgeBaseId).toBeNull();
    expect(result.knowledgeBases.map((item: any) => item.id)).toEqual(['base-b']);
    expect(db.knowledgeBaseSource.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a', OR: [{ knowledgeBaseId: { in: ['base-b'] } }] }) }));
  });
});
