import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TicketingService } from './ticketing.service';

describe('TicketingService', () => {
  const org = '10000000-0000-4000-8000-000000000001';
  const conversationId = '20000000-0000-4000-8000-000000000002';
  const draftId = '30000000-0000-4000-8000-000000000003';
  let db: any;
  let service: TicketingService;
  let workspaces: any;
  let delivery: any;

  beforeEach(() => {
    workspaces = { requireAccess: jest.fn().mockResolvedValue({ organizationId: org, role: 'OWNER' }) };
    delivery = { deliver: jest.fn().mockResolvedValue({ state: 'UNSUPPORTED_CHANNEL', detailCode: 'NO_TRANSPORT' }) };
    db = {
      ticket: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), create: jest.fn() },
      supportConversation: { findFirst: jest.fn(), update: jest.fn() },
      supportMessage: { findFirst: jest.fn(), create: jest.fn(), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      outboundDelivery: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() }, outboundDeliveryAttempt: { create: jest.fn(), findFirst: jest.fn() },
      ticketEvent: { create: jest.fn(), findMany: jest.fn() }, ticketInternalNote: { create: jest.fn(), findMany: jest.fn() },
      organizationMembership: { findMany: jest.fn(), findFirst: jest.fn() }, chatbot: { findMany: jest.fn(), findFirst: jest.fn().mockResolvedValue({ id: 'assistant' }) }, auditEvent: { create: jest.fn() },
      ticketDraft: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn(async (callback: any) => callback(db)),
      $queryRaw: jest.fn().mockResolvedValue([{ requestCount: 1 }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    service = new TicketingService(db, workspaces);
  });

  it('requires a workspace manager and scopes ticket listing to that organization', async () => {
    db.ticket.findMany.mockResolvedValue([]); db.ticket.count.mockResolvedValue(0); db.chatbot.findMany.mockResolvedValue([]); db.organizationMembership.findMany.mockResolvedValue([]);
    await service.list('user', 'slug', { page: 1, pageSize: 25 });
    expect(db.ticket.findMany.mock.calls[0][0].where.organizationId).toBe(org);
    workspaces.requireAccess.mockResolvedValueOnce({ organizationId: org, role: 'MEMBER' });
    await expect(service.list('member', 'slug', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('binds drafts to a hashed visitor session and conversation ownership', async () => {
    db.supportConversation.findFirst.mockResolvedValue({ id: conversationId });
    db.ticketDraft.findFirst.mockResolvedValue(null);
    db.ticketDraft.create.mockImplementation(({ data }: any) => data);
    const draft = await service.createOrUpdateDraft({ organizationId: org, assistantId: 'assistant', conversationId, visitorSessionId: 'a-secure-session-token-long-enough-123456', idempotencyKey: 'ticket-draft-key-0001', title: 'Refund', description: 'Refund was delayed', category: 'BILLING' });
    expect(db.supportConversation.findFirst.mock.calls[0][0].where.externalSessionHash).not.toBe('a-secure-session-token-long-enough-123456');
    expect(draft.state).toBe('AWAITING_CONFIRMATION');
  });

  it('rejects generic acknowledgements and expires stale ticket drafts', async () => {
    await expect(service.confirmDraft({ organizationId: org, assistantId: 'assistant', conversationId, visitorSessionId: 'session', draftId, expectedVersion: 1, confirmationAction: 'INVALID' as any })).rejects.toBeInstanceOf(BadRequestException);
    const stale = { id: draftId, version: 1, state: 'AWAITING_CONFIRMATION', expiresAt: new Date(Date.now() - 1000) };
    db.ticketDraft.findFirst.mockResolvedValue(stale);
    await expect(service.confirmDraft({ organizationId: org, assistantId: 'assistant', conversationId, visitorSessionId: 'session', draftId, expectedVersion: 1, confirmationAction: 'CONFIRM_TICKET_DRAFT' })).rejects.toBeInstanceOf(ConflictException);
    expect(db.ticketDraft.update).toHaveBeenCalledWith({ where: { id: draftId }, data: { state: 'EXPIRED' } });
  });

  it('routes only explicit ticket intent into a bounded draft and leaves normal AI turns alone', async () => {
    db.chatbot.findFirst.mockResolvedValue({ id: 'assistant' });
    db.supportConversation.findFirst.mockResolvedValue({ id: conversationId });
    db.ticketDraft.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    db.ticketDraft.create.mockImplementation(({ data }: any) => ({ id: draftId, ...data }));
    const normal = await service.handleInterpretedCustomerTurn({ organizationId: org, assistantId: 'assistant', conversationId, visitorSessionId: 'a-secure-session-token-long-enough-123456', idempotencyKey: 'message-turn-key-0001', interpretation: { ticketRequest: 'NONE', draftAction: 'NONE' } });
    expect(normal.action).toBe('NORMAL_AI_RESPONSE');
    const draft = await service.handleInterpretedCustomerTurn({ organizationId: org, assistantId: 'assistant', conversationId, visitorSessionId: 'a-secure-session-token-long-enough-123456', idempotencyKey: 'message-turn-key-0002', interpretation: { ticketRequest: 'EXPLICIT', draftAction: 'COLLECT', title: 'Refund delay', description: 'Refund has not arrived', category: 'BILLING' } });
    expect(draft.action).toBe('CONFIRMATION_REQUIRED');
    expect(db.ticketDraft.create.mock.calls[0][0].data.state).toBe('AWAITING_CONFIRMATION');
  });

  it('never creates a ticket from a model-only CONFIRM interpretation', async () => {
    db.chatbot.findFirst.mockResolvedValue({ id: 'assistant' });
    db.supportConversation.findFirst.mockResolvedValue({ id: conversationId });
    db.ticketDraft.findFirst.mockResolvedValue({ id: draftId, idempotencyKey: 'draft-key-0001', state: 'AWAITING_CONFIRMATION', title: 'Refund', description: 'Delayed refund', category: 'BILLING', priority: 'MEDIUM', expiresAt: new Date(Date.now() + 60_000) });
    const result = await service.handleInterpretedCustomerTurn({ organizationId: org, assistantId: 'assistant', conversationId, visitorSessionId: 'a-secure-session-token-long-enough-123456', idempotencyKey: 'message-turn-key-0003', interpretation: { ticketRequest: 'NONE', draftAction: 'CONFIRM' } });
    expect(result.action).toBe('CONFIRMATION_REQUIRED');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a typed confirmation for a stale ticket draft version', async () => {
    db.ticketDraft.findFirst.mockResolvedValue({ id: draftId, version: 2, state: 'AWAITING_CONFIRMATION', title: 'Corrected title', description: 'Corrected details', category: 'SUPPORT', priority: 'MEDIUM', expiresAt: new Date(Date.now() + 60_000), ticketId: null });
    await expect(service.confirmCustomerDraft({ organizationId: org, assistantId: 'assistant', conversationId, visitorSessionId: 'a-secure-session-token-long-enough-123456', draftId, version: 1, action: 'CONFIRM_TICKET_DRAFT' })).rejects.toBeInstanceOf(ConflictException);
    expect(db.ticket.create).not.toHaveBeenCalled();
  });

  it('replays ticket cancellation only for the same tenant, assistant, conversation, and visitor session', async () => {
    db.ticketDraft.updateMany.mockResolvedValue({ count: 0 });
    db.ticketDraft.findFirst.mockResolvedValue({ id: draftId });
    const input = { organizationId: org, assistantId: 'assistant', conversationId, visitorSessionId: 'a-secure-session-token-long-enough-123456', draftId };
    await expect(service.cancelDraft(input)).resolves.toEqual({ cancelled: true, idempotent: true });
    expect(db.ticketDraft.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ id: draftId, organizationId: org, assistantId: 'assistant', conversationId, externalSessionHash: expect.any(String), state: 'CANCELLED' }), select: { id: true } });
  });

  it('sets ticket expiry exactly 72 hours from the persisted creation timestamp', async () => {
    db.ticketDraft.findFirst.mockResolvedValue({ id: draftId, version: 2, state: 'AWAITING_CONFIRMATION', title: 'Refund delay', description: 'Refund has not arrived', category: 'BILLING', priority: 'MEDIUM', expiresAt: new Date(Date.now() + 60_000), ticketId: null });
    db.ticketDraft.updateMany.mockResolvedValue({ count: 1 });
    db.$queryRaw.mockResolvedValueOnce([{ id: conversationId, channel: 'WEB_WIDGET' }]);
    db.ticket.create.mockImplementation(({ data }: any) => ({ id: 'ticket-a', ...data }));
    db.ticketEvent.create.mockResolvedValue({}); db.auditEvent.create.mockResolvedValue({}); db.ticketDraft.update.mockResolvedValue({});
    const created = await service.confirmDraft({ organizationId: org, assistantId: 'assistant', conversationId, visitorSessionId: 'a-secure-session-token-long-enough-123456', draftId, expectedVersion: 2, confirmationAction: 'CONFIRM_TICKET_DRAFT' });
    expect(created.expiresAt.getTime() - created.createdAt.getTime()).toBe(72 * 60 * 60 * 1000);
    expect(db.ticket.create.mock.calls[0][0].data.expiresAt.getTime() - db.ticket.create.mock.calls[0][0].data.createdAt.getTime()).toBe(72 * 60 * 60 * 1000);
  });

  it('scopes customer ticket status lookup to the original conversation and visitor session', async () => {
    const visitorSessionId = 'a-secure-session-token-long-enough-123456';
    db.ticket.findFirst.mockResolvedValue({ reference: 'TKT-0123456789', status: 'ACTIVE', title: 'Refund delay', createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000), updatedAt: new Date(), events: [] });
    await service.lookupForCustomer({ organizationId: org, assistantId: 'assistant', conversationId, visitorSessionId, reference: 'TKT-0123456789' });
    const where = db.ticket.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ organizationId: org, assistantId: 'assistant', conversationId, reference: 'TKT-0123456789', conversation: { is: expect.objectContaining({ id: conversationId, organizationId: org, assistantId: 'assistant', channel: 'WEB_WIDGET' }) } });
    expect(where.conversation.is.externalSessionHash).not.toBe(visitorSessionId);
    expect(where.expiresAt).toEqual({ gt: expect.any(Date) });
  });

  it('blocks owner replies to closed tickets before writing to the customer stream', async () => {
    db.ticket.findFirst.mockResolvedValue({ id: 'ticket', conversationId, assistantId: 'assistant', status: 'CLOSED', conversation: { channel: 'WIDGET' } });
    await expect(service.reply('owner', 'slug', 'ticket', { content: 'Please see this update.', idempotencyKey: 'message-key-0001' })).rejects.toBeInstanceOf(ConflictException);
    expect(db.supportMessage.create).not.toHaveBeenCalled();
  });

  it('rejects replies for expired tickets even before the cleanup worker runs', async () => {
    db.ticket.findFirst.mockResolvedValue(null);
    await expect(service.reply('owner', 'slug', 'expired-ticket', { content: 'Please see this update.', idempotencyKey: 'message-key-expired' })).rejects.toBeInstanceOf(NotFoundException);
    expect(db.ticket.findFirst.mock.calls[0][0].where.expiresAt).toEqual({ gt: expect.any(Date) });
    expect(db.supportMessage.create).not.toHaveBeenCalled();
  });

  it('cannot create a business reply before a confirmed ticket exists', async () => {
    db.ticket.findFirst.mockResolvedValue(null);
    await expect(service.reply('owner', 'slug', 'not-a-ticket', { content: 'Hello', idempotencyKey: 'message-key-0002' })).rejects.toBeInstanceOf(NotFoundException);
    expect(db.supportMessage.create).not.toHaveBeenCalled();
    expect(db.outboundDelivery.create).not.toHaveBeenCalled();
  });

  it('persists owner replies into the canonical conversation and does not claim delivery', async () => {
    db.ticket.findFirst.mockResolvedValue({ id: 'ticket', conversationId, assistantId: 'assistant', status: 'OPEN', conversation: { channel: 'INTERNAL' } });
    db.supportMessage.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'message', content: 'We are reviewing this.', createdAt: new Date() });
    db.$queryRaw.mockResolvedValueOnce([{ status: 'OPEN', expiresAt: new Date(Date.now() + 60000) }]);
    db.outboundDelivery.create.mockResolvedValue({}); db.supportConversation.update.mockResolvedValue({});
    db.ticketEvent.create.mockResolvedValue({}); db.auditEvent.create.mockResolvedValue({});
    db.outboundDelivery.findFirst.mockResolvedValue({ id: 'outbox', state: 'QUEUED' }); db.outboundDelivery.update.mockResolvedValue({});
    const result = await service.reply('owner', 'slug', 'ticket', { content: 'We are reviewing this.', idempotencyKey: 'message-key-0001' });
    expect(db.supportMessage.createMany.mock.calls[0][0].data).toEqual([expect.objectContaining({ organizationId: org, conversationId, kind: 'BUSINESS_TEAM', authorUserId: 'owner' })]);
    expect(db.outboundDelivery.create.mock.calls[0][0].data.messageId).toBe('message');
    expect(result.deliveryState).toBe('QUEUED');
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it('rejects invalid status transitions and never retrieves cross-tenant tickets', async () => {
    db.ticket.findFirst.mockResolvedValueOnce({ id: 'ticket', status: 'CLOSED', priority: 'LOW', version: 2 });
    await expect(service.update('owner', 'slug', 'ticket', { status: 'ACTIVE' })).rejects.toBeInstanceOf(ConflictException);
    db.ticket.findFirst.mockResolvedValueOnce(null);
    await expect(service.detail('owner', 'slug', 'other-ticket')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns ticket detail with the assignee identity but without the visitor session hash', async () => {
    const sessionHash = 'visitor-session-hash';
    db.ticket.findFirst.mockResolvedValue({
      id: 'ticket', reference: 'TKT-123456', title: 'Question', description: null, category: 'SUPPORT', priority: 'MEDIUM', status: 'OPEN', customerReference: 'Visitor', resolutionRemarks: null, version: 1,
      createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000), updatedAt: new Date(), assistant: { id: 'assistant', name: 'Support' }, assignee: { id: 'admin-user', name: 'Admin' },
      conversation: { id: conversationId, channel: 'WEB_WIDGET', externalSessionHash: sessionHash, lastMessageAt: null },
    });
    db.supportMessage.findMany.mockResolvedValue([]); db.supportMessage.count.mockResolvedValue(0);
    db.ticketInternalNote.findMany.mockResolvedValue([]); db.ticketEvent.findMany.mockResolvedValue([]); db.organizationMembership.findMany.mockResolvedValue([]);

    const result = await service.detail('owner', 'slug', 'ticket');

    expect(result.assignee).toEqual({ id: 'admin-user', name: 'Admin' });
    expect(result.customerReference).toBe(`Visitor ${sessionHash.slice(0, 6)}`);
    expect(result.conversation).toEqual({ id: conversationId, channel: 'WEB_WIDGET', lastMessageAt: null });
    expect(JSON.stringify(result)).not.toContain(sessionHash);
  });
});
