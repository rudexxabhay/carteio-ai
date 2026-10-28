import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { CreateWorkspaceDto, UpdateWorkspaceDto, WorkspacePaginationDto } from './workspace.dto';
import { getEffectiveProviderConfiguration } from './conversation-provider.service';

const reservedSlugs = new Set([
  'admin', 'api', 'auth', 'dashboard', 'docs', 'help', 'login', 'logout', 'onboarding',
  'public', 'settings', 'signup', 'static', 'support', 'team', 'www', 'workspace', 'workspaces',
]);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const isUniqueConflict = (error: unknown) => isRecord(error) && error.code === 'P2002';

export function normalizeWorkspaceSlug(value: string): string {
  const slug = value.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (slug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new BadRequestException({ code: 'INVALID_WORKSPACE_SLUG', message: 'Use 1–63 letters, numbers, or single hyphens in the workspace URL.' });
  }
  if (reservedSlugs.has(slug)) {
    throw new BadRequestException({ code: 'RESERVED_WORKSPACE_SLUG', message: 'That workspace URL is reserved. Choose another.' });
  }
  return slug;
}

function normalizeWebsite(value: string | null | undefined): string | null {
  if (value == null || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new BadRequestException({ code: 'INVALID_WEBSITE_URL', message: 'Enter a valid http or https website URL.' });
  }
}

function workspaceView(organization: any, role: string) {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    websiteUrl: organization.websiteUrl ?? null,
    businessType: organization.businessType ?? null,
    timezone: organization.timezone || 'UTC',
    locale: organization.locale || 'en',
    status: organization.status.toLowerCase(),
    role: role.toLowerCase(),
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

@Injectable()
export class WorkspaceService {
  private readonly db: any;

  constructor(prisma: PrismaService) { this.db = prisma; }

  async create(userId: string, input: CreateWorkspaceDto) {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 200) {
      throw new BadRequestException({ code: 'INVALID_WORKSPACE_NAME', message: 'Workspace name must be between 2 and 200 characters.' });
    }
    const slug = normalizeWorkspaceSlug(input.slug);
    const businessType = input.businessType?.trim() || null;
    if (businessType && businessType.length > 80) {
      throw new BadRequestException({ code: 'INVALID_BUSINESS_TYPE', message: 'Business type must be 80 characters or fewer.' });
    }
    const websiteUrl = normalizeWebsite(input.websiteUrl);

    try {
      const organization = await this.db.$transaction(async (tx: any) => {
        const created = await tx.organization.create({
          data: { name, slug, websiteUrl, businessType, status: 'ACTIVE' },
        });
        await tx.organizationMembership.create({
          data: { organizationId: created.id, userId, role: 'OWNER', status: 'ACTIVE' },
        });
        await tx.auditEvent.create({
          data: {
            organizationId: created.id,
            actorUserId: userId,
            action: 'workspace.created',
            entityType: 'organization',
            entityId: created.id,
            metadata: { role: 'OWNER' },
          },
        });
        return created;
      });
      return workspaceView(organization, 'OWNER');
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new ConflictException({ code: 'WORKSPACE_SLUG_UNAVAILABLE', message: 'That workspace URL is already in use.' });
      }
      throw error;
    }
  }

  async list(userId: string, pagination: WorkspacePaginationDto) {
    const page = pagination.page ?? 1;
    const pageSize = pagination.pageSize ?? 25;
    const where = {
      userId,
      status: 'ACTIVE',
      organization: { status: 'ACTIVE' },
    };
    const [memberships, total] = await Promise.all([
      this.db.organizationMembership.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { organizationId: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          role: true,
          organization: {
            select: { id: true, name: true, slug: true, websiteUrl: true, businessType: true, timezone: true, locale: true, status: true, createdAt: true, updatedAt: true },
          },
        },
      }),
      this.db.organizationMembership.count({ where }),
    ]);
    return { workspaces: memberships.map((membership: any) => workspaceView(membership.organization, membership.role)), page, pageSize, total };
  }

  async getAuthorized(userId: string, slug: string) {
    const membership = await this.db.organizationMembership.findFirst({
      where: { userId, status: 'ACTIVE', organization: { slug, status: 'ACTIVE' } },
      select: {
        role: true,
        organization: { select: { id: true, name: true, slug: true, websiteUrl: true, businessType: true, timezone: true, locale: true, status: true, createdAt: true, updatedAt: true } },
      },
    });
    if (!membership) throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' });
    return { ...workspaceView(membership.organization, membership.role), currentUserRole: membership.role.toLowerCase() };
  }

  async dashboardSummary(userId: string, slug: string) {
    const membership = await this.requireAccess(userId, slug);
    const organizationId = membership.organizationId;
    const effectiveProvider = getEffectiveProviderConfiguration();
    const [organizationResult, integrationGroupsResult, recentIntegrationsResult] = await Promise.allSettled([
      this.db.organization.findUnique({ where: { id: organizationId }, select: { businessType: true, websiteUrl: true, timezone: true, updatedAt: true } }),
      this.db.integrationConnection.groupBy({ by: ['state'], where: { organizationId }, _count: { _all: true } }),
      this.db.integrationConnection.findMany({ where: { organizationId }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 5, select: { id: true, platform: true, displayName: true, state: true, lastSyncAt: true, lastSuccessfulSyncAt: true, lastErrorCode: true } }),
    ]);
    const organization = organizationResult.status === 'fulfilled' ? organizationResult.value : null;
    const integrationsAvailable = integrationGroupsResult.status === 'fulfilled' && recentIntegrationsResult.status === 'fulfilled';
    const integrationGroups = integrationGroupsResult.status === 'fulfilled' ? integrationGroupsResult.value : [];
    const recentIntegrations = recentIntegrationsResult.status === 'fulfilled' ? recentIntegrationsResult.value : [];
    const connectedStates = ['CONNECTED', 'SYNCING', 'CONNECTED_WITH_WARNINGS'];
    const connectedIntegrationCount = integrationGroups.reduce((count: number, group: any) => count + (connectedStates.includes(group.state) ? group._count._all : 0), 0);
    const commerceRead = integrationsAvailable && connectedIntegrationCount ? Promise.all([
      this.db.commerceProduct.count({ where: { organizationId, connection: { is: { state: { in: connectedStates } } } } }),
      this.db.commerceProduct.count({ where: { organizationId, connection: { is: { state: { in: connectedStates } } }, inventory: 0 } }),
      this.db.commerceProduct.groupBy({ by: ['rawStatus'], where: { organizationId, connection: { is: { state: { in: connectedStates } } } }, _count: { _all: true } }),
      this.db.commerceOrder.count({ where: { organizationId, connection: { is: { state: { in: connectedStates } } } } }),
      this.db.commerceOrder.groupBy({ by: ['financialStatus'], where: { organizationId, connection: { is: { state: { in: connectedStates } } } }, _count: { _all: true } }),
      this.db.commerceOrder.findMany({ where: { organizationId, connection: { is: { state: { in: connectedStates } } } }, orderBy: [{ orderedAt: 'desc' }, { id: 'asc' }], take: 5, select: { id: true, displayReference: true, currency: true, total: true, financialStatus: true, fulfillmentStatus: true, orderedAt: true, connection: { select: { displayName: true, platform: true } } } }),
    ]) : Promise.resolve(null);
    const dashboardSalesTo = new Date();
    const dashboardSalesFrom = new Date(dashboardSalesTo.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dashboardPlaygroundTo = new Date();
    const dashboardPlaygroundFrom = new Date(Date.UTC(dashboardPlaygroundTo.getUTCFullYear(), dashboardPlaygroundTo.getUTCMonth(), 1));
    const playgroundRead = this.db.playgroundConversation.count({ where: { organizationId, channel: 'PLAYGROUND', createdAt: { gte: dashboardPlaygroundFrom, lte: dashboardPlaygroundTo } } });
    const salesRead = membership.role === 'OWNER' || membership.role === 'ADMIN'
      ? this.db.$queryRaw<Array<{ currency: string | null; orderCount: number; netSales: string | null }>>`
          SELECT o."currency", COUNT(*)::integer AS "orderCount",
            SUM(COALESCE(o."subtotal", 0) - COALESCE(o."discountTotal", 0) - COALESCE(o."refundedTotal", 0))::text AS "netSales"
          FROM "CommerceOrder" o
          INNER JOIN "IntegrationConnection" c ON c."id" = o."connectionId" AND c."organizationId" = o."organizationId"
          WHERE o."organizationId" = ${organizationId}::uuid
            AND c."state" IN ('CONNECTED', 'CONNECTED_WITH_WARNINGS', 'SYNCING')
            AND o."financialStatus" IN ('paid', 'partially_refunded', 'refunded', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
            AND o."orderedAt" >= ${dashboardSalesFrom} AND o."orderedAt" <= ${dashboardSalesTo}
          GROUP BY o."currency" ORDER BY o."currency" NULLS LAST`
      : Promise.resolve(null);
    const assistantRead = Promise.all([
      this.db.chatbot.groupBy({ by: ['status'], where: { organizationId, archivedAt: null }, _count: { _all: true } }),
      this.db.chatbot.findMany({ where: { organizationId, archivedAt: null }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 6, select: { id: true, name: true, description: true, businessPurpose: true, status: true, updatedAt: true, _count: { select: { knowledgeBases: { where: { knowledgeBase: { status: 'ACTIVE' } } }, knowledgeSources: { where: { source: { type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: 'REGISTERED', deletedAt: null } } } } } } }),
      this.db.chatbot.count({ where: { organizationId, archivedAt: null, knowledgeBases: { none: { knowledgeBase: { status: 'ACTIVE' } } }, knowledgeSources: { none: { source: { type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: 'REGISTERED', deletedAt: null } } } } }),
      Promise.resolve(effectiveProvider.ready),
      this.db.chatbot.findFirst({ where: { organizationId, archivedAt: null, status: 'ACTIVE' }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], select: { id: true } }),
    ]);
    const knowledgeRead = Promise.all([
      this.db.knowledgeBase.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.db.knowledgeSource.groupBy({ by: ['type', 'processingStatus'], where: { organizationId, type: { in: ['FAQ', 'TEXT', 'WEBSITE'] }, status: 'REGISTERED', deletedAt: null }, _count: { _all: true } }),
      this.db.knowledgeBase.findFirst({ where: { organizationId, status: 'ACTIVE' }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], select: { id: true } }),
    ]);
    const activityRead = this.db.auditEvent.findMany({ where: { organizationId, OR: [
      { action: { startsWith: 'assistant.' } },
      { action: { startsWith: 'knowledge.' } },
      { action: { startsWith: 'knowledge_base.' } },
    ] }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, action: true, entityType: true, createdAt: true, actorUser: { select: { name: true, email: true } } } });
    const [assistantResult, knowledgeResult, activityResult, playgroundResult] = await Promise.allSettled([assistantRead, knowledgeRead, activityRead, playgroundRead]);
    const unavailable = { status: 'error' as const };
    let assistants: any = unavailable;
    if (assistantResult.status === 'fulfilled') {
      const [groups, rows, withoutKnowledge, providerReady, firstActive] = assistantResult.value;
      const total = groups.reduce((sum: number, group: any) => sum + group._count._all, 0);
      const active = groups.find((group: any) => group.status === 'ACTIVE')?._count._all ?? 0;
      assistants = { status: 'success', data: { total, active, withoutKnowledge, withoutProvider: providerReady ? 0 : total, effectiveProviderConfiguration: { provider: effectiveProvider.provider, model: effectiveProvider.model, status: effectiveProvider.configurationStatus, configurationValid: effectiveProvider.configurationValid, keyConfigured: effectiveProvider.keyConfigured, ready: effectiveProvider.ready }, firstActiveAssistantId: firstActive?.id ?? null, items: rows.map((row: any) => ({ id: row.id, name: row.name, purpose: row.businessPurpose || row.description || null, status: String(row.status).toLowerCase(), provider: effectiveProvider.provider, model: effectiveProvider.model, providerConfigured: effectiveProvider.ready, updatedAt: row.updatedAt, linkedKnowledgeBaseCount: row._count.knowledgeBases, directKnowledgeCount: row._count.knowledgeSources })) } };
    }
    let knowledge: any = unavailable;
    if (knowledgeResult.status === 'fulfilled') {
      const [knowledgeBaseCount, groups, firstKnowledgeBase] = knowledgeResult.value;
      const counts = { faq: 0, text: 0, website: 0, ready: 0, processing: 0, failed: 0, notIndexed: 0 };
      for (const group of groups) {
        const amount = group._count._all;
        if (group.type === 'FAQ') counts.faq += amount;
        if (group.type === 'TEXT') counts.text += amount;
        if (group.type === 'WEBSITE') counts.website += amount;
        if (group.processingStatus === 'READY') counts.ready += amount;
        else if (group.processingStatus === 'FAILED') counts.failed += amount;
        else if (group.processingStatus === 'NOT_PROCESSED') counts.notIndexed += amount;
        else counts.processing += amount;
      }
      knowledge = { status: 'success', data: { knowledgeBaseCount, firstKnowledgeBaseId: firstKnowledgeBase?.id ?? null, ...counts, total: counts.faq + counts.text + counts.website } };
    }
    const [commerceResult, salesResult] = await Promise.allSettled([commerceRead, salesRead]);
    let commerce: Record<string, unknown> = { status: !integrationsAvailable ? 'ERROR' : connectedIntegrationCount ? 'NO_DATA' : 'NOT_CONNECTED' };
    if (commerceResult.status === 'rejected') commerce = { status: 'ERROR' };
    else if (commerceResult.value) {
      const [productCount, outOfStockCount, productStatuses, orderCount, financialStatuses, recentOrders] = commerceResult.value;
      const activeProductStatuses = new Set(['active', 'published', 'enabled', 'ACTIVE', 'PUBLISHED', 'ENABLED']);
      const pendingOrderStatuses = new Set(['pending', 'awaiting_payment', 'unpaid', 'PENDING', 'AWAITING_PAYMENT', 'UNPAID']);
      const hasKnownProductStatuses = productStatuses.some((group: any) => activeProductStatuses.has(group.rawStatus ?? '') || ['draft', 'inactive', 'disabled', 'DRAFT', 'INACTIVE', 'DISABLED'].includes(group.rawStatus ?? ''));
      const hasKnownFinancialStatuses = financialStatuses.some((group: any) => group.financialStatus != null);
      commerce = {
        status: productCount || orderCount ? 'AVAILABLE' : 'NO_DATA',
        productCount,
        ...(hasKnownProductStatuses || productCount === 0 ? { activeProductCount: productStatuses.reduce((count: number, group: any) => count + (activeProductStatuses.has(group.rawStatus ?? '') ? group._count._all : 0), 0) } : {}),
        outOfStockCount,
        orderCount,
        ...(hasKnownFinancialStatuses || orderCount === 0 ? { pendingOrderCount: financialStatuses.reduce((count: number, group: any) => count + (pendingOrderStatuses.has(group.financialStatus ?? '') ? group._count._all : 0), 0) } : {}),
        recentOrders,
      };
    }
    const sales = salesResult.status === 'rejected'
      ? { status: 'ERROR' }
      : salesResult.value === null
        ? { status: 'PERMISSION_REQUIRED' }
        : { status: salesResult.value.length ? 'AVAILABLE' : connectedIntegrationCount ? 'NO_DATA' : 'NOT_CONNECTED', from: dashboardSalesFrom.toISOString(), to: dashboardSalesTo.toISOString(), currencyTotals: salesResult.value };
    return {
      workspace: { businessType: organization?.businessType ?? null, websiteUrl: organization?.websiteUrl ?? null, timezone: organization?.timezone ?? 'UTC', role: membership.role.toLowerCase(), updatedAt: organization?.updatedAt ?? null },
      integrations: integrationsAvailable
        ? { connectedCount: connectedIntegrationCount, draftCount: integrationGroups.reduce((count: number, group: any) => count + (['DRAFT', 'PENDING_VERIFICATION'].includes(group.state) ? group._count._all : 0), 0), errorCount: integrationGroups.find((group: any) => group.state === 'ERROR')?._count._all ?? 0, status: (integrationGroups.find((group: any) => group.state === 'SYNCING')?._count._all ?? 0) > 0 ? 'SYNC_PENDING' : connectedIntegrationCount ? 'AVAILABLE' : 'NOT_CONNECTED', items: recentIntegrations.filter((integration: any) => connectedStates.includes(integration.state)) }
        : { connectedCount: 0, draftCount: 0, errorCount: 0, status: 'ERROR', items: [] },
      commerce,
      sales,
      playground: playgroundResult.status === 'fulfilled' ? { status: 'success', data: { sessions: playgroundResult.value, from: dashboardPlaygroundFrom.toISOString(), to: dashboardPlaygroundTo.toISOString(), kind: 'PLAYGROUND_ONLY' } } : unavailable,
      assistants,
      knowledge,
      activity: activityResult.status === 'fulfilled' ? { status: 'success', data: activityResult.value } : unavailable,
    };
  }

  async update(userId: string, slug: string, input: UpdateWorkspaceDto) {
    const membership = await this.requireAccess(userId, slug, ['OWNER', 'ADMIN']);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name.length < 2 || name.length > 200) throw new BadRequestException({ code: 'INVALID_WORKSPACE_NAME', message: 'Workspace name must be between 2 and 200 characters.' });
      data.name = name;
    }
    if (input.websiteUrl !== undefined) data.websiteUrl = normalizeWebsite(input.websiteUrl);
    if (input.businessType !== undefined) {
      const value = input.businessType?.trim() || null;
      if (value && value.length > 80) throw new BadRequestException({ code: 'INVALID_BUSINESS_TYPE', message: 'Business type must be 80 characters or fewer.' });
      data.businessType = value;
    }
    if (input.timezone !== undefined) {
      const timezone = input.timezone.trim();
      try { new Intl.DateTimeFormat('en', { timeZone: timezone }); }
      catch { throw new BadRequestException({ code: 'INVALID_WORKSPACE_TIMEZONE', message: 'Choose a supported IANA timezone.' }); }
      data.timezone = timezone;
    }
    if (input.locale !== undefined) data.locale = input.locale.trim();
    if (!Object.keys(data).length) throw new BadRequestException({ code: 'EMPTY_WORKSPACE_UPDATE', message: 'Choose at least one workspace setting to update.' });

    const updated = await this.db.$transaction(async (tx: any) => {
      const organization = await tx.organization.update({ where: { id: membership.organizationId }, data });
      await tx.auditEvent.create({
        data: {
          organizationId: membership.organizationId,
          actorUserId: userId,
          action: 'workspace.updated',
          entityType: 'organization',
          entityId: membership.organizationId,
          metadata: { changedFields: Object.keys(data) },
        },
      });
      return organization;
    });
    return workspaceView(updated, membership.role);
  }

  async members(userId: string, slug: string, pagination: WorkspacePaginationDto) {
    const membership = await this.requireAccess(userId, slug);
    const where = { organizationId: membership.organizationId, status: 'ACTIVE' };
    const [members, total] = await Promise.all([
      this.db.organizationMembership.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: ((pagination.page ?? 1) - 1) * (pagination.pageSize ?? 25),
        take: pagination.pageSize ?? 25,
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, name: true } },
        },
      }),
      this.db.organizationMembership.count({ where }),
    ]);
    return {
      members: members.map((member: any) => ({ id: member.user.id, name: member.user.name, role: member.role.toLowerCase(), joinedAt: member.createdAt })),
      page: pagination.page ?? 1,
      pageSize: pagination.pageSize ?? 25,
      total,
      currentUserRole: membership.role.toLowerCase(),
    };
  }

  /** Reusable tenant boundary for future websites, assistants, knowledge and integrations APIs. */
  async requireAccess(userId: string, slug: string, allowedRoles?: readonly ('OWNER' | 'ADMIN' | 'MEMBER')[]) {
    const membership = await this.db.organizationMembership.findFirst({
      where: { userId, status: 'ACTIVE', organization: { slug, status: 'ACTIVE' } },
      select: { organizationId: true, role: true },
    });
    if (!membership) throw new NotFoundException({ code: 'WORKSPACE_NOT_FOUND', message: 'Workspace not found.' });
    if (allowedRoles && !allowedRoles.includes(membership.role)) {
      throw new ForbiddenException({ code: 'WORKSPACE_ROLE_REQUIRED', message: 'You do not have permission to manage this workspace.' });
    }
    return membership;
  }
}
