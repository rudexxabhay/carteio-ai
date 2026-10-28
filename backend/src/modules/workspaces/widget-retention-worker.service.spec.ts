import { WidgetRetentionWorker } from './widget-retention-worker.service';

describe('WidgetRetentionWorker', () => {
  const make = (activeTicket: boolean, candidates = [{ id: 'conversation-a', organizationId: 'org-a', assistantId: 'assistant-a', externalSessionHash: 'hash-a', channel: 'WEB_WIDGET' }]) => {
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue(candidates), $executeRaw: jest.fn(),
      ticket: { findMany: jest.fn().mockResolvedValue([{ id: 'ticket-expired' }]), updateMany: jest.fn(), deleteMany: jest.fn(), findFirst: jest.fn().mockResolvedValue(activeTicket ? { id: 'ticket-active' } : null) },
      outboundDelivery: { findMany: jest.fn().mockResolvedValue([{ messageId: 'owner-reply' }]) },
      ticketEvent: { findMany: jest.fn().mockResolvedValue([{ id: 'event-status' }]) },
      ticketDraft: { findMany: jest.fn().mockResolvedValue([{ id: 'draft-a', version: 3 }]), deleteMany: jest.fn() },
      widgetSession: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn() },
      supportMessage: { deleteMany: jest.fn() }, auditEvent: { deleteMany: jest.fn() },
      supportConversation: { deleteMany: jest.fn() },
    };
    const db: any = { $transaction: jest.fn((fn: (tx: any) => unknown) => fn(tx)) };
    return { tx, worker: new WidgetRetentionWorker(db) };
  };

  it('deletes ticket-linked records and the exact conversation after its last ticket expires', async () => {
    const { tx, worker } = make(false);
    await worker.cleanupBatch(new Date('2026-01-01T00:00:00Z'));
    expect(tx.ticket.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: 'org-a', assistantId: 'assistant-a', conversationId: 'conversation-a', expiresAt: { lte: new Date('2026-01-01T00:00:00Z') } }),
      data: expect.objectContaining({ status: 'CLOSED' }),
    }));
    expect(tx.ticket.deleteMany).toHaveBeenCalledWith({ where: { organizationId: 'org-a', assistantId: 'assistant-a', conversationId: 'conversation-a', id: { in: ['ticket-expired'] }, expiresAt: { lte: new Date('2026-01-01T00:00:00Z') } } });
    expect(tx.supportMessage.deleteMany).not.toHaveBeenCalled();
    expect(tx.supportConversation.deleteMany).toHaveBeenCalledWith({ where: { organizationId: 'org-a', assistantId: 'assistant-a', id: 'conversation-a', channel: 'WEB_WIDGET', externalSessionHash: 'hash-a' } });
  });

  it('retains the shared conversation while another ticket is still active', async () => {
    const { tx, worker } = make(true);
    await worker.cleanupBatch();
    expect(tx.ticket.deleteMany).toHaveBeenCalled();
    expect(tx.supportConversation.deleteMany).not.toHaveBeenCalled();
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it('uses bounded cross-worker row locking and leaves failed transactions retryable', async () => {
    const { tx, worker } = make(false);
    tx.ticket.deleteMany.mockRejectedValueOnce(new Error('simulated transaction failure'));
    await expect(worker.cleanupBatch()).rejects.toThrow('simulated transaction failure');
    expect(String(tx.$queryRaw.mock.calls[0]?.[0])).toContain('SKIP LOCKED');
    expect(tx.ticket.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('is idempotent when the indexed expiry query has no due conversations', async () => {
    const { tx, worker } = make(false, []);
    await expect(worker.cleanupBatch()).resolves.toBe(0);
    expect(tx.ticket.deleteMany).not.toHaveBeenCalled();
  });
});
