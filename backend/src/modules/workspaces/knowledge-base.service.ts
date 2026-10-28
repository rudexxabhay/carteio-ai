import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkspaceService } from './workspace.service';
import { KnowledgeBaseListQueryDto } from './knowledge-base.dto';
import type { BulkKnowledgeBaseSourcesDto, CreateKnowledgeBaseDto, KnowledgeBaseSourceQueryDto, ReplaceAssistantKnowledgeBasesDto, UpdateKnowledgeBaseDto } from './knowledge-base.dto';

const managers = ['OWNER', 'ADMIN'] as const;
const isUniqueConflict = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ').normalize('NFKC');
const nameKey = (value: string) => normalizeName(value).toLowerCase().normalize('NFKC');
const sourceSelect = {
  id: true, organizationId: true, createdById: true, type: true, status: true, processingStatus: true, visibility: true,
  name: true, description: true, sourceUrl: true, contentBody: true, category: true, knowledgeSection: true, languageHint: true,
  sourceVersion: true, activeIndexGeneration: true, lastSyncAt: true, lastSuccessfulSyncAt: true, lastSyncErrorCode: true,
  verificationStatus: true, verifiedAt: true, syncPolicy: true, syncPaused: true, nextSyncAt: true,
  lastSyncAttemptAt: true, crawlPathPrefix: true, crawlMaxPages: true, crawlMaxDepth: true,
  semanticIndexStatus: true, semanticIndexErrorCode: true,
  deletedAt: true, createdAt: true, updatedAt: true,
  _count: { select: { pages: true } },
};
type EffectiveKnowledgeBase = Prisma.KnowledgeBaseGetPayload<{
  select: { id: true; name: true; status: true };
}>;

@Injectable()
export class KnowledgeBaseService {
  private readonly db: any;
  constructor(prisma: PrismaService, private readonly workspaces: WorkspaceService) { this.db = prisma as any; }

  async list(userId: string, slug: string, query: KnowledgeBaseListQueryDto) {
    const member = await this.workspaces.requireAccess(userId, slug);
    const where = {
      organizationId: member.organizationId,
      ...(query.status === 'ALL' ? {} : { status: query.status ?? 'ACTIVE' }),
      ...(query.search?.trim() ? { name: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
    };
    const [bases, total, totalSources, linkedAssistants] = await Promise.all([
      this.db.knowledgeBase.findMany({ where, orderBy: [{ [query.sort ?? 'updatedAt']: query.direction ?? 'desc' }, { id: 'asc' }], skip: ((query.page ?? 1) - 1) * (query.pageSize ?? 20), take: Math.min(query.pageSize ?? 20, 100), include: { _count: { select: { sources: { where: { source: { type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } } } }, assistantLinks: true } } } }),
      this.db.knowledgeBase.count({ where }),
      this.db.knowledgeSource.count({ where: { organizationId: member.organizationId, type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } } }),
      this.db.assistantKnowledgeBase.groupBy({ by: ['assistantId'], where: { organizationId: member.organizationId, knowledgeBase: { status: 'ACTIVE' } } }),
    ]);
    return {
      knowledgeBases: bases.map((base: any) => this.view(base)), total, page: query.page ?? 1, pageSize: Math.min(query.pageSize ?? 20, 100),
      summary: { totalKnowledgeBases: await this.db.knowledgeBase.count({ where: { organizationId: member.organizationId, status: 'ACTIVE' } }), totalSources, unassignedSources: await this.db.knowledgeSource.count({ where: this.unassignedWhere(member.organizationId) }), linkedAssistants: linkedAssistants.length },
    };
  }

  async unassignedSources(userId: string, slug: string, query: KnowledgeBaseSourceQueryDto) {
    const member = await this.workspaces.requireAccess(userId, slug);
    const where = {
      ...this.unassignedWhere(member.organizationId),
      type: { in: ['FAQ', 'TEXT', 'WEBSITE'] as const },
      ...(query.search?.trim() ? { name: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
      ...(query.knowledgeSection ? { knowledgeSection: query.knowledgeSection } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.processingStatus ? { processingStatus: query.processingStatus } : {}),
    };
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const [sources, total] = await Promise.all([
      this.db.knowledgeSource.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: ((query.page ?? 1) - 1) * pageSize, take: pageSize, select: sourceSelect }),
      this.db.knowledgeSource.count({ where }),
    ]);
    return { sources: await this.sourcesWithIndexFacts(member.organizationId, sources), total, page: query.page ?? 1, pageSize };
  }

  private unassignedWhere(organizationId: string) {
    return { organizationId, type: { in: ['FAQ', 'TEXT', 'WEBSITE'] as const }, status: { not: 'ARCHIVED' }, knowledgeBaseLinks: { none: { organizationId, knowledgeBase: { status: 'ACTIVE' } } } };
  }

  async create(userId: string, slug: string, input: CreateKnowledgeBaseDto) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const name = normalizeName(input.name);
    try {
      return await this.db.$transaction(async (tx: any) => {
        const base = await tx.knowledgeBase.create({ data: { organizationId: member.organizationId, createdById: userId, name, nameKey: nameKey(name), description: input.description?.trim() || null }, include: { _count: { select: { sources: { where: { source: { type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } } } }, assistantLinks: true } } } });
        await this.audit(tx, member.organizationId, userId, 'knowledge_base.created', base.id, {});
        return this.view(base);
      });
    } catch (error) { this.mapNameConflict(error); }
  }

  async get(userId: string, slug: string, baseId: string) {
    const member = await this.workspaces.requireAccess(userId, slug);
    const base = await this.db.knowledgeBase.findFirst({ where: { id: baseId, organizationId: member.organizationId }, include: { _count: { select: { sources: { where: { source: { type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } } } }, assistantLinks: true } } } });
    if (!base) throw this.baseNotFound();
    return this.view(base);
  }

  async update(userId: string, slug: string, baseId: string, input: UpdateKnowledgeBaseDto) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    await this.requireBase(member.organizationId, baseId, true);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) { const name = normalizeName(input.name); data.name = name; data.nameKey = nameKey(name); }
    if (input.description !== undefined) data.description = input.description.trim() || null;
    if (input.autoAddEligibleSources !== undefined) data.autoAddEligibleSources = input.autoAddEligibleSources;
    if (!Object.keys(data).length) throw new BadRequestException({ code: 'EMPTY_KNOWLEDGE_BASE_UPDATE', message: 'Choose at least one setting to update.' });
    try {
      return await this.db.$transaction(async (tx: any) => {
        const base = await tx.knowledgeBase.update({ where: { id_organizationId: { id: baseId, organizationId: member.organizationId } }, data, include: { _count: { select: { sources: { where: { source: { type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } } } }, assistantLinks: true } } } });
        await this.audit(tx, member.organizationId, userId, 'knowledge_base.updated', baseId, { changedFields: Object.keys(data) });
        return this.view(base);
      });
    } catch (error) { this.mapNameConflict(error); }
  }

  async archive(userId: string, slug: string, baseId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const base = await this.requireBase(member.organizationId, baseId, false);
    if (base.status === 'ARCHIVED') return this.view(base);
    return this.db.$transaction(async (tx: any) => {
      const archived = await tx.knowledgeBase.update({ where: { id_organizationId: { id: baseId, organizationId: member.organizationId } }, data: { status: 'ARCHIVED', archivedAt: new Date() }, include: { _count: { select: { sources: { where: { source: { type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } } } }, assistantLinks: true } } } });
      await this.audit(tx, member.organizationId, userId, 'knowledge_base.archived', baseId, {});
      return this.view(archived);
    });
  }

  async sources(userId: string, slug: string, baseId: string, query: KnowledgeBaseSourceQueryDto) {
    const member = await this.workspaces.requireAccess(userId, slug);
    await this.requireBase(member.organizationId, baseId, false);
    const where = {
      organizationId: member.organizationId, knowledgeBaseId: baseId,
      source: {
        organizationId: member.organizationId,
        type: { in: ['FAQ', 'TEXT', 'WEBSITE'] as const },
        ...(query.search?.trim() ? { name: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
        ...(query.knowledgeSection ? { knowledgeSection: query.knowledgeSection } : {}),
        ...(query.type ? { type: query.type } : {}), ...(query.status ? { status: query.status } : {}), ...(query.processingStatus ? { processingStatus: query.processingStatus } : {}), ...(query.category ? { category: { contains: query.category, mode: 'insensitive' } } : {}),
      },
    };
    const sort = query.sort ?? 'updatedAt'; const direction = query.direction ?? 'desc';
    const sectionScope = { organizationId: member.organizationId, type: { in: ['FAQ', 'TEXT', 'WEBSITE'] as const }, status: { not: 'ARCHIVED' }, knowledgeBaseLinks: { some: { organizationId: member.organizationId, knowledgeBaseId: baseId } } };
    const [rows, total, sourceCount, byType, byProcessing, byKnowledgeSection, bySectionProcessing] = await Promise.all([
      this.db.knowledgeBaseSource.findMany({ where, orderBy: [{ source: { [sort]: direction } }, { sourceId: 'asc' }], skip: ((query.page ?? 1) - 1) * (query.pageSize ?? 20), take: Math.min(query.pageSize ?? 20, 100), include: { source: { select: { ...sourceSelect, knowledgeBaseLinks: { where: { organizationId: member.organizationId }, select: { knowledgeBase: { select: { id: true, name: true, status: true } } } } } } } }),
      this.db.knowledgeBaseSource.count({ where }),
      this.db.knowledgeBaseSource.count({ where: { organizationId: member.organizationId, knowledgeBaseId: baseId, source: { type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } } } }),
      this.db.knowledgeSource.groupBy({ by: ['type'], where: { organizationId: member.organizationId, type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' }, knowledgeBaseLinks: { some: { organizationId: member.organizationId, knowledgeBaseId: baseId } } }, _count: { _all: true } }),
      this.db.knowledgeSource.groupBy({ by: ['processingStatus'], where: { organizationId: member.organizationId, type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' }, knowledgeBaseLinks: { some: { organizationId: member.organizationId, knowledgeBaseId: baseId } } }, _count: { _all: true } }),
      this.db.knowledgeSource.groupBy({ by: ['knowledgeSection'], where: sectionScope, _count: { _all: true } }),
      this.db.knowledgeSource.groupBy({ by: ['knowledgeSection', 'processingStatus'], where: sectionScope, _count: { _all: true } }),
    ]);
    const sourceIds = rows.map((row: any) => row.source.id);
    const [chunkGroups, pageGroups] = sourceIds.length ? await Promise.all([
      this.db.knowledgeChunk.groupBy({ by: ['sourceId', 'sourceVersion', 'generation'], where: { organizationId: member.organizationId, sourceId: { in: sourceIds } }, _count: { _all: true }, _max: { indexedAt: true } }),
      this.db.knowledgePage.groupBy({ by: ['sourceId', 'sourceVersion', 'generation'], where: { organizationId: member.organizationId, sourceId: { in: sourceIds }, status: 'READY' }, _count: { _all: true } }),
    ]) : [[], []];
    const currentCounts = (source: any, groups: any[]) => groups.filter((group) => group.sourceId === source.id && group.sourceVersion === source.sourceVersion && group.generation === source.activeIndexGeneration).reduce((count, group) => count + group._count._all, 0);
    return { sources: rows.map((row: any) => {
      const activeChunkGroup = chunkGroups.find((group: any) => group.sourceId === row.source.id && group.sourceVersion === row.source.sourceVersion && group.generation === row.source.activeIndexGeneration);
      const activeChunkCount = currentCounts(row.source, chunkGroups);
      const indexedPageCount = currentCounts(row.source, pageGroups);
      return { ...this.sourceView(row.source, { activeChunkCount, indexedPageCount, lastIndexedAt: activeChunkGroup?._max?.indexedAt ?? null }), knowledgeBaseMemberships: row.source.knowledgeBaseLinks.map((link: any) => this.view(link.knowledgeBase)) };
    }), total, page: query.page ?? 1, pageSize: Math.min(query.pageSize ?? 20, 100), summary: { sourceCount, byType: Object.fromEntries(byType.map((row: any) => [String(row.type).toLowerCase(), row._count._all])), byProcessingStatus: Object.fromEntries(byProcessing.map((row: any) => [String(row.processingStatus).toLowerCase(), row._count._all])), byKnowledgeSection: Object.fromEntries(byKnowledgeSection.map((row: any) => [row.knowledgeSection ?? 'UNCATEGORIZED', row._count._all])), bySectionProcessingStatus: Object.fromEntries(bySectionProcessing.map((row: any) => [`${row.knowledgeSection ?? 'UNCATEGORIZED'}:${String(row.processingStatus).toLowerCase()}`, row._count._all])) } };
  }

  async availableSources(userId: string, slug: string, baseId: string, query: KnowledgeBaseSourceQueryDto) {
    const member = await this.workspaces.requireAccess(userId, slug);
    await this.requireBase(member.organizationId, baseId, true);
    const where = {
      organizationId: member.organizationId, type: { in: ['FAQ', 'TEXT', 'WEBSITE'] as const }, status: query.status && query.status !== 'ARCHIVED' ? query.status : { not: 'ARCHIVED' }, knowledgeBaseLinks: { none: { organizationId: member.organizationId, knowledgeBaseId: baseId } },
      ...(query.search?.trim() ? { name: { contains: query.search.trim(), mode: 'insensitive' } } : {}),
      ...(query.knowledgeSection ? { knowledgeSection: query.knowledgeSection } : {}),
      ...(query.type ? { type: query.type } : {}), ...(query.status ? { status: query.status } : {}), ...(query.processingStatus ? { processingStatus: query.processingStatus } : {}),
    };
    const [sources, total] = await Promise.all([
      this.db.knowledgeSource.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: ((query.page ?? 1) - 1) * (query.pageSize ?? 20), take: Math.min(query.pageSize ?? 20, 100), select: sourceSelect }),
      this.db.knowledgeSource.count({ where }),
    ]);
    return { sources: await this.sourcesWithIndexFacts(member.organizationId, sources), total, page: query.page ?? 1, pageSize: Math.min(query.pageSize ?? 20, 100) };
  }

  async baseAssistants(userId: string, slug: string, baseId: string) {
    const member = await this.workspaces.requireAccess(userId, slug);
    await this.requireBase(member.organizationId, baseId, false);
    const [linked, available, activeBases] = await Promise.all([
      this.db.assistantKnowledgeBase.findMany({ where: { organizationId: member.organizationId, knowledgeBaseId: baseId }, include: { assistant: { select: { id: true, name: true, status: true } } }, orderBy: [{ createdAt: 'asc' }, { assistantId: 'asc' }] }),
      this.db.chatbot.findMany({ where: { organizationId: member.organizationId, status: 'ACTIVE' }, select: { id: true, name: true, status: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 100 }),
      this.db.knowledgeBase.findMany({ where: { organizationId: member.organizationId, status: 'ACTIVE', archivedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 2, select: { id: true } }),
    ]);
    const linkedIds = new Set(linked.map((row: any) => row.assistantId));
    const defaultBaseId = activeBases.length === 1 ? activeBases[0].id : null;
    return { linked: linked.map((row: any) => ({ ...row.assistant, status: String(row.assistant.status).toLowerCase() })), available: available.filter((assistant: any) => !linkedIds.has(assistant.id)).map((assistant: any) => ({ ...assistant, status: String(assistant.status).toLowerCase() })), knowledgeResolution: { mode: defaultBaseId ? 'WORKSPACE_DEFAULT' as const : 'EXPLICIT_ASSIGNMENT_REQUIRED' as const, isDefault: defaultBaseId === baseId, activeKnowledgeBaseCount: activeBases.length } };
  }

  async addBaseAssistant(userId: string, slug: string, baseId: string, assistantId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    await this.requireBase(member.organizationId, baseId, true);
    await this.requireActiveAssistant(member.organizationId, assistantId);
    try {
      return await this.db.$transaction(async (tx: any) => {
        const activeBase = await tx.knowledgeBase.findFirst({ where: { id: baseId, organizationId: member.organizationId, status: 'ACTIVE' }, select: { id: true } });
        if (!activeBase) throw this.baseNotFound();
        await tx.assistantKnowledgeBase.create({ data: { organizationId: member.organizationId, assistantId, knowledgeBaseId: baseId } });
        await this.audit(tx, member.organizationId, userId, 'knowledge_base.assistant_linked', baseId, { assistantId });
        await tx.auditEvent.create({ data: { organizationId: member.organizationId, actorUserId: userId, action: 'assistant.knowledge_base_linked', entityType: 'chatbot', entityId: assistantId, metadata: { knowledgeBaseId: baseId } } });
        return { assistantId, knowledgeBaseId: baseId, linked: true };
      });
    } catch (error) { if (isUniqueConflict(error)) throw new ConflictException({ code: 'KNOWLEDGE_BASE_ALREADY_LINKED', message: 'This Knowledge Base is already linked to the assistant.' }); throw error; }
  }

  async removeBaseAssistant(userId: string, slug: string, baseId: string, assistantId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    await this.requireBase(member.organizationId, baseId, false);
    await this.requireAssistant(member.organizationId, assistantId);
    return this.db.$transaction(async (tx: any) => {
      const deleted = await tx.assistantKnowledgeBase.deleteMany({ where: { organizationId: member.organizationId, assistantId, knowledgeBaseId: baseId } });
      if (!deleted.count) throw new NotFoundException({ code: 'KNOWLEDGE_BASE_LINK_NOT_FOUND', message: 'This Knowledge Base is not linked to the assistant.' });
      await this.audit(tx, member.organizationId, userId, 'knowledge_base.assistant_unlinked', baseId, { assistantId });
      await tx.auditEvent.create({ data: { organizationId: member.organizationId, actorUserId: userId, action: 'assistant.knowledge_base_unlinked', entityType: 'chatbot', entityId: assistantId, metadata: { knowledgeBaseId: baseId } } });
      return { assistantId, knowledgeBaseId: baseId, unlinked: true };
    });
  }

  async addSources(userId: string, slug: string, baseId: string, input: BulkKnowledgeBaseSourcesDto) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    await this.requireBase(member.organizationId, baseId, true);
    const sourceIds = [...new Set(input.sourceIds)];
    if (!sourceIds.length) throw new BadRequestException({ code: 'EMPTY_SOURCE_SELECTION', message: 'Select at least one source.' });
    return this.db.$transaction(async (tx: any) => {
      const activeBase = await tx.knowledgeBase.findFirst({ where: { id: baseId, organizationId: member.organizationId, status: 'ACTIVE' }, select: { id: true } });
      if (!activeBase) throw this.baseNotFound();
      const sources = await tx.knowledgeSource.findMany({ where: { id: { in: sourceIds }, organizationId: member.organizationId, type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } }, select: { id: true, status: true, visibility: true, processingStatus: true, activeIndexGeneration: true } });
      if (sources.length !== sourceIds.length) throw this.sourceNotFound();
      const inserted = await tx.knowledgeBaseSource.createMany({ data: sourceIds.map((sourceId) => ({ organizationId: member.organizationId, knowledgeBaseId: baseId, sourceId })), skipDuplicates: true });
      if (inserted.count) await this.audit(tx, member.organizationId, userId, 'knowledge_base.sources_added', baseId, { addedCount: inserted.count });
      return {
        requested: sourceIds.length,
        added: inserted.count,
        alreadyPresent: sourceIds.length - inserted.count,
        restrictedVisibility: sources.filter((source: any) => source.visibility !== 'PUBLIC_REFERENCE').length,
        processingBlocked: sources.filter((source: any) => source.processingStatus !== 'READY' || source.activeIndexGeneration == null).length,
        failedProcessing: sources.filter((source: any) => source.processingStatus === 'FAILED').length,
        statusBlocked: sources.filter((source: any) => source.status !== 'REGISTERED').length,
      };
    });
  }

  async removeSources(userId: string, slug: string, baseId: string, input: BulkKnowledgeBaseSourcesDto) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    await this.requireBase(member.organizationId, baseId, true);
    const sourceIds = [...new Set(input.sourceIds)];
    if (!sourceIds.length) throw new BadRequestException({ code: 'EMPTY_SOURCE_SELECTION', message: 'Select at least one source.' });
    return this.db.$transaction(async (tx: any) => {
      const result = await tx.knowledgeBaseSource.deleteMany({ where: { organizationId: member.organizationId, knowledgeBaseId: baseId, sourceId: { in: sourceIds } } });
      if (result.count) await this.audit(tx, member.organizationId, userId, 'knowledge_base.sources_removed', baseId, { removedCount: result.count });
      return { requested: sourceIds.length, removed: result.count, notPresent: sourceIds.length - result.count };
    });
  }

  async assistantBases(userId: string, slug: string, assistantId: string, query: KnowledgeBaseListQueryDto = new KnowledgeBaseListQueryDto()) {
    const member = await this.workspaces.requireAccess(userId, slug);
    await this.requireAssistant(member.organizationId, assistantId);
    const availableWhere = { organizationId: member.organizationId, status: 'ACTIVE', assistantLinks: { none: { organizationId: member.organizationId, assistantId } }, ...(query.search?.trim() ? { name: { contains: query.search.trim(), mode: 'insensitive' } } : {}) };
    const [linked, available, totalAvailable] = await Promise.all([
      query.includeLinked === false ? Promise.resolve([]) : this.db.assistantKnowledgeBase.findMany({ where: { organizationId: member.organizationId, assistantId, knowledgeBase: { status: 'ACTIVE' } }, orderBy: [{ createdAt: 'asc' }, { knowledgeBaseId: 'asc' }], include: { knowledgeBase: { include: { _count: { select: { sources: { where: { source: { type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } } } }, assistantLinks: true } } } } } }),
      this.db.knowledgeBase.findMany({ where: availableWhere, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: ((query.page ?? 1) - 1) * (query.pageSize ?? 20), take: Math.min(query.pageSize ?? 20, 100), include: { _count: { select: { sources: { where: { source: { type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } } } }, assistantLinks: true } } } }),
      this.db.knowledgeBase.count({ where: availableWhere }),
    ]);
    const bases = [...linked.map((row: any) => row.knowledgeBase), ...available];
    const sourceRows = bases.length ? await this.db.knowledgeBaseSource.findMany({ where: { organizationId: member.organizationId, knowledgeBaseId: { in: bases.map((base: any) => base.id) }, source: { organizationId: member.organizationId, type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } } }, select: { knowledgeBaseId: true, source: { select: { type: true, status: true, processingStatus: true } } } }) : [];
    const counts = new Map<string, { faqCount: number; textCount: number; readyCount: number; failedCount: number }>();
    for (const row of sourceRows) {
      const value = counts.get(row.knowledgeBaseId) ?? { faqCount: 0, textCount: 0, readyCount: 0, failedCount: 0 };
      if (row.source.type === 'FAQ') value.faqCount += 1;
      if (row.source.type === 'TEXT') value.textCount += 1;
      if (row.source.status === 'REGISTERED' && row.source.processingStatus === 'READY') value.readyCount += 1;
      if (row.source.status === 'REGISTERED' && row.source.processingStatus === 'FAILED') value.failedCount += 1;
      counts.set(row.knowledgeBaseId, value);
    }
    const withCounts = (base: any) => ({ ...this.view(base), ...(counts.get(base.id) ?? { faqCount: 0, textCount: 0, readyCount: 0, failedCount: 0 }) });
    return { linked: linked.map((row: any) => withCounts(row.knowledgeBase)), available: available.map(withCounts), totalAvailable, page: query.page ?? 1, pageSize: Math.min(query.pageSize ?? 20, 100) };
  }

  async replaceAssistantBases(userId: string, slug: string, assistantId: string, input: ReplaceAssistantKnowledgeBasesDto) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    await this.requireActiveAssistant(member.organizationId, assistantId);
    const requested = [...new Set(input.knowledgeBaseIds)];
    return this.db.$transaction(async (tx: any) => {
      const activeBases = requested.length ? await tx.knowledgeBase.findMany({ where: { id: { in: requested }, organizationId: member.organizationId, status: 'ACTIVE' }, select: { id: true } }) : [];
      if (activeBases.length !== requested.length) throw this.baseNotFound();
      const existingRows = await tx.assistantKnowledgeBase.findMany({ where: { organizationId: member.organizationId, assistantId }, select: { knowledgeBaseId: true } });
      const existing = new Set<string>(existingRows.map((row: any) => String(row.knowledgeBaseId)));
      const target = new Set<string>(requested);
      const added = requested.filter((id) => !existing.has(id));
      const removed = [...existing].filter((id) => !target.has(id));
      if (removed.length) await tx.assistantKnowledgeBase.deleteMany({ where: { organizationId: member.organizationId, assistantId, knowledgeBaseId: { in: removed } } });
      if (added.length) await tx.assistantKnowledgeBase.createMany({ data: added.map((knowledgeBaseId) => ({ organizationId: member.organizationId, assistantId, knowledgeBaseId })) });
      if (added.length || removed.length) await this.audit(tx, member.organizationId, userId, 'assistant.knowledge_bases_replaced', assistantId, { addedCount: added.length, removedCount: removed.length });
      const finalRows = await tx.assistantKnowledgeBase.findMany({ where: { organizationId: member.organizationId, assistantId }, orderBy: [{ knowledgeBaseId: 'asc' }], include: { knowledgeBase: { include: { _count: { select: { sources: { where: { source: { type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } } } }, assistantLinks: true } } } } } });
      return { linked: finalRows.map((row: any) => this.view(row.knowledgeBase)), added: added.length, removed: removed.length };
    });
  }

  /** Resolve the assistant's effective workspace knowledge without changing stored relationships.
   * A sole active base is a workspace default, but its implicit access is limited to public references.
   */
  async resolveEffectiveSources(organizationId: string, assistantId: string, options: { publicOnly?: boolean; includeDiagnostics?: boolean } = {}) {
    const assistant = await this.requireAssistant(organizationId, assistantId);
    const useAllEligibleWorkspaceKnowledge = assistant.useAllEligibleWorkspaceKnowledge === true;
    if (assistant.status !== 'ACTIVE') return { organizationId, assistantId, resolution: 'INACTIVE_ASSISTANT' as const, useAllEligibleWorkspaceKnowledge, defaultKnowledgeBaseId: null, effectiveSourceCount: 0, blockedReasonCounts: {}, knowledgeBases: [], sources: [] };
    const eligibleSource = { status: 'REGISTERED', processingStatus: 'READY', activeIndexGeneration: { not: null }, ...(options.publicOnly ? { visibility: 'PUBLIC_REFERENCE', deletedAt: null } : {}) };
    const [activeBases, explicitBaseLinks, direct, workspaceSources] = await Promise.all([
      this.db.knowledgeBase.findMany({ where: { organizationId, status: 'ACTIVE', archivedAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 2, select: { id: true, name: true, status: true } }),
      this.db.assistantKnowledgeBase.findMany({ where: { organizationId, assistantId, knowledgeBase: { status: 'ACTIVE', archivedAt: null } }, select: { knowledgeBaseId: true, knowledgeBase: { select: { id: true, name: true, status: true } } } }),
      this.db.assistantKnowledgeSource.findMany({ where: { organizationId, assistantId, source: eligibleSource }, include: { source: { select: sourceSelect } } }),
      useAllEligibleWorkspaceKnowledge ? this.db.knowledgeSource.findMany({ where: { organizationId, type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: 'REGISTERED', deletedAt: null, visibility: 'PUBLIC_REFERENCE' }, select: sourceSelect }) : [],
    ]);
    const defaultBase = activeBases.length === 1 ? activeBases[0] : null;
    const linkedBaseIds = [...new Set(explicitBaseLinks.map((row: any) => String(row.knowledgeBaseId)))];
    const sourceMemberships = [
      ...(linkedBaseIds.length ? [{ knowledgeBaseId: { in: linkedBaseIds } }] : []),
      ...(defaultBase ? [{ knowledgeBaseId: defaultBase.id, source: { visibility: 'PUBLIC_REFERENCE' } }] : []),
    ];
    const viaBases = sourceMemberships.length ? await this.db.knowledgeBaseSource.findMany({
      where: { organizationId, source: eligibleSource, OR: sourceMemberships, knowledgeBase: { status: 'ACTIVE', archivedAt: null } },
      include: { source: { select: sourceSelect }, knowledgeBase: { select: { id: true, name: true, status: true } } },
    }) : [];
    const sources = new Map<string, any>();
    const sourceBaseIds = new Map<string, Set<string>>();
    const sourceAccessPaths = new Map<string, Set<'WORKSPACE_POLICY' | 'KNOWLEDGE_BASE' | 'DIRECT'>>();
    const addAccessPath = (sourceId: string, path: 'WORKSPACE_POLICY' | 'KNOWLEDGE_BASE' | 'DIRECT') => {
      const paths = sourceAccessPaths.get(sourceId) ?? new Set<'WORKSPACE_POLICY' | 'KNOWLEDGE_BASE' | 'DIRECT'>();
      paths.add(path);
      sourceAccessPaths.set(sourceId, paths);
    };
    for (const row of direct) {
      if (row.source.status === 'REGISTERED' && row.source.processingStatus === 'READY' && row.source.activeIndexGeneration != null && (!options.publicOnly || (row.source.visibility === 'PUBLIC_REFERENCE' && row.source.deletedAt === null))) {
        sources.set(row.source.id, row.source);
        addAccessPath(row.source.id, 'DIRECT');
      }
    }
    for (const source of workspaceSources) {
      if (source.status === 'REGISTERED' && source.deletedAt === null && source.processingStatus === 'READY' && source.activeIndexGeneration != null && source.visibility === 'PUBLIC_REFERENCE') {
        sources.set(source.id, source);
        addAccessPath(source.id, 'WORKSPACE_POLICY');
      }
    }
    const effectiveBaseIds = new Set([...linkedBaseIds, ...(defaultBase ? [defaultBase.id] : [])]);
    const baseById = new Map<string, EffectiveKnowledgeBase>();
    for (const row of explicitBaseLinks) baseById.set(row.knowledgeBase.id, row.knowledgeBase);
    if (defaultBase) baseById.set(defaultBase.id, defaultBase);
    const readySourceIdsByBase = new Map<string, Set<string>>();
    for (const row of viaBases as any[]) {
      const explicit = linkedBaseIds.includes(row.knowledgeBase.id);
      const implicitPublicDefault = row.knowledgeBase.id === defaultBase?.id && row.source.visibility === 'PUBLIC_REFERENCE';
      if ((!explicit && !implicitPublicDefault) || !['FAQ', 'TEXT', 'WEBSITE'].includes(row.source.type) || row.source.status !== 'REGISTERED' || row.source.processingStatus !== 'READY' || row.source.activeIndexGeneration == null || (options.publicOnly && (row.source.visibility !== 'PUBLIC_REFERENCE' || row.source.deletedAt !== null))) continue;
      sources.set(row.source.id, row.source);
      addAccessPath(row.source.id, 'KNOWLEDGE_BASE');
      const memberships = sourceBaseIds.get(row.source.id) ?? new Set<string>();
      memberships.add(row.knowledgeBase.id);
      sourceBaseIds.set(row.source.id, memberships);
      const ids = readySourceIdsByBase.get(row.knowledgeBase.id) ?? new Set<string>();
      ids.add(row.source.id);
      readySourceIdsByBase.set(row.knowledgeBase.id, ids);
    }
    const sourceRows = [...sources.values()].filter((source) => source.type === 'FAQ' || source.type === 'TEXT' || source.type === 'WEBSITE');
    const activeChunkGroups = sourceRows.length ? await this.db.knowledgeChunk.groupBy({
      by: ['sourceId', 'sourceVersion', 'generation'],
      where: { organizationId, OR: sourceRows.map((source: any) => ({ sourceId: source.id, sourceVersion: source.sourceVersion, generation: source.activeIndexGeneration })) },
      _count: { _all: true },
    }) : [];
    const activeChunksBySource = new Map<string, number>();
    for (const group of activeChunkGroups) activeChunksBySource.set(group.sourceId, (activeChunksBySource.get(group.sourceId) ?? 0) + group._count._all);
    const searchableSources = sourceRows.filter((source: any) => (activeChunksBySource.get(source.id) ?? 0) > 0);
    const blockedReasonCounts: Record<string, number> = {};
    if (useAllEligibleWorkspaceKnowledge && options.includeDiagnostics) {
      const allWorkspaceSources = await this.db.knowledgeSource.findMany({ where: { organizationId, type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' }, deletedAt: null }, select: { id: true, status: true, processingStatus: true, visibility: true, activeIndexGeneration: true, sourceVersion: true } });
      for (const source of allWorkspaceSources as any[]) {
        const reason = source.visibility !== 'PUBLIC_REFERENCE' && options.publicOnly ? 'RESTRICTED_VISIBILITY'
          : source.status !== 'REGISTERED' ? 'SOURCE_NOT_REGISTERED'
            : source.processingStatus !== 'READY' ? `PROCESSING_${String(source.processingStatus)}`
              : source.activeIndexGeneration == null ? 'ACTIVE_GENERATION_MISSING'
                : (activeChunksBySource.get(source.id) ?? 0) === 0 ? 'ACTIVE_INDEX_EMPTY' : null;
        if (reason) blockedReasonCounts[reason] = (blockedReasonCounts[reason] ?? 0) + 1;
      }
    }
    return {
      organizationId,
      assistantId,
      useAllEligibleWorkspaceKnowledge,
      resolution: useAllEligibleWorkspaceKnowledge ? 'ALL_ELIGIBLE_WORKSPACE_KNOWLEDGE' as const : defaultBase ? 'SINGLE_ACTIVE_BASE_DEFAULT' as const : activeBases.length > 1 ? 'EXPLICIT_ASSIGNMENTS' as const : 'NO_ACTIVE_BASE' as const,
      defaultKnowledgeBaseId: defaultBase?.id ?? null,
      effectiveSourceCount: searchableSources.length,
      blockedReasonCounts,
      knowledgeBases: [...effectiveBaseIds].flatMap((id) => { const base = baseById.get(id); const eligibleSourceCount = readySourceIdsByBase.get(id)?.size ?? 0; return base ? [{ id: base.id, name: base.name, status: String(base.status).toLowerCase(), assignment: base.id === defaultBase?.id && !linkedBaseIds.includes(base.id) ? 'WORKSPACE_DEFAULT' as const : 'EXPLICIT' as const, eligibleSourceCount, retrievalEnabled: eligibleSourceCount > 0 }] : []; }),
      sources: searchableSources.map((source: any) => {
        const accessPaths = [...(sourceAccessPaths.get(source.id) ?? [])];
        return { id: source.id, type: source.type, sourceVersion: source.sourceVersion, activeIndexGeneration: source.activeIndexGeneration, activeChunkCount: activeChunksBySource.get(source.id) ?? 0, visibility: source.visibility, semanticIndexStatus: source.semanticIndexStatus, sourceOrigin: source.type === 'WEBSITE' ? 'PUBLIC_WEBSITE' : 'WORKSPACE_AUTHORED', knowledgeBaseIds: [...(sourceBaseIds.get(source.id) ?? [])], accessPaths, accessPath: accessPaths.length > 1 ? 'MULTIPLE' : accessPaths[0] ?? 'UNKNOWN' };
      }),
    };
  }

  async effectiveForMember(userId: string, slug: string, assistantId: string) {
    const member = await this.workspaces.requireAccess(userId, slug);
    return this.resolveEffectiveSources(member.organizationId, assistantId, { publicOnly: true });
  }

  private async requireBase(organizationId: string, baseId: string, activeOnly: boolean) {
    const base = await this.db.knowledgeBase.findFirst({ where: { id: baseId, organizationId, ...(activeOnly ? { status: 'ACTIVE' } : {}) }, include: { _count: { select: { sources: { where: { source: { type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: { not: 'ARCHIVED' } } } }, assistantLinks: true } } } });
    if (!base) throw this.baseNotFound();
    return base;
  }
  private async requireAssistant(organizationId: string, assistantId: string) {
    const assistant = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId }, select: { id: true, status: true, useAllEligibleWorkspaceKnowledge: true } });
    if (!assistant) throw new NotFoundException({ code: 'ASSISTANT_NOT_FOUND', message: 'Assistant not found in this workspace.' });
    return assistant;
  }
  private async requireActiveAssistant(organizationId: string, assistantId: string) {
    const assistant = await this.requireAssistant(organizationId, assistantId);
    if (assistant.status !== 'ACTIVE') throw new BadRequestException({ code: 'ASSISTANT_NOT_ACTIVE', message: 'Only active assistants can be linked to a Knowledge Base.' });
    return assistant;
  }
  private view(base: any) {
    const { _count, ...record } = base;
    delete record.nameKey;
    return { ...record, status: String(record.status).toLowerCase(), sourceCount: _count?.sources ?? 0, faqCount: _count?.faqSources ?? 0, textCount: _count?.textSources ?? 0, readyCount: _count?.readySources ?? 0, linkedAssistantCount: _count?.assistantLinks ?? 0 };
  }
  private sourceView(source: any, indexFacts: { activeChunkCount?: number; indexedPageCount?: number; lastIndexedAt?: Date | null } = {}) {
    const { _count, ...record } = source;
    const activeChunkCount = indexFacts.activeChunkCount;
    const activeIndexSearchable = activeChunkCount === undefined ? undefined : record.status === 'REGISTERED' && record.processingStatus === 'READY' && record.activeIndexGeneration != null && activeChunkCount > 0;
    const blockedReason = record.status === 'ARCHIVED' ? 'SOURCE_ARCHIVED' : record.status !== 'REGISTERED' ? 'SOURCE_NOT_REGISTERED' : record.processingStatus === 'FAILED' ? 'PROCESSING_FAILED' : record.processingStatus !== 'READY' ? 'INDEX_NOT_READY' : record.activeIndexGeneration == null ? 'NO_ACTIVE_GENERATION' : activeChunkCount === 0 ? 'EMPTY_ACTIVE_INDEX' : undefined;
    return { ...record, pageCount: _count?.pages ?? 0, ...(indexFacts.indexedPageCount !== undefined ? { indexedPageCount: indexFacts.indexedPageCount } : {}), ...(activeChunkCount !== undefined ? { activeChunkCount } : {}), ...(indexFacts.lastIndexedAt !== undefined ? { lastIndexedAt: indexFacts.lastIndexedAt } : {}), ...(activeIndexSearchable !== undefined ? { activeIndexSearchable } : {}), ...(blockedReason ? { blockedReason } : {}), type: String(record.type).toLowerCase(), status: String(record.status).toLowerCase(), processingStatus: String(record.processingStatus).toLowerCase() };
  }
  private async sourcesWithIndexFacts(organizationId: string, sources: any[]) {
    if (!sources.length) return [];
    const sourceIds = sources.map((source) => source.id);
    const [chunkGroups, pageGroups] = await Promise.all([
      this.db.knowledgeChunk.groupBy({ by: ['sourceId', 'sourceVersion', 'generation'], where: { organizationId, sourceId: { in: sourceIds } }, _count: { _all: true }, _max: { indexedAt: true } }),
      this.db.knowledgePage.groupBy({ by: ['sourceId', 'sourceVersion', 'generation'], where: { organizationId, sourceId: { in: sourceIds }, status: 'READY' }, _count: { _all: true } }),
    ]);
    return sources.map((source) => {
      const currentCount = (groups: any[]) => groups.filter((group) => group.sourceId === source.id && group.sourceVersion === source.sourceVersion && group.generation === source.activeIndexGeneration).reduce((count, group) => count + group._count._all, 0);
      const activeGroup = chunkGroups.find((group: any) => group.sourceId === source.id && group.sourceVersion === source.sourceVersion && group.generation === source.activeIndexGeneration);
      return this.sourceView(source, { activeChunkCount: currentCount(chunkGroups), indexedPageCount: currentCount(pageGroups), lastIndexedAt: activeGroup?._max?.indexedAt ?? null });
    });
  }
  private async audit(tx: any, organizationId: string, actorUserId: string, action: string, id: string, metadata: Record<string, unknown>) {
    await tx.auditEvent.create({ data: { organizationId, actorUserId, action, entityType: 'knowledge_base', entityId: id, metadata } });
  }
  private baseNotFound() { return new NotFoundException({ code: 'KNOWLEDGE_BASE_NOT_FOUND', message: 'Knowledge Base not found in this workspace.' }); }
  private sourceNotFound() { return new NotFoundException({ code: 'KNOWLEDGE_SOURCE_NOT_FOUND', message: 'One or more sources are unavailable in this workspace.' }); }
  private mapNameConflict(error: unknown): never {
    if (isUniqueConflict(error)) throw new ConflictException({ code: 'KNOWLEDGE_BASE_NAME_CONFLICT', message: 'A Knowledge Base with this name already exists in this workspace.' });
    throw error;
  }
}
