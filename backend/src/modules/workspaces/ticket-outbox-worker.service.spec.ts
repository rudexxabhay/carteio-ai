import { TicketOutboxWorker } from './ticket-outbox-worker.service';

describe('TicketOutboxWorker', () => {
  const deliveryRow = { id: 'delivery-1', organizationId: 'org-1', ticketId: 'ticket-1', conversationId: 'conversation-1', messageId: 'message-1', channel: 'WIDGET', attemptCount: 1, leaseToken: 'lease-1' };
  let db: any;
  let adapter: any;
  let worker: TicketOutboxWorker;

  beforeEach(() => {
    db = {
      ticket: { findFirst: jest.fn().mockResolvedValue({ id: deliveryRow.ticketId }) },
      $transaction: jest.fn(async (callback: any) => callback(db)),
      $queryRaw: jest.fn().mockResolvedValue([deliveryRow]),
      $executeRaw: jest.fn(),
      outboundDeliveryAttempt: { create: jest.fn(), updateMany: jest.fn() },
      outboundDelivery: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      supportMessage: { findFirst: jest.fn().mockResolvedValue({ id: 'message-1', content: 'Reply' }) },
      ticketEvent: { create: jest.fn(), createMany: jest.fn() },
    };
    adapter = { deliver: jest.fn().mockResolvedValue({ state: 'UNSUPPORTED_CHANNEL', detailCode: 'CHANNEL_TRANSPORT_NOT_CONFIGURED' }) };
    worker = new TicketOutboxWorker(db, adapter);
  });

  it('claims due records with PostgreSQL SKIP LOCKED and repairs an expired processing lease', async () => {
    const rows = await (worker as any).claimDue();
    const sql = db.$queryRaw.mock.calls[0][0].join('');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("\"state\" = 'PROCESSING'");
    expect(rows).toEqual([deliveryRow]);
    expect(db.outboundDeliveryAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ detailCode: 'WORKER_LEASE_EXPIRED' }) }));
    expect(db.outboundDeliveryAttempt.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ attemptNumber: 1, state: 'PROCESSING' }) }));
  });

  it('schedules retryable failures with bounded backoff and keeps them out of delivered state', async () => {
    adapter.deliver.mockResolvedValue({ state: 'FAILED', retryable: true, detailCode: 'TEMPORARY_CHANNEL_ERROR' });
    await (worker as any).deliverClaim(deliveryRow);
    const update = db.outboundDelivery.updateMany.mock.calls[0][0];
    expect(update.data.state).toBe('FAILED');
    expect(update.data.permanentFailure).toBe(false);
    expect(update.data.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(update.data.deliveredAt).toBeUndefined();
  });

  it('marks absent channel support permanently unsupported without claiming customer delivery', async () => {
    await (worker as any).deliverClaim(deliveryRow);
    const update = db.outboundDelivery.updateMany.mock.calls[0][0];
    expect(update.data.state).toBe('UNSUPPORTED_CHANNEL');
    expect(update.data.permanentFailure).toBe(true);
    expect(update.data.deliveredAt).toBeUndefined();
    expect(db.outboundDeliveryAttempt.updateMany.mock.calls[0][0].data.state).toBe('UNSUPPORTED_CHANNEL');
  });
});
