import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkspaceService } from './workspace.service';
import { KnowledgeProcessingService } from './knowledge-processing.service';
import type { AssistantBusinessRuleDto, AssistantListQueryDto, CreateAssistantDto, UpdateAssistantDto } from './assistant.dto';
import type { TrainingHistoryQueryDto } from './training-history.dto';
import { ConversationProviderService, getEffectiveProviderConfiguration, isValidProviderRoute } from './conversation-provider.service';
import type { ProviderRoute } from './conversation-provider.service';
import { ConversationOrchestrator } from './conversation-orchestrator.service';
import type { PlaygroundTurnRequest } from './conversation.contracts';
import type { PlaygroundTraceEvent } from './playground-diagnostics';

const managers = ['OWNER', 'ADMIN'] as const;
const isUniqueConflict = (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
const assistantSelect = {
  id: true, organizationId: true, createdById: true, name: true, description: true, providerMode: true, providerFallbacks: true, businessPurpose: true,
  systemInstructions: true, defaultLanguage: true, responseTone: true, responseStyle: true, fallbackMessage: true, greetingMessage: true, escalationMessage: true,
  useAllEligibleWorkspaceKnowledge: true,
  status: true, archivedAt: true, createdAt: true, updatedAt: true,
};


@Injectable()
export class AssistantService {
  private readonly db: any;
  private readonly providerAdapter: ConversationProviderService;
  private readonly conversationOrchestrator: ConversationOrchestrator;

  constructor(prisma: PrismaService, private readonly workspaces: WorkspaceService, @Optional() knowledgeProcessing?: KnowledgeProcessingService, @Optional() providerAdapter?: ConversationProviderService, @Optional() conversationOrchestrator?: ConversationOrchestrator) {
    this.db = prisma as any;
    this.providerAdapter = providerAdapter ?? new ConversationProviderService();
    this.conversationOrchestrator = conversationOrchestrator ?? new ConversationOrchestrator(prisma, workspaces, knowledgeProcessing, this.providerAdapter);
  }

  async create(userId: string, slug: string, input: CreateAssistantDto) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const name = input.name.trim().replace(/\s+/g, ' ');
    if (name.length < 2) throw new BadRequestException({ code: 'INVALID_ASSISTANT_NAME', message: 'Assistant name must be at least 2 characters.' });
    try {
      const assistant = await this.db.$transaction(async (tx: any) => {
        const created = await tx.chatbot.create({ data: {
          organizationId: membership.organizationId,
          createdById: userId,
          name,
          description: input.description?.trim() || null,
          providerMode: 'MANUAL',
          providerFallbacks: [],
          businessPurpose: input.businessPurpose?.trim() || null,
          systemInstructions: input.systemInstructions?.trim() || null,
          defaultLanguage: input.defaultLanguage?.trim() || 'auto',
          responseTone: input.responseTone || 'professional',
          responseStyle: input.responseStyle || 'balanced',
          fallbackMessage: input.fallbackMessage?.trim() || 'I’m not able to help with that right now. Please contact the business directly.',
          greetingMessage: input.greetingMessage?.trim() || null,
          escalationMessage: input.escalationMessage?.trim() || null,
          status: 'DRAFT',
        }, select: assistantSelect });
        await this.audit(tx, membership.organizationId, userId, 'assistant.created', created.id);
        return created;
      });
      return this.view(assistant);
    } catch (error) {
      if (isUniqueConflict(error)) throw new ConflictException({ code: 'ASSISTANT_CONFLICT', message: 'The assistant could not be created because its data conflicts with an existing record.' });
      throw error;
    }
  }

  async list(userId: string, slug: string, pagination: AssistantListQueryDto) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    const status = pagination.status ?? 'ALL';
    const where = {
      organizationId: membership.organizationId,
      ...(status === 'ARCHIVED' ? { archivedAt: { not: null } } : { archivedAt: null }),
      ...(status !== 'ALL' && status !== 'ARCHIVED' ? { status } : {}),
    };
    const page = pagination.page ?? 1;
    const pageSize = Math.min(pagination.pageSize ?? 25, 100);
    const [records, total] = await Promise.all([
      this.db.chatbot.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, select: assistantSelect }),
      this.db.chatbot.count({ where }),
    ]);
    return { assistants: records.map((record: any) => this.view(record)), page, pageSize, total };
  }

  async get(userId: string, slug: string, assistantId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    const record = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId: membership.organizationId }, select: assistantSelect });
    if (!record) throw this.notFound();
    return this.view(record);
  }

  async update(userId: string, slug: string, assistantId: string, input: UpdateAssistantDto & { providerMode?: 'MANUAL' | 'AUTO_FALLBACK'; providerFallbacks?: ProviderRoute[] }) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    if (input.useAllEligibleWorkspaceKnowledge !== undefined && membership.role !== 'OWNER') throw new ForbiddenException({ code: 'OWNER_REQUIRED', message: 'Only the workspace owner can change all-workspace knowledge access.' });
    if (Object.prototype.hasOwnProperty.call(input, 'aiProvider') || Object.prototype.hasOwnProperty.call(input, 'aiModel')) throw new BadRequestException({ code: 'PROVIDER_CONFIGURATION_SERVER_MANAGED', message: 'Provider and model are managed by the server configuration.' });
    const data: Record<string, unknown> = {};
    for (const key of ['name', 'description', 'providerMode', 'providerFallbacks', 'businessPurpose', 'systemInstructions', 'defaultLanguage', 'responseTone', 'responseStyle', 'fallbackMessage', 'greetingMessage', 'escalationMessage', 'useAllEligibleWorkspaceKnowledge'] as const) {
      if (input[key] !== undefined) {
        const value = input[key];
        data[key] = typeof value === 'string' ? value.trim() : value;
      }
    }
    if (!Object.keys(data).length) throw new BadRequestException({ code: 'EMPTY_ASSISTANT_UPDATE', message: 'Choose at least one assistant setting to update.' });
    if (typeof data.name === 'string') {
      const normalizedName = (data.name as string).replace(/\s+/g, ' ');
      data.name = normalizedName;
      if (normalizedName.length < 2) throw new BadRequestException({ code: 'INVALID_ASSISTANT_NAME', message: 'Assistant name must be at least 2 characters.' });
    }
    const existing = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId: membership.organizationId }, select: { id: true, providerMode: true, providerFallbacks: true, archivedAt: true } });
    if (!existing) throw this.notFound();
    if (existing.archivedAt) throw new ConflictException({ code: 'ASSISTANT_ARCHIVED', message: 'Restore this assistant before changing its configuration.' });
    const effective = getEffectiveProviderConfiguration();
    const nextMode = data.providerMode !== undefined ? data.providerMode : existing.providerMode;
    const rawBackups: unknown = data.providerFallbacks !== undefined ? data.providerFallbacks : existing.providerFallbacks;
    const nextBackups = Array.isArray(rawBackups) ? rawBackups.filter(isValidProviderRoute) : [];
    if (data.providerFallbacks !== undefined && (!Array.isArray(rawBackups) || rawBackups.length > 2 || nextBackups.length !== rawBackups.length)) throw new BadRequestException({ code: 'INVALID_PROVIDER_FALLBACK', message: 'Each backup must use an approved provider and valid model identifier.' });
    if (nextMode === 'AUTO_FALLBACK') {
      if (!effective.configurationValid || !effective.provider || !effective.model || !Array.isArray(rawBackups) || rawBackups.length > 2 || nextBackups.length !== rawBackups.length) throw new BadRequestException({ code: 'FALLBACK_CONFIGURATION_REQUIRED', message: 'Automatic fallback requires a valid server-configured primary and explicitly approved backups.' });
      if (nextBackups.length === 0) throw new BadRequestException({ code: 'FALLBACK_CONFIGURATION_REQUIRED', message: 'Automatic fallback requires a primary provider and at least one explicitly approved backup.' });
      const seen = new Set<string>([`${effective.provider}:${effective.model.trim().toLowerCase()}`]);
      for (const backup of nextBackups) {
        const key = `${backup.provider}:${backup.model.trim().toLowerCase()}`;
        if (seen.has(key)) throw new BadRequestException({ code: 'DUPLICATE_PROVIDER_FALLBACK', message: 'Provider backup entries must be unique.' });
        seen.add(key);
      }
    }
    if (data.providerFallbacks !== undefined) data.providerFallbacks = nextBackups.map(({ provider, model }) => ({ provider, model: model.trim() }));
    const updated = await this.db.$transaction(async (tx: any) => {
      const record = await tx.chatbot.update({ where: { id_organizationId: { id: existing.id, organizationId: membership.organizationId } }, data, select: assistantSelect });
        await this.audit(tx, membership.organizationId, userId, 'assistant.behavior_updated', assistantId);
      return record;
    });
    return this.view(updated);
  }

  async providerConfigurationStatus(userId: string, slug: string) {
    await this.workspaces.requireAccess(userId, slug, managers);
    return this.providerAdapter.getProviderConfigurationStatus();
  }

  async validateOpenRouterModel(userId: string, slug: string) {
    await this.workspaces.requireAccess(userId, slug, managers);
    return this.providerAdapter.validateOpenRouterModel();
  }

  async setActive(userId: string, slug: string, assistantId: string, active: boolean) {
    const membership = await this.workspaces.requireAccess(userId, slug, managers);
    const existing = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId: membership.organizationId }, select: { id: true, status: true, archivedAt: true } });
    if (!existing) throw this.notFound();
    if (existing.archivedAt) throw new ConflictException({ code: 'ASSISTANT_ARCHIVED', message: 'Restore this assistant before changing its active status.' });
    const nextStatus = active ? 'ACTIVE' : 'INACTIVE';
    if (existing.status !== nextStatus) {
      const updated = await this.db.$transaction(async (tx: any) => {
        const changed = await tx.chatbot.updateMany({ where: { id: existing.id, organizationId: membership.organizationId, archivedAt: null }, data: { status: nextStatus } });
        if (changed.count !== 1) throw new ConflictException({ code: 'ASSISTANT_ARCHIVED', message: 'This assistant was archived before its active status could be changed.' });
        const record = await tx.chatbot.findFirst({ where: { id: existing.id, organizationId: membership.organizationId }, select: assistantSelect });
        await this.audit(tx, membership.organizationId, userId, active ? 'assistant.activated' : 'assistant.deactivated', assistantId);
        return record;
      });
      return this.view(updated);
    }
    return this.get(userId, slug, assistantId);
  }

  async archive(userId: string, slug: string, assistantId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const existing = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId: member.organizationId }, select: { id: true, status: true, archivedAt: true } });
    if (!existing) throw this.notFound();
    if (existing.archivedAt) return this.get(userId, slug, assistantId);
    const archivedAt = new Date();
    const archived = await this.db.$transaction(async (tx: any) => {
      const changed = await tx.chatbot.updateMany({
        where: { id: assistantId, organizationId: member.organizationId, archivedAt: null },
        data: { archivedAt, status: existing.status === 'DRAFT' ? 'DRAFT' : 'INACTIVE' },
      });
      if (changed.count !== 1) throw new ConflictException({ code: 'ASSISTANT_LIFECYCLE_CHANGED', message: 'The assistant changed while it was being archived. Reload and try again.' });
      await tx.auditEvent.create({ data: { organizationId: member.organizationId, actorUserId: userId, action: 'assistant.archived', entityType: 'chatbot', entityId: assistantId, metadata: { previousStatus: existing.status } } });
      return tx.chatbot.findFirst({ where: { id: assistantId, organizationId: member.organizationId }, select: assistantSelect });
    });
    return this.view(archived);
  }

  async restore(userId: string, slug: string, assistantId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    const existing = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId: member.organizationId }, select: { id: true, archivedAt: true } });
    if (!existing) throw this.notFound();
    if (!existing.archivedAt) return this.get(userId, slug, assistantId);
    const restored = await this.db.$transaction(async (tx: any) => {
      const changed = await tx.chatbot.updateMany({ where: { id: assistantId, organizationId: member.organizationId, archivedAt: { not: null } }, data: { archivedAt: null } });
      if (changed.count !== 1) throw new ConflictException({ code: 'ASSISTANT_LIFECYCLE_CHANGED', message: 'The assistant changed while it was being restored. Reload and try again.' });
      await tx.auditEvent.create({ data: { organizationId: member.organizationId, actorUserId: userId, action: 'assistant.restored', entityType: 'chatbot', entityId: assistantId, metadata: null } });
      return tx.chatbot.findFirst({ where: { id: assistantId, organizationId: member.organizationId }, select: assistantSelect });
    });
    return this.view(restored);
  }

  async permanentDeleteUnavailable(userId: string, slug: string, assistantId: string): Promise<never> {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    await this.requireAssistant(member.organizationId, assistantId);
    throw new ConflictException({ code: 'ASSISTANT_DELETE_UNAVAILABLE', message: 'Permanent deletion is unavailable because current assistant relationships can cascade into retained conversations and workflow records. Archive the assistant to prevent use while preserving history.' });
  }

  async listRules(userId: string, slug: string, assistantId: string) {
    const member = await this.workspaces.requireAccess(userId, slug);
    await this.requireAssistant(member.organizationId, assistantId);
    return this.db.assistantBusinessRule.findMany({ where: { organizationId: member.organizationId, assistantId }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }] });
  }

  async createRule(userId: string, slug: string, assistantId: string, input: AssistantBusinessRuleDto) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    await this.requireAssistant(member.organizationId, assistantId);
    return this.db.$transaction(async (tx: any) => {
      const rule = await tx.assistantBusinessRule.create({ data: { organizationId: member.organizationId, assistantId, title: input.title.trim(), instruction: input.instruction.trim(), enabled: input.enabled ?? true } });
      await tx.auditEvent.create({ data: { organizationId: member.organizationId, actorUserId: userId, action: 'assistant.business_rule_created', entityType: 'chatbot', entityId: assistantId, metadata: { ruleId: rule.id, enabled: rule.enabled } } });
      return rule;
    });
  }

  async updateRule(userId: string, slug: string, assistantId: string, ruleId: string, input: Partial<AssistantBusinessRuleDto>) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    await this.requireAssistant(member.organizationId, assistantId);
    const data = { ...(input.title !== undefined ? { title: input.title.trim() } : {}), ...(input.instruction !== undefined ? { instruction: input.instruction.trim() } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) };
    if (!Object.keys(data).length) throw new BadRequestException({ code: 'EMPTY_RULE_UPDATE', message: 'Change a rule field before saving.' });
    return this.db.$transaction(async (tx: any) => {
      const existing = await tx.assistantBusinessRule.findFirst({ where: { id: ruleId, organizationId: member.organizationId, assistantId }, select: { id: true } });
      if (!existing) throw this.notFound();
      const rule = await tx.assistantBusinessRule.update({ where: { id_organizationId: { id: ruleId, organizationId: member.organizationId } }, data });
      await tx.auditEvent.create({ data: { organizationId: member.organizationId, actorUserId: userId, action: 'assistant.business_rule_updated', entityType: 'chatbot', entityId: assistantId, metadata: { ruleId, enabled: rule.enabled } } });
      return rule;
    });
  }

  async deleteRule(userId: string, slug: string, assistantId: string, ruleId: string) {
    const member = await this.workspaces.requireAccess(userId, slug, managers);
    await this.requireAssistant(member.organizationId, assistantId);
    return this.db.$transaction(async (tx: any) => {
      const existing = await tx.assistantBusinessRule.findFirst({ where: { id: ruleId, organizationId: member.organizationId, assistantId }, select: { id: true } });
      if (!existing) throw this.notFound();
      await tx.assistantBusinessRule.delete({ where: { id_organizationId: { id: ruleId, organizationId: member.organizationId } } });
      await tx.auditEvent.create({ data: { organizationId: member.organizationId, actorUserId: userId, action: 'assistant.business_rule_deleted', entityType: 'chatbot', entityId: assistantId, metadata: { ruleId } } });
      return { deleted: true };
    });
  }

  async trainingHistory(userId: string, slug: string, assistantId: string, query: TrainingHistoryQueryDto = { page: 1, pageSize: 25 }) {
    const member = await this.workspaces.requireAccess(userId, slug);
    await this.requireAssistant(member.organizationId, assistantId);
    const [baseLinks, directLinks] = await Promise.all([
      this.db.assistantKnowledgeBase.findMany({ where: { organizationId: member.organizationId, assistantId }, select: { knowledgeBaseId: true } }),
      this.db.assistantKnowledgeSource.findMany({ where: { organizationId: member.organizationId, assistantId }, select: { sourceId: true } }),
    ]);
    const baseIds = baseLinks.map((link: any) => link.knowledgeBaseId);
    const sourceIds = directLinks.map((link: any) => link.sourceId);
    const baseSources = baseIds.length ? await this.db.knowledgeBaseSource.findMany({ where: { organizationId: member.organizationId, knowledgeBaseId: { in: baseIds } }, select: { sourceId: true } }) : [];
    const relatedSourceIds = [...new Set([...sourceIds, ...baseSources.map((row: any) => row.sourceId)])];
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    const where = { organizationId: member.organizationId, AND: [{ OR: [
      { entityType: 'chatbot', entityId: assistantId, action: { startsWith: 'assistant.' } },
      ...(baseIds.length ? [{ entityType: 'knowledge_base', entityId: { in: baseIds }, action: { startsWith: 'knowledge_base.' } }] : []),
      ...(relatedSourceIds.length ? [{ entityType: 'knowledge_source', entityId: { in: relatedSourceIds }, action: { startsWith: 'knowledge.' } }] : []),
    ] }, ...(query.action ? [{ action: query.action }] : []), ...(query.from ? [{ createdAt: { gte: new Date(query.from) } }] : []), ...(query.to ? [{ createdAt: { lte: new Date(query.to) } }] : [])] };
    const [events, total] = await Promise.all([
      this.db.auditEvent.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, action: true, entityType: true, entityId: true, actorUserId: true, metadata: true, createdAt: true, actorUser: { select: { name: true, email: true } } } }),
      this.db.auditEvent.count({ where }),
    ]);
    return { events, total, page, pageSize, hasMore: page * pageSize < total };
  }

  async trainingOverview(userId: string, slug: string, assistantId: string) {
    const member = await this.workspaces.requireAccess(userId, slug);
    const assistant = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId: member.organizationId }, select: assistantSelect });
    if (!assistant) throw this.notFound();
    const [baseLinks, directLinks] = await Promise.all([
      this.db.assistantKnowledgeBase.findMany({ where: { organizationId: member.organizationId, assistantId, knowledgeBase: { status: 'ACTIVE' } }, select: { knowledgeBaseId: true, knowledgeBase: { select: { id: true, name: true } } } }),
      this.db.assistantKnowledgeSource.findMany({ where: { organizationId: member.organizationId, assistantId }, select: { sourceId: true } }),
    ]);
    const baseIds = baseLinks.map((link: any) => link.knowledgeBaseId);
    const sourceIds = directLinks.map((link: any) => link.sourceId);
    const eligibleScope = [
      ...(sourceIds.length ? [{ id: { in: sourceIds } }] : []),
      ...(baseIds.length ? [{ knowledgeBaseLinks: { some: { organizationId: member.organizationId, knowledgeBaseId: { in: baseIds }, knowledgeBase: { status: 'ACTIVE' } } } }] : []),
    ];
    const [grouped, linkedSources, publicReadyCount, ruleGroups, activeRulesPreview] = await Promise.all([
      eligibleScope.length ? this.db.knowledgeSource.groupBy({ by: ['type', 'processingStatus'], where: { organizationId: member.organizationId, type: { in: ['FAQ', 'TEXT'] }, status: 'REGISTERED', deletedAt: null, OR: eligibleScope }, _count: { _all: true } }) : [],
      eligibleScope.length ? this.db.knowledgeSource.findMany({ where: { organizationId: member.organizationId, type: { in: ['FAQ', 'TEXT'] }, status: 'REGISTERED', deletedAt: null, OR: eligibleScope }, select: { id: true } }) : [],
      eligibleScope.length ? this.db.knowledgeSource.count({ where: { organizationId: member.organizationId, type: { in: ['FAQ', 'TEXT'] }, status: 'REGISTERED', processingStatus: 'READY', visibility: 'PUBLIC_REFERENCE', deletedAt: null, OR: eligibleScope } }) : 0,
      this.db.assistantBusinessRule.groupBy({ by: ['enabled'], where: { organizationId: member.organizationId, assistantId }, _count: { _all: true } }),
      this.db.assistantBusinessRule.findMany({ where: { organizationId: member.organizationId, assistantId, enabled: true }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 3, select: { id: true, title: true, instruction: true } }),
    ]);
    const recentActivity = await this.db.auditEvent.findMany({ where: { organizationId: member.organizationId, OR: [
      { entityType: 'chatbot', entityId: assistantId, action: { startsWith: 'assistant.' } },
      { entityType: 'knowledge_source', action: { in: ['knowledge.source_linked', 'knowledge.source_unlinked'] }, metadata: { path: ['assistantId'], equals: assistantId } },
      ...(linkedSources.length ? [{ entityType: 'knowledge_source', entityId: { in: linkedSources.map((source: { id: string }) => source.id) }, action: { startsWith: 'knowledge.' } }] : []),
      ...(baseIds.length ? [{ entityType: 'knowledge_base', entityId: { in: baseIds }, action: { in: ['knowledge.faq_batch_created', 'knowledge.faq_imported'] } }] : []),
    ] }, orderBy: { createdAt: 'desc' }, take: 6, select: { id: true, action: true, entityType: true, actorUserId: true, metadata: true, createdAt: true, actorUser: { select: { name: true, email: true } } } });
    const counts = { faq: 0, text: 0, ready: 0, processing: 0, notIndexed: 0, failed: 0 };
    for (const row of grouped) {
      const sourceCount = row._count._all;
      if (row.type === 'FAQ') counts.faq += sourceCount;
      if (row.type === 'TEXT') counts.text += sourceCount;
      if (row.processingStatus === 'READY') counts.ready += sourceCount;
      else if (row.processingStatus === 'FAILED') counts.failed += sourceCount;
      else if (row.processingStatus === 'NOT_PROCESSED') counts.notIndexed += sourceCount;
      else counts.processing += sourceCount;
    }
    const ruleCounts = { active: 0, disabled: 0 };
    for (const group of ruleGroups) {
      if (group.enabled) ruleCounts.active = group._count._all;
      else ruleCounts.disabled = group._count._all;
    }
      const behaviorConfigured = Boolean(assistant.businessPurpose?.trim() || assistant.systemInstructions?.trim() || assistant.greetingMessage?.trim() || assistant.escalationMessage?.trim() || assistant.responseTone !== 'professional' || assistant.responseStyle !== 'balanced' || assistant.defaultLanguage !== 'auto');
    const totalKnowledge = counts.faq + counts.text;
    return {
      assistant: this.view(assistant),
      linkedKnowledgeBaseCount: baseIds.length,
      linkedKnowledgeBases: baseLinks.map((link: { knowledgeBase: { id: string; name: string } }) => ({ id: link.knowledgeBase.id, name: link.knowledgeBase.name })),
      faqCount: counts.faq,
      textCount: counts.text,
      totalKnowledge,
      readyCount: counts.ready,
      playgroundReadyCount: publicReadyCount,
      processingCount: counts.processing,
      notIndexedCount: counts.notIndexed,
      failedCount: counts.failed,
      attentionCount: counts.processing + counts.notIndexed + counts.failed,
      activeRuleCount: ruleCounts.active,
      disabledRuleCount: ruleCounts.disabled,
      activeRulesPreview,
      recentActivity,
      behaviorConfigured,
      hasCustomInstructions: Boolean(assistant.systemInstructions?.trim()),
      hasGreeting: Boolean(assistant.greetingMessage?.trim()),
      hasCustomFallback: assistant.fallbackMessage !== 'I’m not able to help with that right now. Please contact the business directly.',
    };
  }

  /** Canonical conversation execution is coordinated by ConversationOrchestrator. */
  async playgroundChat(userId: string, slug: string, assistantId: string, input: PlaygroundTurnRequest, requestId = 'unknown', signal?: AbortSignal, onAuthorized?: () => void, onTraceEvent?: (event: PlaygroundTraceEvent) => void) {
    return this.conversationOrchestrator.playgroundChat(userId, slug, assistantId, input, requestId, signal, onAuthorized, onTraceEvent);
  }

  async playgroundConversation(userId: string, slug: string, assistantId: string, sessionId: string, offset?: number, limit?: number, latest = false) {
    if (latest) return this.conversationOrchestrator.playgroundConversation(userId, slug, assistantId, sessionId, offset, limit, true);
    return offset === undefined && limit === undefined
      ? this.conversationOrchestrator.playgroundConversation(userId, slug, assistantId, sessionId)
      : this.conversationOrchestrator.playgroundConversation(userId, slug, assistantId, sessionId, offset, limit);
  }

  private async audit(tx: any, organizationId: string, userId: string, action: string, assistantId: string) {
    await tx.auditEvent.create({ data: { organizationId, actorUserId: userId, action, entityType: 'chatbot', entityId: assistantId, metadata: null } });
  }

  private async requireAssistant(organizationId: string, assistantId: string) {
    const assistant = await this.db.chatbot.findFirst({ where: { id: assistantId, organizationId }, select: { id: true } });
    if (!assistant) throw this.notFound();
    return assistant;
  }

  private view(record: any) {
    const providerConfig = getEffectiveProviderConfiguration();
    const providerFallbacks = Array.isArray(record.providerFallbacks) ? record.providerFallbacks.filter(isValidProviderRoute) : [];
    const effectiveProviderConfiguration = { provider: providerConfig.provider, model: providerConfig.model, status: providerConfig.configurationStatus, configurationValid: providerConfig.configurationValid, keyConfigured: providerConfig.keyConfigured, ready: providerConfig.ready };
    return { ...record, aiProvider: providerConfig.provider, aiModel: providerConfig.model, effectiveProviderConfiguration, providerFallbacks, status: record.archivedAt ? 'archived' : String(record.status).toLowerCase() };
  }

  private notFound() {
    return new NotFoundException({ code: 'ASSISTANT_NOT_FOUND', message: 'Assistant not found in this workspace.' });
  }
}
