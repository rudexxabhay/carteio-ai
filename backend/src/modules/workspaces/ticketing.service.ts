import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { WorkspaceService } from './workspace.service';

const statuses = ['OPEN', 'ACTIVE', 'PENDING', 'CLOSED'];
const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const transitions: Record<string, string[]> = { OPEN: ['ACTIVE', 'PENDING', 'CLOSED'], ACTIVE: ['PENDING', 'CLOSED'], PENDING: ['ACTIVE', 'CLOSED'], CLOSED: ['OPEN'] };

@Injectable()
export class TicketingService {
  private readonly db: any;
  constructor(prisma: PrismaService, private readonly workspaces: WorkspaceService) { this.db = prisma; }

  private async scope(userId: string, slug: string) {
    const membership = await this.workspaces.requireAccess(userId, slug);
    if (!['OWNER', 'ADMIN'].includes(membership.role)) throw new NotFoundException({ code: 'TICKETS_NOT_FOUND', message: 'Tickets are not available to this workspace role.' });
    return membership;
  }

  async list(userId: string, slug: string, q: any) {
    const { organizationId } = await this.scope(userId, slug);
    const page = Math.max(1, Number(q.page) || 1), pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 25));
    const search = typeof q.search === 'string' ? q.search.trim().slice(0, 120) : '';
    const from = q.from ? new Date(q.from) : undefined, to = q.to ? new Date(q.to) : undefined;
    if (q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) && to) to.setUTCHours(23, 59, 59, 999);
    if (from && Number.isNaN(from.getTime()) || to && Number.isNaN(to.getTime()) || from && to && from > to || from && to && to.getTime() - from.getTime() > 366 * 86400000 || from && from.getTime() < Date.now() - 366 * 86400000 || to && to.getTime() > Date.now() + 86400000) throw new BadRequestException('Ticket date range is invalid or exceeds one year');
    const where: any = { organizationId, expiresAt:{gt:new Date()}, ...(q.status && statuses.includes(q.status) ? { status: q.status } : {}), ...(q.priority && priorities.includes(q.priority) ? { priority: q.priority } : {}), ...(q.category ? { category: { equals: String(q.category).slice(0, 80), mode: 'insensitive' } } : {}), ...(q.assistantId ? { assistantId: q.assistantId } : {}), ...(q.assigneeId ? { assignedToUserId: q.assigneeId === 'UNASSIGNED' ? null : q.assigneeId } : {}), ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}), ...(search ? { OR: [{ reference: { startsWith: search, mode: 'insensitive' } }, { title: { startsWith: search, mode: 'insensitive' } }, { customerReference: { startsWith: search, mode: 'insensitive' } }] } : {}) };
    const [items, total, counts, assistantOptions, assigneeOptions, categoryRows] = await Promise.all([
      this.db.ticket.findMany({ where, orderBy: [{ updatedAt: q.sort === 'oldest' ? 'asc' : 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, reference: true, title: true, category: true, priority: true, status: true, customerReference: true, createdAt: true, expiresAt:true, updatedAt: true, assignedToUserId: true, assistant: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } }, conversation: { select: { channel: true, lastMessageAt: true, lastMessagePreview: true } } } }),
      this.db.ticket.count({ where }),
      Promise.all(statuses.map((status) => this.db.ticket.count({ where: { organizationId, status, expiresAt:{gt:new Date()} } }))),
      this.db.chatbot.findMany({ where: { organizationId, archivedAt: null }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 100, select: { id: true, name: true } }),
      this.db.organizationMembership.findMany({ where: { organizationId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }], take: 100, select: { userId: true, role: true, user: { select: { name: true } } } }),
      this.db.ticket.findMany({ where: { organizationId, expiresAt:{gt:new Date()} }, distinct: ['category'], orderBy: { category: 'asc' }, take: 100, select: { category: true } }),
    ]);
    return { items, page, pageSize, total, summary: { total: counts.reduce((sum: number, n: number) => sum + n, 0), OPEN: counts[0], ACTIVE: counts[1], PENDING: counts[2], CLOSED: counts[3] }, assistantOptions, assigneeOptions: assigneeOptions.map((m: any) => ({ userId: m.userId, role: m.role, name: m.user.name })), categoryOptions: categoryRows.map((x: any) => x.category) };
  }

  async detail(userId: string, slug: string, id: string, page = 1, pageSize = 50) {
    const { organizationId } = await this.scope(userId, slug);
    const ticket = await this.db.ticket.findFirst({ where: { organizationId, expiresAt:{gt:new Date()}, OR: [{ id }, { reference: id }] }, select: { id: true, reference: true, title: true, description: true, category: true, priority: true, status: true, customerReference: true, resolutionRemarks: true, version: true, createdAt: true, expiresAt:true, updatedAt: true, assistant: { select: { id: true, name: true } }, assignee: { select: { id: true, name: true } }, conversation: { select: { id: true, channel: true, externalSessionHash: true, lastMessageAt: true } } } });
    if (!ticket) throw new NotFoundException({ code: 'TICKET_NOT_FOUND', message: 'Ticket not found.' });
    const take = Math.min(100, Math.max(1, pageSize));
    const [messages, messageTotal, notes, events, members] = await Promise.all([
      this.db.supportMessage.findMany({ where: { organizationId, conversationId: ticket.conversation.id, OR:[{ticketId:null},{ticket:{is:{expiresAt:{gt:new Date()}}}}], kind: { in: ['CUSTOMER', 'AI', 'BUSINESS_TEAM','SYSTEM'] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (Math.max(1, page) - 1) * take, take, select: { id: true, kind: true, content: true, createdAt: true, author: { select: { id: true, name: true } }, outboundDelivery: { select: { state: true, attemptCount: true, lastErrorCode: true } } } }),
      this.db.supportMessage.count({ where: { organizationId, conversationId: ticket.conversation.id, OR:[{ticketId:null},{ticket:{is:{expiresAt:{gt:new Date()}}}}], kind: { in: ['CUSTOMER', 'AI', 'BUSINESS_TEAM','SYSTEM'] } } }),
      this.db.ticketInternalNote.findMany({ where: { organizationId, ticketId: ticket.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50, select: { id: true, content: true, createdAt: true, author: { select: { id: true, name: true } } } }),
      this.db.ticketEvent.findMany({ where: { organizationId, ticketId: ticket.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100, select: { id: true, eventType: true, fromValue: true, toValue: true, metadata: true, createdAt: true, actor: { select: { id: true, name: true } } } }),
      this.db.organizationMembership.findMany({ where: { organizationId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } }, take: 100, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }], select: { userId: true, role: true, user: { select: { name: true } } } }),
    ]);
    const { externalSessionHash, ...conversation } = ticket.conversation;
    return { ...ticket, conversation, customerReference: externalSessionHash ? `Visitor ${externalSessionHash.slice(0, 6)}` : ticket.customerReference, messages: messages.reverse(), messagePage: page, messagePageSize: take, messageTotal, hasOlderMessages: page * take < messageTotal, notes: notes.reverse(), events: events.reverse(), members };
  }

  async update(userId: string, slug: string, id: string, input: { status?: string; priority?: string; resolutionRemarks?: string }) {
    const { organizationId } = await this.scope(userId, slug);
    if (input.status === undefined && input.priority === undefined && input.resolutionRemarks === undefined) throw new BadRequestException('Provide a ticket field to update');
    if (input.status && !statuses.includes(input.status)) throw new BadRequestException('Invalid ticket status');
    if (input.priority && !priorities.includes(input.priority)) throw new BadRequestException('Invalid ticket priority');
    const current = await this.db.ticket.findFirst({ where: { organizationId, id, expiresAt:{gt:new Date()} }, select: { id: true, status: true, priority: true, version: true, assistantId:true, conversationId:true } });
    if (!current) throw new NotFoundException('Ticket not found');
    if (input.status && input.status !== current.status && !(transitions[current.status] ?? []).includes(input.status)) throw new ConflictException('Invalid ticket status transition');
    const changed = await this.db.$transaction(async (tx: any) => {
      const data: any = { version: { increment: 1 }, ...(input.status ? { status: input.status } : {}), ...(input.priority ? { priority: input.priority } : {}), ...(input.resolutionRemarks !== undefined ? { resolutionRemarks: input.resolutionRemarks.slice(0, 2000) } : {}) };
      const count = await tx.ticket.updateMany({ where: { id, organizationId, version: current.version, expiresAt:{gt:new Date()} }, data });
      if (count.count !== 1) throw new ConflictException('Ticket changed. Refresh and try again.');
      for (const [field, value] of Object.entries({ status: input.status, priority: input.priority })) if (value && value !== (current as any)[field]) {
        const event=await tx.ticketEvent.create({ data: { organizationId, ticketId: id, actorUserId: userId, eventType: `${field.toUpperCase()}_CHANGED`, fromValue: (current as any)[field], toValue: value } });
        if(field==='status') { const content=`Ticket status updated: ${value}.`; const messageId=randomUUID(); await tx.supportMessage.create({data:{id:messageId,organizationId,conversationId:current.conversationId,ticketId:id,kind:'SYSTEM',content,idempotencyKey:`ticket-status:${event.id}`}}); await tx.$executeRaw`UPDATE "SupportConversation" SET "lastMessageAt" = GREATEST(COALESCE("lastMessageAt", ${event.createdAt}), ${event.createdAt}), "lastMessagePreview" = CASE WHEN COALESCE("lastMessageAt", ${event.createdAt}) <= ${event.createdAt} THEN ${content} ELSE "lastMessagePreview" END, "messageCount" = "messageCount" + 1 WHERE "id" = ${current.conversationId}::uuid AND "organizationId" = ${organizationId}::uuid`; }
      }
      await tx.auditEvent.create({ data: { organizationId, actorUserId: userId, action: 'ticket.updated', entityType: 'ticket', entityId: id, metadata: { ...(input.status ? { status: input.status } : {}), ...(input.priority ? { priority: input.priority } : {}), ...(input.resolutionRemarks !== undefined ? { resolutionRemarksChanged: true } : {}) } } });
      return tx.ticket.findFirst({ where: { id, organizationId }, select: { id: true, status: true, priority: true, version: true, updatedAt: true } });
    });
    return changed;
  }

  async assign(userId: string, slug: string, id: string, assigneeUserId: string | null) {
    const { organizationId } = await this.scope(userId, slug);
    const current = await this.db.ticket.findFirst({ where: { id, organizationId, expiresAt:{gt:new Date()} }, select: { id: true, assignedToUserId: true } });
    if (!current) throw new NotFoundException('Ticket not found');
    if (assigneeUserId && !await this.db.organizationMembership.findFirst({ where: { organizationId, userId: assigneeUserId, status: 'ACTIVE', role: { in: ['OWNER', 'ADMIN'] } }, select: { id: true } })) throw new BadRequestException('Assignee must be an active workspace owner or admin');
    if (current.assignedToUserId === assigneeUserId) return { id, assignedToUserId: assigneeUserId, idempotent: true };
    return this.db.$transaction(async (tx: any) => {
      const result = await tx.ticket.updateMany({ where: { id, organizationId, assignedToUserId: current.assignedToUserId, expiresAt:{gt:new Date()} }, data: { assignedToUserId: assigneeUserId, version: { increment: 1 } } });
      if (!result.count) throw new ConflictException('Ticket assignment changed. Refresh and try again.');
      await tx.ticketEvent.create({ data: { organizationId, ticketId: id, actorUserId: userId, eventType: 'ASSIGNED', fromValue: current.assignedToUserId, toValue: assigneeUserId } });
      await tx.auditEvent.create({ data: { organizationId, actorUserId: userId, action: 'ticket.assignment_changed', entityType: 'ticket', entityId: id, metadata: { from: current.assignedToUserId, to: assigneeUserId } } });
      return { id, assignedToUserId: assigneeUserId };
    });
  }

  async addNote(userId: string, slug: string, id: string, content: string) {
    const { organizationId } = await this.scope(userId, slug);
    if (!content.trim() || content.length > 4000) throw new BadRequestException('Note must be 1–4000 characters');
    if (!await this.db.ticket.findFirst({ where: { id, organizationId, expiresAt:{gt:new Date()} }, select: { id: true } })) throw new NotFoundException('Ticket not found');
    const note = await this.db.$transaction(async (tx: any) => {
      const eligible=await tx.$queryRaw<Array<{id:string}>>`SELECT "id" FROM "Ticket" WHERE "id"=${id}::uuid AND "organizationId"=${organizationId}::uuid AND "expiresAt">${new Date()} FOR UPDATE`;
      if(!eligible.length) throw new NotFoundException('Ticket not found');
      const created = await tx.ticketInternalNote.create({ data: { organizationId, ticketId: id, authorUserId: userId, content: content.trim() }, select: { id: true, content: true, createdAt: true, author: { select: { id: true, name: true } } } });
      await tx.ticketEvent.create({ data: { organizationId, ticketId: id, actorUserId: userId, eventType: 'INTERNAL_NOTE_ADDED', metadata: { noteId: created.id } } });
      await tx.auditEvent.create({ data: { organizationId, actorUserId: userId, action: 'ticket.internal_note_added', entityType: 'ticket', entityId: id, metadata: { noteId: created.id } } });
      return created;
    });
    return note;
  }

  async reply(userId: string, slug: string, id: string, input: { content: string; idempotencyKey: string }) {
    const { organizationId } = await this.scope(userId, slug);
    const content = input.content.trim();
    if (!content || content.length > 8000 || !/^[A-Za-z0-9._:-]{8,160}$/.test(input.idempotencyKey)) throw new BadRequestException('Message or idempotency key is invalid');
    const now = new Date(), minute = new Date(Math.floor(now.getTime() / 60000) * 60000), scopeKey = `ticket:${organizationId}:${userId}`.slice(0, 160);
    const rate = await this.db.$queryRaw<Array<{ requestCount: number }>>`INSERT INTO "PlaygroundRateLimit" ("scopeKey", "windowStartedAt", "requestCount", "updatedAt") VALUES (${scopeKey}, ${minute}, 1, ${now}) ON CONFLICT ("scopeKey") DO UPDATE SET "windowStartedAt" = CASE WHEN "PlaygroundRateLimit"."windowStartedAt" < ${minute} THEN ${minute} ELSE "PlaygroundRateLimit"."windowStartedAt" END, "requestCount" = CASE WHEN "PlaygroundRateLimit"."windowStartedAt" < ${minute} THEN 1 ELSE LEAST("PlaygroundRateLimit"."requestCount" + 1, 41) END, "updatedAt" = ${now} RETURNING "requestCount"`;
    if ((rate[0]?.requestCount ?? 0) > 40) throw new HttpException('Ticket message rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    const ticket = await this.db.ticket.findFirst({ where: { id, organizationId, expiresAt:{gt:new Date()} }, select: { id: true, conversationId: true, assistantId: true, status: true, expiresAt:true, conversation: { select: { channel: true } } } });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.status === 'CLOSED') throw new ConflictException('Reopen the ticket before sending a customer message.');
    const existing = await this.db.supportMessage.findFirst({ where: { organizationId, conversationId: ticket.conversationId, idempotencyKey: input.idempotencyKey }, select: { id: true, content: true, createdAt: true, outboundDelivery: { select: { state: true } } } });
    if (existing) {
      if (existing.content !== content) throw new ConflictException('This idempotency key was already used for a different message');
      return { ...existing, kind: 'BUSINESS_TEAM', deliveryState: existing.outboundDelivery?.state ?? 'QUEUED', idempotent: true };
    }
    const created = await this.db.$transaction(async (tx: any) => {
      const locked = await tx.$queryRaw<Array<{ status: string; expiresAt:Date }>>`SELECT "status"::text AS "status", "expiresAt" FROM "Ticket" WHERE "id" = ${ticket.id}::uuid AND "organizationId" = ${organizationId}::uuid FOR UPDATE`;
      if (!locked[0] || locked[0].expiresAt<=new Date()) throw new NotFoundException('Ticket expired.');
      if (locked[0].status === 'CLOSED') throw new ConflictException('Reopen the ticket before sending a customer message.');
      const messageId = randomUUID();
      const inserted = await tx.supportMessage.createMany({ data: [{ id: messageId, organizationId, conversationId: ticket.conversationId, ticketId:ticket.id, authorUserId: userId, kind: 'BUSINESS_TEAM', content, idempotencyKey: input.idempotencyKey }], skipDuplicates: true });
      if (!inserted.count) return null;
      const message = await tx.supportMessage.findFirst({ where: { id: messageId, organizationId }, select: { id: true, content: true, createdAt: true } });
      if (!message) throw new ConflictException('Persisted ticket message could not be retrieved');
      await tx.outboundDelivery.create({ data: { organizationId, ticketId: ticket.id, conversationId: ticket.conversationId, messageId: message.id, channel: ticket.conversation.channel, state: 'QUEUED' } });
      await tx.$executeRaw`UPDATE "SupportConversation" SET "lastMessageAt" = GREATEST(COALESCE("lastMessageAt", ${message.createdAt}), ${message.createdAt}), "lastMessagePreview" = CASE WHEN COALESCE("lastMessageAt", ${message.createdAt}) <= ${message.createdAt} THEN ${content.slice(0, 500)} ELSE "lastMessagePreview" END, "messageCount" = "messageCount" + 1 WHERE "id" = ${ticket.conversationId}::uuid AND "organizationId" = ${organizationId}::uuid`;
      await tx.ticketEvent.create({ data: { organizationId, ticketId: ticket.id, actorUserId: userId, eventType: 'BUSINESS_MESSAGE_CREATED', metadata: { messageId: message.id } } });
      await tx.auditEvent.create({ data: { organizationId, actorUserId: userId, action: 'ticket.customer_message_created', entityType: 'ticket', entityId: ticket.id, metadata: { messageId: message.id, channel: ticket.conversation.channel } } });
      return message;
    }, { isolationLevel: 'Serializable' });
    if (!created) {
      const duplicate = await this.db.supportMessage.findFirst({ where: { organizationId, conversationId: ticket.conversationId, idempotencyKey: input.idempotencyKey }, select: { id: true, content: true, createdAt: true, outboundDelivery: { select: { state: true } } } });
      if (!duplicate || duplicate.content !== content) throw new ConflictException('This idempotency key was already used for a different message');
      return { ...duplicate, kind: 'BUSINESS_TEAM', deliveryState: duplicate.outboundDelivery?.state ?? 'QUEUED', idempotent: true };
    }
    return { ...created, kind: 'BUSINESS_TEAM', deliveryState: 'QUEUED', idempotent: false };
  }

  /** Trusted connected channel adapters only. There is deliberately no public delivery callback route. */
  async recordDeliveryOutcome(input: { organizationId: string; ticketId: string; messageId: string; state: 'SENT' | 'DELIVERED' | 'FAILED'; eventId: string; detailCode?: string }) {
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(input.eventId)) throw new BadRequestException('Invalid trusted transport event id');
    const repeated = await this.db.outboundDeliveryAttempt.findFirst({ where: { transportEventId: input.eventId }, select: { id: true, delivery: { select: { ticketId: true, messageId: true } }, state: true } });
    if (repeated) { if (repeated.delivery.ticketId !== input.ticketId || repeated.delivery.messageId !== input.messageId) throw new ConflictException('Transport event id was already consumed'); return { state: repeated.state, idempotent: true }; }
    const row = await this.db.outboundDelivery.findFirst({ where: { organizationId: input.organizationId, ticketId: input.ticketId, messageId: input.messageId }, select: { id: true, state: true, attemptCount: true } });
    if (!row) throw new NotFoundException('Outbound delivery not found');
    if (row.state === 'DELIVERED') return { state: row.state, idempotent: true };
    const state = input.state === 'DELIVERED' ? 'DELIVERED' : input.state === 'SENT' ? 'SENT' : 'FAILED';
    await this.db.$transaction(async (tx: any) => {
      const nextAttemptNumber = row.attemptCount + 1;
      const delayMs = Math.min(30 * 60_000, 30_000 * (2 ** Math.max(0, nextAttemptNumber - 1)));
      const retryable = state === 'FAILED' && nextAttemptNumber < 5;
      const completedAt = new Date();
      const changed = await tx.outboundDelivery.updateMany({ where: { id: row.id, organizationId: input.organizationId, attemptCount: row.attemptCount, state: { not: 'DELIVERED' } }, data: { state, attemptCount: nextAttemptNumber, nextAttemptAt: retryable ? new Date(completedAt.getTime() + delayMs) : null, permanentFailure: state === 'FAILED' && !retryable, ...(state === 'DELIVERED' ? { leaseToken: null, leaseUntil: null } : {}), sentAt: state === 'SENT' ? completedAt : undefined, deliveredAt: state === 'DELIVERED' ? completedAt : undefined, failedAt: state === 'FAILED' ? completedAt : undefined, lastErrorCode: state === 'FAILED' ? input.detailCode?.slice(0, 80) : null } });
      if (!changed.count) return;
      const attempt = await tx.outboundDeliveryAttempt.updateMany({ where: { organizationId: input.organizationId, deliveryId: row.id, attemptNumber: nextAttemptNumber, state: 'PROCESSING' }, data: { state, transportEventId: input.eventId, detailCode: input.detailCode?.slice(0, 80) ?? null, retryable, completedAt } });
      if (!attempt.count) await tx.outboundDeliveryAttempt.create({ data: { organizationId: input.organizationId, deliveryId: row.id, attemptNumber: nextAttemptNumber, state, transportEventId: input.eventId, detailCode: input.detailCode?.slice(0, 80) ?? null, retryable, completedAt } });
      await tx.ticketEvent.create({ data: { organizationId: input.organizationId, ticketId: input.ticketId, eventType: `DELIVERY_${state}`, metadata: { messageId: input.messageId, eventId: input.eventId, detailCode: input.detailCode?.slice(0, 80) } } });
    });
    return { state, idempotent: false };
  }

  /** Trusted assistant interpretation hook. A normal acknowledgement cannot confirm: callers must pass explicit confirmation of this exact live draft id. */
  async createOrUpdateDraft(input: { organizationId: string; assistantId: string; conversationId: string; visitorSessionId: string; idempotencyKey: string; title?: string; description?: string; category?: string; priority?: string }) {
    if (!input.visitorSessionId || !input.idempotencyKey || !input.conversationId) throw new BadRequestException('A trusted customer session and idempotency key are required');
    const sessionHash = createHash('sha256').update(input.visitorSessionId).digest('hex');
    const assistant = await this.db.chatbot.findFirst({ where: { id: input.assistantId, organizationId: input.organizationId, status: 'ACTIVE', archivedAt: null }, select: { id: true } });
    if (!assistant) throw new NotFoundException('Active assistant not found');
    const conversation = await this.db.supportConversation.findFirst({ where: { id: input.conversationId, organizationId: input.organizationId, assistantId: input.assistantId, externalSessionHash: sessionHash }, select: { id: true } });
    if (!conversation) throw new NotFoundException('Authorized customer conversation not found');
    const values: any = { title: input.title?.trim().slice(0, 180) || null, description: input.description?.trim().slice(0, 8000) || null, category: input.category?.trim().slice(0, 80) || null, priority: priorities.includes(input.priority ?? '') ? input.priority : 'MEDIUM' };
    const complete = Boolean(values.title && values.description && values.category);
    const existing = await this.db.ticketDraft.findFirst({ where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey }, select: { id: true, state: true, version: true, assistantId: true, conversationId: true, externalSessionHash: true, expiresAt: true, title: true, description: true, category: true, priority: true } });
    if (existing) {
      if (existing.assistantId !== input.assistantId || existing.conversationId !== conversation.id || existing.externalSessionHash !== sessionHash) throw new ConflictException('Draft idempotency key belongs to another customer session');
      if (existing.expiresAt <= new Date() && existing.state !== 'CONFIRMED') { await this.db.ticketDraft.update({ where: { id: existing.id }, data: { state: 'EXPIRED' } }); throw new ConflictException('Ticket draft expired'); }
      if (existing.state === 'CONFIRMED' || existing.state === 'CANCELLED') return { id: existing.id, state: existing.state, idempotent: true };
      const merged = { title: values.title ?? existing.title, description: values.description ?? existing.description, category: values.category ?? existing.category, priority: input.priority && priorities.includes(input.priority) ? input.priority : existing.priority };
      const mergedComplete = Boolean(merged.title && merged.description && merged.category);
      return this.db.ticketDraft.update({ where: { id: existing.id }, data: { ...merged, version: { increment: 1 }, state: mergedComplete ? 'AWAITING_CONFIRMATION' : 'COLLECTING' }, select: { id: true, state: true, version: true, title: true, description: true, category: true, priority: true, expiresAt: true } });
    }
    return this.db.ticketDraft.create({ data: { organizationId: input.organizationId, assistantId: input.assistantId, conversationId: conversation.id, externalSessionHash: sessionHash, idempotencyKey: input.idempotencyKey, ...values, state: complete ? 'AWAITING_CONFIRMATION' : 'COLLECTING', expiresAt: new Date(Date.now() + 30 * 60_000) }, select: { id: true, state: true, version: true, title: true, description: true, category: true, priority: true, expiresAt: true } });
  }

  async confirmDraft(input: { organizationId: string; assistantId: string; conversationId: string; visitorSessionId: string; draftId: string; expectedVersion: number; confirmationAction: 'CONFIRM_TICKET_DRAFT';  }) {
    if (input.confirmationAction !== 'CONFIRM_TICKET_DRAFT' || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) throw new BadRequestException('A typed confirmation for the displayed ticket draft is required');
    const hash = createHash('sha256').update(input.visitorSessionId).digest('hex');
    return this.db.$transaction(async (tx: any) => {
      const draft = await tx.ticketDraft.findFirst({ where: { id: input.draftId, organizationId: input.organizationId, assistantId: input.assistantId, conversationId: input.conversationId, externalSessionHash: hash }, select: { id: true, version: true, state: true, title: true, description: true, category: true, priority: true, expiresAt: true, ticketId: true } });
      if (!draft) throw new NotFoundException('Ticket draft not found');
      if (draft.state === 'CONFIRMED' && draft.ticketId) { const confirmed=await tx.ticket.findFirst({ where: { id: draft.ticketId, organizationId: input.organizationId, expiresAt:{gt:new Date()} }, select: { id: true, reference: true, status: true, createdAt:true, expiresAt:true } }); if(!confirmed) throw new NotFoundException('Ticket has expired.'); return confirmed; }
      if (draft.version !== input.expectedVersion) throw new ConflictException('Ticket draft changed after confirmation was requested');
      if (draft.expiresAt <= new Date()) { await tx.ticketDraft.update({ where: { id: draft.id }, data: { state: 'EXPIRED' } }); throw new ConflictException('Ticket draft expired'); }
      if (draft.state !== 'AWAITING_CONFIRMATION' || !draft.title || !draft.description || !draft.category) throw new ConflictException('Ticket draft is not ready for confirmation');
      const claimed = await tx.ticketDraft.updateMany({ where: { id: draft.id, organizationId: input.organizationId, version: input.expectedVersion, state: 'AWAITING_CONFIRMATION', expiresAt: { gt: new Date() } }, data: { state: 'CONFIRMED' } });
      if (claimed.count !== 1) {
        const replay = await tx.ticketDraft.findFirst({ where: { id: draft.id, organizationId: input.organizationId }, select: { state: true, ticketId: true } });
        if (replay?.state === 'CONFIRMED' && replay.ticketId) { const confirmed=await tx.ticket.findFirst({ where: { id: replay.ticketId, organizationId: input.organizationId, expiresAt:{gt:new Date()} }, select: { id: true, reference: true, status: true, createdAt:true, expiresAt:true } }); if(!confirmed) throw new NotFoundException('Ticket has expired.'); return confirmed; }
        throw new ConflictException('Ticket draft changed before confirmation');
      }
      const conversations = await tx.$queryRaw<Array<{id:string;channel:string}>>`SELECT "id", "channel" FROM "SupportConversation" WHERE "id"=${input.conversationId}::uuid AND "organizationId"=${input.organizationId}::uuid AND "assistantId"=${input.assistantId}::uuid AND "externalSessionHash"=${hash} FOR UPDATE`;
      const conversation=conversations[0];
      if (!conversation || conversation.channel!=='WEB_WIDGET') throw new NotFoundException('Customer conversation not found');
      const reference = `TKT-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
      const createdAt=new Date();
      const ticket = await tx.ticket.create({ data: { organizationId: input.organizationId, assistantId: input.assistantId, conversationId: conversation.id, reference, title: draft.title, description: draft.description, category: draft.category, priority: draft.priority, status: 'OPEN', customerReference: `Visitor ${hash.slice(0, 6)}`, createdAt, expiresAt:new Date(createdAt.getTime()+72*60*60_000) } });
      await tx.ticketEvent.create({ data: { organizationId: input.organizationId, ticketId: ticket.id, eventType: 'CREATED', toValue: 'OPEN', metadata: { source: 'AI_CONVERSATION', draftId: draft.id } } });
      await tx.auditEvent.create({ data: { organizationId: input.organizationId, action: 'ticket.created_from_ai_conversation', entityType: 'ticket', entityId: ticket.id, metadata: { reference: ticket.reference, assistantId: input.assistantId, conversationId: input.conversationId } } });
      await tx.ticketDraft.update({ where: { id: draft.id }, data: { ticketId: ticket.id } });
      return { id: ticket.id, reference: ticket.reference, status: ticket.status, createdAt: ticket.createdAt, expiresAt: ticket.expiresAt };
    }, { isolationLevel: 'Serializable' });
  }

  async cancelDraft(input: { organizationId: string; assistantId: string; conversationId: string; visitorSessionId: string; draftId: string }) {
    const hash = createHash('sha256').update(input.visitorSessionId).digest('hex');
    const result = await this.db.ticketDraft.updateMany({ where: { id: input.draftId, organizationId: input.organizationId, assistantId: input.assistantId, conversationId: input.conversationId, externalSessionHash: hash, state: { in: ['COLLECTING', 'AWAITING_CONFIRMATION'] }, expiresAt: { gt: new Date() } }, data: { state: 'CANCELLED' } });
    if (result.count === 1) return { cancelled: true, idempotent: false };
    const replay = await this.db.ticketDraft.findFirst({ where: { id: input.draftId, organizationId: input.organizationId, assistantId: input.assistantId, conversationId: input.conversationId, externalSessionHash: hash, state: 'CANCELLED' }, select: { id: true } });
    return { cancelled: Boolean(replay), idempotent: Boolean(replay) };
  }

  /** Internal hook for the existing customer AI interpretation result; never exposed as a customer API. */
  async handleInterpretedCustomerTurn(input: {
    organizationId: string; assistantId: string; conversationId: string; visitorSessionId: string;
    interpretation: { ticketRequest: 'EXPLICIT' | 'NONE'; draftAction: 'COLLECT' | 'CONFIRM' | 'CANCEL' | 'NONE'; title?: string; description?: string; category?: string; priority?: string };
    idempotencyKey: string;
  }) {
    if (!input.interpretation || !['EXPLICIT', 'NONE'].includes(input.interpretation.ticketRequest) || !['COLLECT', 'CONFIRM', 'CANCEL', 'NONE'].includes(input.interpretation.draftAction)) throw new BadRequestException('Ticket interpretation is invalid');
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(input.idempotencyKey)) throw new BadRequestException('Customer turn idempotency key is invalid');
    const hash = createHash('sha256').update(input.visitorSessionId).digest('hex');
    const assistant = await this.db.chatbot.findFirst({ where: { id: input.assistantId, organizationId: input.organizationId, status: 'ACTIVE', archivedAt: null }, select: { id: true } });
    if (!assistant) throw new NotFoundException('Active assistant not found');
    const conversation = await this.db.supportConversation.findFirst({ where: { id: input.conversationId, organizationId: input.organizationId, assistantId: input.assistantId, externalSessionHash: hash }, select: { id: true } });
    if (!conversation) throw new NotFoundException('Authorized customer conversation not found');
    let active = await this.db.ticketDraft.findFirst({ where: { organizationId: input.organizationId, assistantId: input.assistantId, conversationId: input.conversationId, externalSessionHash: hash, state: { in: ['COLLECTING', 'AWAITING_CONFIRMATION'] } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], select: { id: true, version: true, idempotencyKey: true, state: true, title: true, description: true, category: true, priority: true, expiresAt: true } });
    if (active && active.expiresAt <= new Date()) {
      await this.db.ticketDraft.updateMany({ where: { id: active.id, organizationId: input.organizationId, state: { in: ['COLLECTING', 'AWAITING_CONFIRMATION'] } }, data: { state: 'EXPIRED' } });
      active = null;
    }
    const signal = input.interpretation;
    if (signal.ticketRequest !== 'EXPLICIT' && signal.draftAction === 'NONE') return { action: 'NORMAL_AI_RESPONSE' as const };
    if (signal.draftAction === 'CANCEL' && active) {
      await this.cancelDraft({ ...input, draftId: active.id });
      return { action: 'DRAFT_CANCELLED' as const };
    }
    // A model interpretation is advisory. Only the trusted channel's typed
    // confirmation action may call confirmDraft; a semantic "CONFIRM" never does.
    if (signal.draftAction === 'CONFIRM' && active?.state === 'AWAITING_CONFIRMATION') return { action: 'CONFIRMATION_REQUIRED' as const, draft: { id: active.id, state: active.state, version: active.version, title: active.title, description: active.description, category: active.category, priority: active.priority, expiresAt: active.expiresAt } };
    if (signal.ticketRequest !== 'EXPLICIT' && !active) return { action: 'NORMAL_AI_RESPONSE' as const };
    const draft = await this.createOrUpdateDraft({
      organizationId: input.organizationId, assistantId: input.assistantId, conversationId: input.conversationId,
      visitorSessionId: input.visitorSessionId, idempotencyKey: active?.idempotencyKey ?? `ticket-draft:${createHash('sha256').update(`${input.conversationId}:${input.idempotencyKey}`).digest('hex')}`,
      title: signal.title, description: signal.description, category: signal.category, priority: signal.priority,
    });
    const missing = [!draft.title && 'title', !draft.description && 'description', !draft.category && 'category'].filter(Boolean);
    return { action: draft.state === 'AWAITING_CONFIRMATION' ? 'CONFIRMATION_REQUIRED' as const : 'COLLECT_REQUIRED_DETAILS' as const, draft, missing };
  }

  /** Called only by a trusted channel adapter after validating a customer-origin typed action. */
  async confirmCustomerDraft(input: { organizationId: string; assistantId: string; conversationId: string; visitorSessionId: string; draftId: string; version: number; action: 'CONFIRM_TICKET_DRAFT' }) {
    return this.confirmDraft({ ...input, expectedVersion: input.version, confirmationAction: input.action });
  }

  async lookupForCustomer(input: { organizationId: string; assistantId: string; conversationId:string; visitorSessionId: string; reference: string }) {
    if (input.visitorSessionId.length < 32 || input.visitorSessionId.length > 128 || !/^TKT-[A-F0-9]{10}$/.test(input.reference.toUpperCase())) throw new NotFoundException('Ticket not found for this customer session');
    const hash = createHash('sha256').update(input.visitorSessionId).digest('hex');
    const ticket = await this.db.ticket.findFirst({ where: { organizationId: input.organizationId, assistantId: input.assistantId, conversationId:input.conversationId, reference: input.reference.toUpperCase(), expiresAt:{gt:new Date()}, conversation: { is: { id:input.conversationId, organizationId:input.organizationId, assistantId:input.assistantId, externalSessionHash: hash, channel:'WEB_WIDGET' } } }, select: { reference: true, status: true, title: true, createdAt:true, expiresAt:true, updatedAt: true, events:{where:{eventType:'STATUS_CHANGED'},orderBy:[{createdAt:'asc'},{id:'asc'}],take:30,select:{fromValue:true,toValue:true,createdAt:true}} } });
    if (!ticket) throw new NotFoundException('Ticket not found for this customer session');
    return { reference: ticket.reference, status: ticket.status, title: ticket.title, createdAt:ticket.createdAt, expiresAt:ticket.expiresAt, updatedAt: ticket.updatedAt, timeline:ticket.events.map((event:any)=>({from:event.fromValue,to:event.toValue,createdAt:event.createdAt})) };
  }
}
