import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { SupportDeliveryService } from './support-delivery.service';

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const LEASE_MS = 60_000;
const POLL_MS = 2_000;

type ClaimedDelivery = { id: string; organizationId: string; ticketId: string; conversationId: string; messageId: string; channel: string; attemptCount: number; leaseToken: string };

/** PostgreSQL-backed outbox consumer. Expired leases recover deliveries after process crashes. */
@Injectable()
export class TicketOutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly db: any;
  private readonly logger = new Logger(TicketOutboxWorker.name);
  private timer?: NodeJS.Timeout;
  private inFlight: Promise<void> | null = null;
  private readonly workerId = randomUUID();

  constructor(prisma: PrismaService, private readonly delivery: SupportDeliveryService) { this.db = prisma; }

  onModuleInit() {
    if (process.env.TICKET_OUTBOX_WORKER_ENABLED !== 'true') return;
    this.timer = setInterval(() => {
      if (!this.inFlight) this.inFlight = this.tick().finally(() => { this.inFlight = null; });
    }, POLL_MS);
    this.timer.unref();
    void this.tick();
  }

  async onModuleDestroy() { if (this.timer) clearInterval(this.timer); await this.inFlight; }

  private async tick() {
    try {
      await this.requeueNowSupported();
      const batch = await this.claimDue();
      for (const row of batch) await this.deliverClaim(row);
    } catch (error) {
      this.logger.warn(JSON.stringify({ event: 'ticket_outbox_batch_failed', workerId: this.workerId, code: this.safeCode(error) }));
    }
  }

  private async requeueNowSupported() {
    const channels = this.delivery.supportedChannels();
    if (!channels.length) return;
    const rows = await this.db.outboundDelivery.findMany({ where: { state: 'UNSUPPORTED_CHANNEL', channel: { in: channels }, attemptCount: { lt: MAX_ATTEMPTS } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: BATCH_SIZE, select: { id: true, organizationId: true } });
    if (!rows.length) return;
    await this.db.outboundDelivery.updateMany({ where: { id: { in: rows.map((row: any) => row.id) }, state: 'UNSUPPORTED_CHANNEL' }, data: { state: 'QUEUED', permanentFailure: false, nextAttemptAt: new Date(), lastErrorCode: null } });
  }

  private safeCode(error: unknown) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as any).code) : '';
    return /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'OUTBOX_PROCESSING_FAILED';
  }

  private async claimDue(): Promise<ClaimedDelivery[]> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    const token = randomUUID();
    return this.db.$transaction(async (tx: any) => {
      const exhausted = await tx.outboundDelivery.findMany({ where: { state: 'PROCESSING', leaseUntil: { lte: now }, attemptCount: { gte: MAX_ATTEMPTS } }, orderBy: [{ leaseUntil: 'asc' }, { id: 'asc' }], take: BATCH_SIZE, select: { id: true, organizationId: true, ticketId: true, messageId: true } });
      if (exhausted.length) {
        const ids = exhausted.map((row: any) => row.id);
        const repaired = await tx.outboundDelivery.updateMany({ where: { id: { in: ids }, state: 'PROCESSING', leaseUntil: { lte: now }, attemptCount: { gte: MAX_ATTEMPTS } }, data: { state: 'FAILED', leaseToken: null, leaseUntil: null, permanentFailure: true, nextAttemptAt: null, failedAt: now, lastErrorCode: 'WORKER_LEASE_EXPIRED_MAX_ATTEMPTS', updatedAt: now } });
        if (repaired.count) {
          await tx.outboundDeliveryAttempt.updateMany({ where: { deliveryId: { in: ids }, state: 'PROCESSING' }, data: { state: 'FAILED', retryable: false, detailCode: 'WORKER_LEASE_EXPIRED_MAX_ATTEMPTS', completedAt: now } });
          await tx.ticketEvent.createMany({ data: exhausted.map((row: any) => ({ organizationId: row.organizationId, ticketId: row.ticketId, eventType: 'DELIVERY_FAILED', metadata: { messageId: row.messageId, detailCode: 'WORKER_LEASE_EXPIRED_MAX_ATTEMPTS' } })) });
        }
      }
      const rows = await tx.$queryRaw<ClaimedDelivery[]>`
        WITH candidates AS (
          SELECT "id" FROM "OutboundDelivery"
          WHERE "permanentFailure" = false AND "attemptCount" < ${MAX_ATTEMPTS}
            AND EXISTS (SELECT 1 FROM "Ticket" t WHERE t."id" = "OutboundDelivery"."ticketId" AND t."organizationId" = "OutboundDelivery"."organizationId" AND t."status" <> 'CLOSED' AND t."expiresAt" > ${now})
            AND (("state" = 'QUEUED' AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now}))
              OR ("state" = 'FAILED' AND "nextAttemptAt" <= ${now})
              OR ("state" = 'PROCESSING' AND "leaseUntil" <= ${now}))
          ORDER BY COALESCE("nextAttemptAt", "createdAt"), "createdAt", "id"
          LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED
        )
        UPDATE "OutboundDelivery" d SET "state" = 'PROCESSING', "leaseToken" = ${token},
          "leaseUntil" = ${leaseUntil}, "attemptCount" = d."attemptCount" + 1, "nextAttemptAt" = NULL,
          "updatedAt" = ${now}
        FROM candidates c WHERE d."id" = c."id"
        RETURNING d."id", d."organizationId", d."ticketId", d."conversationId", d."messageId", d."channel", d."attemptCount", d."leaseToken"`;
      for (const row of rows) {
        await tx.outboundDeliveryAttempt.updateMany({ where: { deliveryId: row.id, organizationId: row.organizationId, state: 'PROCESSING', attemptNumber: { lt: row.attemptCount } }, data: { state: 'FAILED', retryable: true, detailCode: 'WORKER_LEASE_EXPIRED', completedAt: now } });
        await tx.outboundDeliveryAttempt.create({ data: { organizationId: row.organizationId, deliveryId: row.id, attemptNumber: row.attemptCount, state: 'PROCESSING' } });
      }
      return rows;
    });
  }

  private async deliverClaim(row: ClaimedDelivery) {
    const ticket = await this.db.ticket.findFirst({ where: { id: row.ticketId, organizationId: row.organizationId, status: { not: 'CLOSED' }, expiresAt: { gt: new Date() } }, select: { id: true } });
    if (!ticket) return this.finish(row, { state: 'FAILED', retryable: false, detailCode: 'TICKET_CLOSED_OR_EXPIRED' });
    const message = await this.db.supportMessage.findFirst({ where: { id: row.messageId, organizationId: row.organizationId, conversationId: row.conversationId, kind: 'BUSINESS_TEAM' }, select: { id: true, content: true } });
    if (!message) return this.finish(row, { state: 'FAILED', retryable: false, detailCode: 'OUTBOX_MESSAGE_MISSING' });
    let outcome;
    try { outcome = await this.delivery.deliver(row.channel, { ...message, conversationId: row.conversationId }); }
    catch (error) { outcome = { state: 'FAILED' as const, retryable: true, detailCode: this.safeCode(error) }; }
    await this.finish(row, outcome);
  }

  private async finish(row: ClaimedDelivery, outcome: { state: 'SENT' | 'DELIVERED' | 'FAILED' | 'UNSUPPORTED_CHANNEL'; retryable?: boolean; transportEventId?: string; detailCode?: string }) {
    const now = new Date();
    const retryable = outcome.state === 'FAILED' && outcome.retryable === true && row.attemptCount < MAX_ATTEMPTS;
    const delay = Math.min(30 * 60_000, 30_000 * (2 ** Math.max(0, row.attemptCount - 1)));
    const nextAttemptAt = retryable ? new Date(now.getTime() + delay) : null;
    const terminalFailure = outcome.state === 'FAILED' && !retryable;
    await this.db.$transaction(async (tx: any) => {
      const updated = await tx.outboundDelivery.updateMany({
        where: { id: row.id, organizationId: row.organizationId, state: 'PROCESSING', leaseToken: row.leaseToken },
        data: { state: outcome.state, leaseToken: null, leaseUntil: null, nextAttemptAt, permanentFailure: terminalFailure || outcome.state === 'UNSUPPORTED_CHANNEL', sentAt: outcome.state === 'SENT' ? now : undefined, deliveredAt: outcome.state === 'DELIVERED' ? now : undefined, failedAt: ['FAILED', 'UNSUPPORTED_CHANNEL'].includes(outcome.state) ? now : undefined, lastErrorCode: ['DELIVERED', 'SENT'].includes(outcome.state) ? null : (outcome.detailCode ?? 'DELIVERY_FAILED').slice(0, 80), updatedAt: now },
      });
      if (!updated.count) return;
      await tx.outboundDeliveryAttempt.updateMany({ where: { deliveryId: row.id, organizationId: row.organizationId, attemptNumber: row.attemptCount, state: 'PROCESSING' }, data: { state: outcome.state, retryable, transportEventId: outcome.transportEventId, detailCode: outcome.detailCode?.slice(0, 80) ?? null, completedAt: now } });
      await tx.ticketEvent.create({ data: { organizationId: row.organizationId, ticketId: row.ticketId, eventType: `DELIVERY_${outcome.state}`, metadata: { messageId: row.messageId, attempt: row.attemptCount, detailCode: outcome.detailCode?.slice(0, 80) ?? null } } });
    });
  }
}
