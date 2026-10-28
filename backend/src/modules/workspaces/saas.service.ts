import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkspaceService } from './workspace.service';
import { ConversationOrchestrator } from './conversation-orchestrator.service';
import { isShopifyScopeSnapshotFresh, shopifyScopeAllows } from './connectors/shopify-granted-scope-discovery.service';
import type { CommerceListQueryDto, CreateIntegrationConnectionDto, InboxListQueryDto, UpdateInboxConversationDto } from './saas.dto';

const maximumPageSize = 100;
const cleanSearch = (value: string | undefined) => value?.trim().slice(0, 120) || undefined;

function validateConversationSources(value: unknown): unknown[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length > 20) throw new BadRequestException({ code: 'INVALID_CONVERSATION_SOURCES', message: 'Conversation source provenance is invalid.' });
  const allowed = new Set(['reference', 'title', 'type', 'locator', 'chunkId', 'sourceId', 'sourceVersion', 'contentHash', 'cited', 'sourceAuthority']);
  const sources = value.map((source) => {
    if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).some((key) => !allowed.has(key))) throw new BadRequestException({ code: 'INVALID_CONVERSATION_SOURCES', message: 'Conversation source provenance is invalid.' });
    const item = source as Record<string, unknown>;
    const boundedText = (key: string, max: number) => typeof item[key] === 'string' && (item[key] as string).length > 0 && (item[key] as string).length <= max;
    if (!boundedText('reference', 256) || !boundedText('title', 300) || !boundedText('type', 48) || !boundedText('chunkId', 128) || !boundedText('sourceId', 128) || !boundedText('contentHash', 128) || (item.locator !== null && (typeof item.locator !== 'string' || item.locator.length > 2048)) || (item.sourceVersion !== undefined && (!Number.isInteger(item.sourceVersion) || Number(item.sourceVersion) < 0)) || !['true', 'false'].includes(String(item.cited))) throw new BadRequestException({ code: 'INVALID_CONVERSATION_SOURCES', message: 'Conversation source provenance is invalid.' });
    if (item.sourceAuthority !== undefined && !['SHOPIFY_API_POLICY', 'SHOPIFY_API_POLICY_STALE', 'PUBLIC_WEBSITE', 'MERCHANT_KNOWLEDGE'].includes(String(item.sourceAuthority))) throw new BadRequestException({ code: 'INVALID_CONVERSATION_SOURCES', message: 'Conversation source provenance is invalid.' });
    return { reference: item.reference, title: item.title, type: item.type, locator: item.locator, chunkId: item.chunkId, sourceId: item.sourceId, ...(item.sourceVersion !== undefined ? { sourceVersion: item.sourceVersion } : {}), contentHash: item.contentHash, ...(item.sourceAuthority ? { sourceAuthority: item.sourceAuthority } : {}), cited: item.cited };
  });
  if (JSON.stringify(sources).length > 12000) throw new BadRequestException({ code: 'INVALID_CONVERSATION_SOURCES', message: 'Conversation source provenance is invalid.' });
  return sources;
}

function normalizeSiteUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port) throw new Error('unsafe');
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new BadRequestException({ code: 'INVALID_INTEGRATION_URL', message: 'Enter a valid HTTPS website URL without credentials or a custom port.' });
  }
}

@Injectable()
export class SaasService {
  private readonly db: any;

  constructor(prisma: PrismaService, private readonly workspaces: WorkspaceService, private readonly conversations: ConversationOrchestrator) {
    this.db = prisma;
  }

  async listIntegrations(userId: string, slug: string) {
    const { organizationId } = await this.workspaces.requireAccess(userId, slug);
    const items = await this.db.integrationConnection.findMany({
      where: { organizationId }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 100,
      select: { id: true, platform: true, displayName: true, siteUrl: true, state: true, grantedScopes: true, lastErrorCode: true, lastSyncAt: true, lastSuccessfulSyncAt: true, createdAt: true, updatedAt: true },
    });
    return { items, pageSize: 100, connectedCount: items.filter((item: any) => ['CONNECTED', 'SYNCING', 'CONNECTED_WITH_WARNINGS'].includes(item.state)).length };
  }

  async createIntegration(userId: string, slug: string, input: CreateIntegrationConnectionDto) {
    const { organizationId } = await this.workspaces.requireAccess(userId, slug, ['OWNER', 'ADMIN']);
    const displayName = input.displayName.trim();
    if (displayName.length < 2) throw new BadRequestException({ code: 'INVALID_INTEGRATION_NAME', message: 'Integration name must contain at least two characters.' });
    const siteUrl = normalizeSiteUrl(input.siteUrl);
    const row = await this.db.$transaction(async (tx: any) => {
      const connection = await tx.integrationConnection.create({
        data: { organizationId, platform: input.platform, displayName, siteUrl, state: 'DRAFT', grantedScopes: [] },
        select: { id: true, platform: true, displayName: true, siteUrl: true, state: true, grantedScopes: true, createdAt: true },
      });
      await tx.auditEvent.create({ data: { organizationId, actorUserId: userId, action: 'integration.draft_created', entityType: 'integration_connection', entityId: connection.id, metadata: { platform: input.platform } } });
      return connection;
    });
    return { ...row, setup: 'CREDENTIAL_VAULT_REQUIRED', message: 'This connection is a draft. No credentials were stored and no external account was contacted.' };
  }

  async disconnectIntegration(userId: string, slug: string, integrationId: string) {
    const { organizationId } = await this.workspaces.requireAccess(userId, slug, ['OWNER', 'ADMIN']);
    const existing = await this.db.integrationConnection.findFirst({ where: { id: integrationId, organizationId }, select: { id: true, state: true } });
    if (!existing) throw new NotFoundException({ code: 'INTEGRATION_NOT_FOUND', message: 'Integration not found.' });
    const row = await this.db.$transaction(async (tx: any) => {
      const updated = await tx.integrationConnection.update({ where: { id: existing.id }, data: { state: 'REVOKED', secretReference: null, grantedScopes: [] }, select: { id: true, state: true, updatedAt: true } });
      await tx.auditEvent.create({ data: { organizationId, actorUserId: userId, action: 'integration.revoked', entityType: 'integration_connection', entityId: integrationId, metadata: { previousState: existing.state } } });
      return updated;
    });
    return row;
  }

  async products(userId: string, slug: string, query: CommerceListQueryDto) {
    const { organizationId } = await this.workspaces.requireAccess(userId, slug);
    const access = await this.businessCommerceAccess(organizationId);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, maximumPageSize);
    const search = cleanSearch(query.search);
    const externalId = query.externalId?.trim();
    const allowedConnectionIds = [...access.keys()].filter((connectionId) => !query.integrationId || query.integrationId === connectionId);
    const where = { organizationId, connectionId: { in: allowedConnectionIds }, connection: { is: { state: { in: ['CONNECTED', 'CONNECTED_WITH_WARNINGS', 'SYNCING'] } } }, ...(externalId ? { externalId } : {}), ...(query.status ? { rawStatus: query.status } : {}), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { sku: { contains: search, mode: 'insensitive' } }, { externalId: { contains: search, mode: 'insensitive' } }] } : {}), AND: [{ OR: [{ rawStatus: null }, { rawStatus: { not: 'DELETED' } }] }] };
    const [items, total, connected, syncPending] = await Promise.all([
      this.db.commerceProduct.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, externalId: true, name: true, description: true, sku: true, category: true, currency: true, price: true, inventory: true, availabilityStatus: true, rawStatus: true, productUrl: true, imageUrl: true, externalUpdatedAt: true, syncedAt: true, variants: { orderBy: [{ title: 'asc' }, { id: 'asc' }], take: 1000, select: { externalId: true, title: true, sku: true, currency: true, price: true, inventory: true, availabilityStatus: true, rawStatus: true } }, connection: { select: { id: true, displayName: true, platform: true, state: true } } } }),
      this.db.commerceProduct.count({ where }),
      this.db.integrationConnection.count({ where: { organizationId, state: { in: ['CONNECTED', 'CONNECTED_WITH_WARNINGS', 'SYNCING'] } } }),
      this.db.integrationConnection.count({ where: { organizationId, state: { in: ['DRAFT', 'PENDING_VERIFICATION', 'SYNCING'] } } }),
    ]);
    const safeItems = items.map((item: any) => { const permissions = access.get(item.connection.id) ?? { prices: false, inventory: false, categories: false }; return { ...item, category: permissions.categories ? item.category : null, currency: permissions.prices ? item.currency : null, price: permissions.prices ? item.price : null, inventory: permissions.inventory ? item.inventory : null, availabilityStatus: permissions.inventory ? item.availabilityStatus : null, variants: item.variants.map((variant: any) => ({ ...variant, currency: permissions.prices ? variant.currency : null, price: permissions.prices ? variant.price : null, inventory: permissions.inventory ? variant.inventory : null, availabilityStatus: permissions.inventory ? variant.availabilityStatus : null })) }; });
    return { items: safeItems, page, pageSize, total, availability: connected > 0 ? (syncPending > 0 ? 'SYNC_PENDING' : total ? 'AVAILABLE' : 'NO_DATA') : 'NOT_CONNECTED' };
  }

  async orders(userId: string, slug: string, query: CommerceListQueryDto) {
    const { organizationId } = await this.workspaces.requireAccess(userId, slug, ['OWNER', 'ADMIN']);
    const allowedConnections = await this.businessOrderConnections(organizationId);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, maximumPageSize);
    const search = cleanSearch(query.search);
    const where = { organizationId, connectionId: { in: allowedConnections.filter((connectionId: string) => !query.integrationId || query.integrationId === connectionId) }, connection: { is: { state: { in: ['CONNECTED', 'CONNECTED_WITH_WARNINGS', 'SYNCING'] } } }, ...(query.status ? { OR: [{ financialStatus: query.status }, { fulfillmentStatus: query.status }, { rawStatus: query.status }] } : {}), ...(search ? { AND: [{ OR: [{ displayReference: { contains: search, mode: 'insensitive' } }, { externalId: { contains: search, mode: 'insensitive' } }] }] } : {}) };
    const [items, total, connected] = await Promise.all([
      this.db.commerceOrder.findMany({ where, orderBy: [{ orderedAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, externalId: true, displayReference: true, financialStatus: true, fulfillmentStatus: true, currency: true, subtotal: true, discountTotal: true, shippingTotal: true, taxTotal: true, total: true, refundedTotal: true, orderedAt: true, externalUpdatedAt: true, rawStatus: true, syncedAt: true, connection: { select: { displayName: true, platform: true } }, lines: { orderBy: [{ id: 'asc' }], take: 1000, select: { externalId: true, productExternalId: true, name: true, sku: true, quantity: true, currency: true, unitPrice: true, total: true } }, _count: { select: { lines: true } } } }),
      this.db.commerceOrder.count({ where }),
      this.db.integrationConnection.count({ where: { organizationId, state: { in: ['CONNECTED', 'CONNECTED_WITH_WARNINGS', 'SYNCING'] } } }),
    ]);
    return { items, page, pageSize, total, availability: connected ? (total ? 'AVAILABLE' : 'NO_DATA') : 'NOT_CONNECTED' };
  }

  async sales(userId: string, slug: string, from?: string, to?: string) {
    const { organizationId } = await this.workspaces.requireAccess(userId, slug, ['OWNER', 'ADMIN']);
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime())) || (fromDate && toDate && fromDate > toDate)) {
      throw new BadRequestException({ code: 'INVALID_DATE_RANGE', message: 'Choose a valid sales date range.' });
    }
    const fromValue = fromDate ?? null;
    const toValue = toDate ?? null;
    const connected = await this.db.integrationConnection.count({ where: { organizationId, state: { in: ['CONNECTED', 'CONNECTED_WITH_WARNINGS', 'SYNCING'] } } });
    if (!connected) return { availability: 'NOT_CONNECTED', currencyTotals: [], formula: 'Net sales = order subtotal - discounts - refunded amount; totals are grouped by source currency and never converted.' };
    const groups = await this.db.$queryRaw<Array<{ currency: string | null; orderCount: number; grossSubtotal: string | null; discounts: string | null; refunds: string | null; netSales: string | null; orderTotals: string | null }>>`
      SELECT o."currency", COUNT(*)::integer AS "orderCount",
        SUM(o."subtotal")::text AS "grossSubtotal", SUM(o."discountTotal")::text AS "discounts",
        SUM(o."refundedTotal")::text AS "refunds",
        SUM(COALESCE(o."subtotal", 0) - COALESCE(o."discountTotal", 0) - COALESCE(o."refundedTotal", 0))::text AS "netSales",
        SUM(o."total")::text AS "orderTotals"
      FROM "CommerceOrder" o
      INNER JOIN "IntegrationConnection" c ON c."id" = o."connectionId" AND c."organizationId" = o."organizationId"
      WHERE o."organizationId" = ${organizationId}::uuid
        AND c."state" IN ('CONNECTED', 'CONNECTED_WITH_WARNINGS', 'SYNCING')
        AND EXISTS (SELECT 1 FROM "ConnectorInstance" ci WHERE ci."organizationId"=o."organizationId" AND ci."integrationConnectionId"=c.id AND ci.state='CONNECTED' AND ci."verifiedCapabilities" @> '["ORDERS"]'::jsonb AND (ci."connectorId" <> 'shopify_v1' OR (COALESCE(c."grantedScopesVerifiedAt", ci."lastVerifiedAt") >= NOW() - INTERVAL '24 hours' AND c."grantedScopes" @> ARRAY['read_orders']::text[])) AND EXISTS (SELECT 1 FROM "ConnectorDataPermission" dp WHERE dp."organizationId"=ci."organizationId" AND dp."connectorInstanceId"=ci.id AND dp.category='ORDERS' AND dp.enabled=true))
        AND o."financialStatus" IN ('paid', 'partially_refunded', 'refunded', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
        AND (${fromValue}::timestamptz IS NULL OR o."orderedAt" >= ${fromValue})
        AND (${toValue}::timestamptz IS NULL OR o."orderedAt" <= ${toValue})
      GROUP BY o."currency" ORDER BY o."currency" NULLS LAST`;
    const currencyTotals = groups;
    return { availability: groups.length ? 'AVAILABLE' : 'NO_DATA', currencyTotals, formula: 'Net sales = order subtotal - discounts - refunded amount; totals are grouped by source currency and never converted.' };
  }

  async inbox(userId: string, slug: string, query: InboxListQueryDto) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    const organizationId = membership.organizationId;
    const manager = ['OWNER', 'ADMIN'].includes(membership.role);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, maximumPageSize);
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to) && to) to.setUTCHours(23, 59, 59, 999);
    if (from && to && from > to) throw new BadRequestException({ code: 'INVALID_DATE_RANGE', message: 'Choose a valid conversation date range.' });
    if (from && to && to.getTime() - from.getTime() > 366 * 86400000) throw new BadRequestException({ code: 'DATE_RANGE_TOO_LARGE', message: 'Conversation date ranges are limited to one year.' });
    if (from && from.getTime() < Date.now() - 366 * 86400000 || to && to.getTime() > Date.now() + 86400000) throw new BadRequestException({ code: 'DATE_RANGE_TOO_LARGE', message: 'Conversation date ranges are limited to one year.' });
    const customerSearch = query.search?.trim().replace(/^visitor\s*/i, '').toLowerCase();
    const searchFilters = query.search ? [
      ...(customerSearch && /^[a-f0-9]{1,6}$/.test(customerSearch) ? [{ externalSessionHash: { startsWith: customerSearch } }] : []),
      ...( /^[0-9a-f-]{36}$/i.test(query.search) ? [{ id: query.search }] : []),
      { lastMessagePreview: { contains: cleanSearch(query.search), mode: 'insensitive' } },
      { assistant: { is: { name: { contains: cleanSearch(query.search), mode: 'insensitive' } } } },
    ] : [];
    const logicalFilters: any[] = [];
    if (searchFilters.length) logicalFilters.push({ OR: searchFilters });
    if (query.read === 'UNREAD') logicalFilters.push({ lastCustomerMessageAt: { not: null }, OR: [{ readStates: { none: { userId } } }, { readStates: { some: { userId, isRead: false } } }] });
    if (query.read === 'READ') logicalFilters.push({ readStates: { some: { userId, isRead: true } } });
    const queueFilter = query.queue === 'ASSIGNED_TO_ME' ? { assignedToUserId: userId } : query.queue === 'RESOLVED' ? { state: 'RESOLVED' } : {};
    const where = { organizationId, ...(!manager ? { assignedToUserId: userId } : {}), ...queueFilter, ...(query.state ? { state: query.state } : {}), ...(query.assistantId ? { assistantId: query.assistantId } : {}), ...(query.channel ? { channel: query.channel } : {}), ...(from || to ? { lastMessageAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}), ...(logicalFilters.length ? { AND: logicalFilters } : {}) };
    const orderBy = query.sort === 'oldest' ? [{ lastMessageAt: 'asc' as const }, { id: 'asc' as const }] : [{ lastMessageAt: 'desc' as const }, { id: 'asc' as const }];
    const [items, total, assistantOptions, channelOptions, unreadCount, unassignedCount, assignedToMeCount, assigneeOptions] = await Promise.all([
      this.db.supportConversation.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, assistantId: true, externalSessionHash: true, channel: true, state: true, assignedToUserId: true, lastMessageAt: true, lastCustomerMessageAt: true, lastMessagePreview: true, messageCount: true, createdAt: true, assistant: { select: { name: true } }, assignee: { select: { id: true, name: true } }, readStates: { where: { userId }, select: { isRead: true } } } }),
      this.db.supportConversation.count({ where }),
      this.db.supportConversation.findMany({ where: { organizationId }, distinct: ['assistantId'], take: 100, select: { assistantId: true, assistant: { select: { name: true } } } }),
      this.db.supportConversation.findMany({ where: { organizationId }, distinct: ['channel'], take: 32, select: { channel: true } }),
      this.db.supportConversation.count({ where: { organizationId, ...(!manager ? { assignedToUserId: userId } : {}), lastCustomerMessageAt: { not: null }, OR: [{ readStates: { none: { userId } } }, { readStates: { some: { userId, isRead: false } } }] } }),
      manager ? this.db.supportConversation.count({ where: { organizationId, assignedToUserId: null } }) : Promise.resolve(0),
      this.db.supportConversation.count({ where: { organizationId, assignedToUserId: userId, state: { notIn: ['RESOLVED', 'CLOSED'] } } }),
      manager ? this.db.organizationMembership.findMany({ where: { organizationId, status: 'ACTIVE' }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }], take: 100, select: { userId: true, role: true, user: { select: { name: true } } } }) : Promise.resolve([]),
    ]);
    return { items: items.map((item: any) => { const read = item.readStates[0]?.isRead === true; const { readStates, externalSessionHash, lastCustomerMessageAt, ...safe } = item; return { ...safe, customerReference: `Visitor ${externalSessionHash.slice(0, 6)}`, unread: !read && Boolean(lastCustomerMessageAt), _count: { messages: item.messageCount } }; }), assistantOptions, channelOptions: channelOptions.map((item: any) => item.channel), assigneeOptions: assigneeOptions.map((item: any) => ({ userId: item.userId, role: item.role, name: item.user.name })), page, pageSize, total, unreadCount, unassignedCount, assignedToMeCount, availability: total ? 'AVAILABLE' : 'NO_DATA', note: 'Playground training sessions are not shown in customer support.' };
  }

  private async requireSupportConversation(userId: string, slug: string, conversationId: string) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    const manager = ['OWNER', 'ADMIN'].includes(membership.role);
    const conversation = await this.db.supportConversation.findFirst({
      where: { id: conversationId, organizationId: membership.organizationId, ...(!manager ? { assignedToUserId: userId } : {}) },
      select: { id: true, organizationId: true, assistantId: true, externalSessionHash: true, state: true, assignedToUserId: true, channel: true, lastMessageAt: true, createdAt: true, assistant: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } },
      },
    });
    if (!conversation) throw new NotFoundException({ code: 'SUPPORT_CONVERSATION_NOT_FOUND', message: 'Conversation not found.' });
    return { membership, manager, conversation };
  }

  async markInboxConversationRead(userId: string, slug: string, conversationId: string) {
    const { membership } = await this.requireSupportConversation(userId, slug, conversationId);
    return this.db.supportConversationReadState.upsert({ where: { conversationId_userId: { conversationId, userId } }, create: { id: randomUUID(), organizationId: membership.organizationId, conversationId, userId, isRead: true, readAt: new Date() }, update: { isRead: true, readAt: new Date() }, select: { conversationId: true, isRead: true, readAt: true } });
  }

  async addConversationNote(userId: string, slug: string, conversationId: string, content: string) {
    const { membership, manager } = await this.requireSupportConversation(userId, slug, conversationId);
    if (!manager) throw new ForbiddenException('Only workspace owners and admins can add internal notes.');
    const note = content.trim();
    if (!note || note.length > 4000) throw new BadRequestException('Internal notes must contain 1 to 4000 characters.');
    return this.db.$transaction(async (tx: any) => {
      const created = await tx.supportMessage.create({
        data: { organizationId: membership.organizationId, conversationId, authorUserId: userId, kind: 'INTERNAL_NOTE', content: note },
        select: { id: true, kind: true, content: true, createdAt: true },
      });
      await tx.auditEvent.create({ data: { organizationId: membership.organizationId, actorUserId: userId, action: 'support.conversation_note_added', entityType: 'SupportConversation', entityId: conversationId, metadata: { noteId: created.id } } });
      return created;
    });
  }

  async inboxConversation(userId: string, slug: string, conversationId: string, page = 1, pageSize = 50) {
    const { membership, conversation } = await this.requireSupportConversation(userId, slug, conversationId);
    await this.db.supportConversationReadState.upsert({ where: { conversationId_userId: { conversationId, userId } }, create: { id: randomUUID(), organizationId: membership.organizationId, conversationId, userId, isRead: true, readAt: new Date() }, update: { isRead: true, readAt: new Date() } });
    const [messages, total] = await Promise.all([
      this.db.supportMessage.findMany({ where: { conversationId, organizationId: membership.organizationId, kind: { in: ['CUSTOMER', 'AI', 'BUSINESS_TEAM', 'INTERNAL_NOTE'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: Math.min(pageSize, 100), select: { id: true, kind: true, content: true, provider: true, model: true, responseCategory: true, answerOrigin: true, sourceRefs: true, createdAt: true, author: { select: { id: true, name: true } } } }),
      this.db.supportMessage.count({ where: { conversationId, organizationId: membership.organizationId, kind: { in: ['CUSTOMER', 'AI', 'BUSINESS_TEAM', 'INTERNAL_NOTE'] } } }),
    ]);
    const { externalSessionHash, ...safe } = conversation as any;
    const canManage = ['OWNER', 'ADMIN'].includes(membership.role);
    return { ...safe, customerReference: `Visitor ${externalSessionHash.slice(0, 6)}`, permissions: { canManage, canReply: canManage || conversation.assignedToUserId === userId }, messages: messages.reverse(), messagePage: page, messagePageSize: Math.min(pageSize, 100), messageTotal: total, hasOlderMessages: page * Math.min(pageSize, 100) < total };
  }

  async updateInboxConversation(userId: string, slug: string, conversationId: string, input: UpdateInboxConversationDto) {
    const { membership, manager, conversation } = await this.requireSupportConversation(userId, slug, conversationId);
    if (!input.state) throw new BadRequestException({ code: 'EMPTY_CONVERSATION_UPDATE', message: 'Choose a status to update.' });
    if (!manager && conversation.assignedToUserId !== userId) throw new NotFoundException({ code: 'SUPPORT_CONVERSATION_NOT_FOUND', message: 'Conversation not found.' });
    const allowed: Record<string, string[]> = { OPEN: ['PENDING', 'RESOLVED', 'CLOSED'], PENDING: ['OPEN', 'RESOLVED', 'CLOSED'], RESOLVED: ['OPEN', 'CLOSED'], CLOSED: ['OPEN'] };
    if (input.state !== conversation.state && !allowed[conversation.state]?.includes(input.state)) throw new ConflictException({ code: 'INVALID_SUPPORT_STATUS_TRANSITION', message: 'This support status transition is not allowed.' });
    if (input.state === conversation.state) return { id: conversation.id, state: conversation.state, idempotent: true };
    const nextState = input.state;
    return this.db.$transaction(async (tx: any) => {
      const changed = await tx.supportConversation.updateMany({ where: { id: conversationId, organizationId: membership.organizationId, state: conversation.state }, data: { state: nextState } });
      if (changed.count !== 1) throw new ConflictException({ code: 'SUPPORT_CONVERSATION_CHANGED', message: 'The conversation changed. Refresh and try again.' });
      const row = await tx.supportConversation.findFirst({ where: { id: conversationId, organizationId: membership.organizationId }, select: { id: true, state: true } });
      const action = ['RESOLVED', 'CLOSED'].includes(nextState) ? 'support.conversation_resolved' : 'support.conversation_reopened';
      await tx.auditEvent.create({ data: { organizationId: membership.organizationId, actorUserId: userId, action: 'support.status_changed', entityType: 'support_conversation', entityId: conversationId, metadata: { previousState: conversation.state, state: nextState } } });
      await tx.auditEvent.create({ data: { organizationId: membership.organizationId, actorUserId: userId, action, entityType: 'support_conversation', entityId: conversationId, metadata: { state: nextState } } });
      return row;
    }, { isolationLevel: 'Serializable' });
  }

  async supportSummary(userId: string, slug: string) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    const manager = ['OWNER', 'ADMIN'].includes(membership.role);
    const scope = { organizationId: membership.organizationId };
    const [total, unassigned, resolved, unread] = await Promise.all([
      this.db.supportConversation.count({ where: scope }),
      manager ? this.db.supportConversation.count({ where: { organizationId: membership.organizationId, assignedToUserId: null } }) : Promise.resolve(0),
      this.db.supportConversation.count({ where: { ...scope, state: 'RESOLVED' } }),
      this.db.supportConversation.count({ where: { ...scope, lastCustomerMessageAt: { not: null }, OR: [{ readStates: { none: { userId } } }, { readStates: { some: { userId, isRead: false } } }] } }),
    ]);
    return { total, unassigned, waiting: 0, humanActive: 0, resolved, unread, visibility: manager ? 'WORKSPACE' : 'ASSIGNED_ONLY' };
  }

  /** Trusted application integration contract for Phase 13+ transports. Never exposed as an unauthenticated controller. */
  createVisitorSessionId() { return randomBytes(32).toString('base64url'); }

  async recordCustomerMessage(input: { organizationId: string; assistantId: string; visitorSessionId: string; channel: string; idempotencyKey: string; content: string; allowTicketStatusLookup?: boolean; ticketAction?: { action: 'CONFIRM_TICKET_DRAFT'; draftId: string; version: number } | { action: 'CANCEL_TICKET_DRAFT'; draftId: string }; requestId?: string; signal?: AbortSignal; ticketInterpretation?: never }) {
    const recorded = await this.recordSupportMessage({ ...input, kind: 'CUSTOMER' });
    const turn = await this.conversations.processTrustedCustomerTurn({ ...input, conversationId: recorded.conversationId });
    return { ...recorded, ...turn };
  }

  async recordAssistantMessage(input: { organizationId: string; assistantId: string; visitorSessionId: string; channel: string; idempotencyKey: string; content: string; provider?: string; model?: string; sourceRefs?: unknown; answerOrigin?: string; responseCategory?: string }) {
    return this.recordSupportMessage({ ...input, kind: 'AI' });
  }

  private async recordSupportMessage(input: { organizationId: string; assistantId: string; visitorSessionId: string; channel: string; idempotencyKey: string; content: string; kind: 'CUSTOMER' | 'AI'; provider?: string; model?: string; sourceRefs?: unknown; answerOrigin?: string; responseCategory?: string }) {
    if (!input.visitorSessionId || input.visitorSessionId.length < 32 || input.visitorSessionId.length > 128 || !/^[A-Z0-9_-]{2,32}$/.test(input.channel) || !/^[A-Za-z0-9._:-]{8,160}$/.test(input.idempotencyKey) || !input.content.trim() || input.content.length > 20000) throw new BadRequestException({ code: 'INVALID_CONVERSATION_MESSAGE', message: 'Conversation message input is invalid.' });
    const assistant = await this.db.chatbot.findFirst({ where: { id: input.assistantId, organizationId: input.organizationId, archivedAt: null, status: 'ACTIVE' }, select: { id: true } });
    if (!assistant) throw new NotFoundException({ code: 'ASSISTANT_NOT_FOUND', message: 'Active assistant not found.' });
    const sourceRefs = input.kind === 'AI' ? validateConversationSources(input.sourceRefs) : undefined;
    const externalSessionHash = createHash('sha256').update(input.visitorSessionId).digest('hex');
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.db.$transaction(async (tx: any) => {
          const now = new Date();
          const conversation = await tx.supportConversation.upsert({ where: { organizationId_assistantId_externalSessionHash: { organizationId: input.organizationId, assistantId: input.assistantId, externalSessionHash } }, create: { id: randomUUID(), organizationId: input.organizationId, assistantId: input.assistantId, externalSessionHash, channel: input.channel }, update: {}, select: { id: true, channel: true } });
          if (conversation.channel !== input.channel) throw new ConflictException({ code: 'CUSTOMER_CHANNEL_MISMATCH', message: 'Visitor session is already bound to another channel.' });
          const inserted = await tx.supportMessage.createMany({ data: [{ id: randomUUID(), organizationId: input.organizationId, conversationId: conversation.id, kind: input.kind, content: input.content, idempotencyKey: input.idempotencyKey, provider: input.kind === 'AI' ? input.provider : undefined, model: input.kind === 'AI' ? input.model : undefined, responseCategory: input.kind === 'AI' ? input.responseCategory : undefined, answerOrigin: input.kind === 'AI' ? input.answerOrigin : undefined, sourceRefs, createdAt: now }], skipDuplicates: true });
          if (inserted.count) await tx.supportConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now, ...(input.kind === 'CUSTOMER' ? { lastCustomerMessageAt: now, readStates: { updateMany: { where: { isRead: true }, data: { isRead: false } } } } : {}), lastMessagePreview: input.content.slice(0, 500), messageCount: { increment: 1 } } });
          return { conversationId: conversation.id, inserted: Boolean(inserted.count) };
        }, { isolationLevel: 'Serializable' });
      } catch (error) {
        if (attempt < 2 && typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2034') continue;
        throw error;
      }
    }
  }

  private async businessCommerceAccess(organizationId: string) {
    const connectors = await this.db.connectorInstance.findMany({ where: { organizationId, state: 'CONNECTED', integrationConnectionId: { not: null }, commerceConnection: { is: { organizationId, state: { in: ['CONNECTED', 'CONNECTED_WITH_WARNINGS', 'SYNCING'] } } } }, select: { id: true, connectorId: true, verifiedCapabilities: true, lastVerifiedAt: true, commerceConnection: { select: { id: true, grantedScopes: true, grantedScopesVerifiedAt: true } } } });
    if (!connectors.length) return new Map<string, { prices: boolean; inventory: boolean; categories: boolean }>();
    const ids = connectors.map((connector: any) => connector.id);
    const permissions = await this.db.connectorDataPermission.findMany({ where: { organizationId, connectorInstanceId: { in: ids }, enabled: true }, select: { connectorInstanceId: true, category: true } });
    const enabled = new Set(permissions.map((permission: any) => `${permission.connectorInstanceId}:${permission.category}`));
    const result = new Map<string, { prices: boolean; inventory: boolean; categories: boolean }>();
    for (const connector of connectors) {
      const caps: string[] = Array.isArray(connector.verifiedCapabilities) ? connector.verifiedCapabilities : [];
      const scopes: string[] = connector.commerceConnection.grantedScopes ?? [];
      const scopeSnapshotFresh = connector.connectorId !== 'shopify_v1' || isShopifyScopeSnapshotFresh(connector.commerceConnection.grantedScopesVerifiedAt ?? connector.lastVerifiedAt);
      const allow = (category: string) => enabled.has(`${connector.id}:${category}`);
      const productProvider = connector.connectorId === 'shopify_v1' ? scopeSnapshotFresh && shopifyScopeAllows(scopes, 'PRODUCTS') && caps.includes('PRODUCT_CATALOG') : caps.includes('PRODUCT_CATALOG');
      if (allow('PRODUCTS') && productProvider) result.set(connector.commerceConnection.id, {
        prices: allow('PRICES') && (connector.connectorId === 'shopify_v1' ? scopeSnapshotFresh && shopifyScopeAllows(scopes, 'PRODUCTS') && caps.includes('PRODUCT_PRICES') : caps.includes('PRODUCT_PRICES')),
        inventory: allow('INVENTORY') && (connector.connectorId === 'shopify_v1' ? scopeSnapshotFresh && shopifyScopeAllows(scopes, 'INVENTORY') && caps.includes('INVENTORY') : caps.includes('INVENTORY')),
        categories: allow('CATEGORIES') && productProvider,
      });
    }
    return result;
  }

  private async businessOrderConnections(organizationId: string) {
    const connectors = await this.db.connectorInstance.findMany({ where: { organizationId, state: 'CONNECTED', integrationConnectionId: { not: null }, verifiedCapabilities: { array_contains: ['ORDERS'] }, commerceConnection: { is: { organizationId, state: { in: ['CONNECTED', 'CONNECTED_WITH_WARNINGS'] } } }, dataPermissions: { some: { category: 'ORDERS', enabled: true } } }, select: { connectorId: true, lastVerifiedAt: true, commerceConnection: { select: { id: true, grantedScopes: true, grantedScopesVerifiedAt: true } } } });
    return connectors.filter((connector: any) => connector.connectorId !== 'shopify_v1' || (isShopifyScopeSnapshotFresh(connector.commerceConnection.grantedScopesVerifiedAt ?? connector.lastVerifiedAt) && shopifyScopeAllows(connector.commerceConnection.grantedScopes, 'ORDERS'))).map((connector: any) => connector.commerceConnection.id);
  }

  async billingAndUsage(userId: string, slug: string) {
    const { organizationId } = await this.workspaces.requireAccess(userId, slug, ['OWNER', 'ADMIN']);
    const periodStart = new Date(); periodStart.setUTCDate(1); periodStart.setUTCHours(0, 0, 0, 0);
    const [subscription, tokenUsage, messages, conversations] = await Promise.all([
      this.db.workspaceSubscription.findFirst({ where: { organizationId }, orderBy: { updatedAt: 'desc' }, select: { state: true, currentPeriodStart: true, currentPeriodEnd: true, plan: { select: { displayName: true, priceMinor: true, currency: true, interval: true, entitlements: true } } } }),
      this.db.playgroundMessage.aggregate({ where: { organizationId, role: 'assistant', createdAt: { gte: periodStart }, inputTokens: { not: null }, outputTokens: { not: null } }, _sum: { inputTokens: true, outputTokens: true }, _count: { _all: true } }),
      this.db.playgroundMessage.count({ where: { organizationId, role: 'assistant', createdAt: { gte: periodStart } } }),
      this.db.playgroundConversation.count({ where: { organizationId, createdAt: { gte: periodStart } } }),
    ]);
    return {
      subscription: subscription ? { state: subscription.state, plan: subscription.plan, currentPeriodStart: subscription.currentPeriodStart, currentPeriodEnd: subscription.currentPeriodEnd } : { state: 'SETUP_REQUIRED', plan: null, currentPeriodStart: null, currentPeriodEnd: null },
      billingProvider: 'NOT_CONFIGURED',
      periodStart: periodStart.toISOString(),
      usage: { assistantMessages: messages, playgroundConversations: conversations, tokenReportedResponses: tokenUsage._count._all, inputTokens: tokenUsage._sum.inputTokens, outputTokens: tokenUsage._sum.outputTokens, tokenAvailability: tokenUsage._count._all ? 'MEASURED_WHERE_PROVIDER_REPORTED' : 'NO_PROVIDER_TOKEN_DATA' },
      note: 'No payment processor is configured. Token totals include only values reported and persisted by providers; this endpoint does not invent or estimate token usage.',
    };
  }
}
