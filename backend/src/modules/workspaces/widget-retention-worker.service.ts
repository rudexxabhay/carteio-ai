import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';

const BATCH_SIZE = 20;
const POLL_MS = 60_000;
type DueConversation = { id: string; organizationId: string; assistantId: string; externalSessionHash: string; channel: string };

/** Deletes only expired ticket data and its exact ticket-linked conversation. */
@Injectable()
export class WidgetRetentionWorker implements OnModuleInit, OnModuleDestroy {
  private readonly db: any;
  private readonly logger = new Logger(WidgetRetentionWorker.name);
  private timer?: NodeJS.Timeout;
  private inFlight: Promise<void> | null = null;
  constructor(prisma: PrismaService) { this.db = prisma; }

  onModuleInit() {
    if (process.env.WIDGET_RETENTION_WORKER_ENABLED !== 'true') return;
    this.timer = setInterval(() => {
      if (!this.inFlight) this.inFlight = this.tick().finally(() => { this.inFlight = null; });
    }, POLL_MS);
    this.timer.unref();
    void this.tick();
  }
  async onModuleDestroy() { if (this.timer) clearInterval(this.timer); await this.inFlight; }

  private async tick() {
    try { await this.cleanupBatch(); }
    catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as any).code) : '';
      this.logger.warn(JSON.stringify({ event:'widget_retention_batch_failed', code:/^[A-Z0-9_]{1,64}$/.test(code)?code:'RETENTION_PROCESSING_FAILED' }));
    }
  }

  async cleanupBatch(now = new Date()) {
    return this.db.$transaction(async (tx: any) => {
      const expiredSessionRows = await tx.widgetSession.findMany({ where: { resumeExpiresAt: { lte: now } }, orderBy: { id: 'asc' }, take: 500, select: { id: true } });
      if (expiredSessionRows.length) await tx.widgetSession.deleteMany({ where: { id: { in: expiredSessionRows.map((row: { id: string }) => row.id) }, resumeExpiresAt: { lte: now } } });
      // Lock parent conversations first. SKIP LOCKED gives cross-instance safety
      // without allowing workers to deadlock over multiple tickets in one chat.
      const candidates = await tx.$queryRaw<DueConversation[]>`
        SELECT c."id", c."organizationId", c."assistantId", c."externalSessionHash", c."channel"::text AS "channel"
        FROM "SupportConversation" c
        WHERE EXISTS (
            SELECT 1 FROM "Ticket" t
            WHERE t."organizationId" = c."organizationId"
              AND t."assistantId" = c."assistantId"
              AND t."conversationId" = c."id"
              AND t."expiresAt" <= ${now}
          )
        ORDER BY c."id"
        LIMIT ${BATCH_SIZE}
        FOR UPDATE OF c SKIP LOCKED`;

      for (const conversation of candidates) {
        const scope = { organizationId: conversation.organizationId, assistantId: conversation.assistantId, conversationId: conversation.id };
        const due = await tx.ticket.findMany({ where: { ...scope, expiresAt: { lte: now } }, orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }], take: 100, select: { id: true } });
        if (!due.length) continue;
        const ticketIds = due.map((ticket: { id: string }) => ticket.id);

        // The close is atomic with deletion. Every API also checks expiresAt, so
        // the record is inaccessible even if this worker is disabled or delayed.
        await tx.ticket.updateMany({ where: { ...scope, id: { in: ticketIds }, expiresAt: { lte: now } }, data: { status: 'CLOSED', version: { increment: 1 } } });
        // If another, later ticket shares this chat, remove only messages that
        // are explicitly tied to the expiring ticket. Shared CUSTOMER/AI context
        // is retained until the last linked ticket expires.
        await tx.ticketDraft.deleteMany({ where: { organizationId: conversation.organizationId, assistantId: conversation.assistantId, conversationId: conversation.id, ticketId: { in: ticketIds } } });
        await tx.auditEvent.deleteMany({ where: { organizationId: conversation.organizationId, entityType: 'ticket', entityId: { in: ticketIds } } });
        // The ticket FK cascades only messages explicitly linked to these IDs,
        // and cascades its notes/events/outbox attempts without broad deletes.
        await tx.ticket.deleteMany({ where: { ...scope, id: { in: ticketIds }, expiresAt: { lte: now } } });

        const active = await tx.ticket.findFirst({ where: { ...scope, expiresAt: { gt: now } }, select: { id: true } });
        const remaining = active ?? await tx.ticket.findFirst({ where: scope, select: { id: true } });
        if (remaining) {
          // Deterministic multi-ticket policy: each ticket's 72-hour expiry is
          // independent; delete its records then, while retaining shared chat
          // context required by any not-yet-expired ticket. If the per-chat
          // ticket batch cap left due tickets, the next worker batch continues.
          await tx.$executeRaw`
            UPDATE "SupportConversation" c SET
              "lastMessageAt" = (SELECT MAX(m."createdAt") FROM "SupportMessage" m WHERE m."organizationId" = c."organizationId" AND m."conversationId" = c."id"),
              "lastMessagePreview" = (SELECT LEFT(m."content", 500) FROM "SupportMessage" m WHERE m."organizationId" = c."organizationId" AND m."conversationId" = c."id" ORDER BY m."createdAt" DESC, m."id" DESC LIMIT 1),
              "messageCount" = (SELECT COUNT(*)::int FROM "SupportMessage" m WHERE m."organizationId" = c."organizationId" AND m."conversationId" = c."id")
            WHERE c."id" = ${conversation.id}::uuid AND c."organizationId" = ${conversation.organizationId}::uuid AND c."assistantId" = ${conversation.assistantId}::uuid AND c."channel" = ${conversation.channel}`;
          continue;
        }

        // No active tickets remain: deleting this exact conversation cascades
        // its complete customer/AI/business/system history and read markers.
        await tx.ticketDraft.deleteMany({ where: { ...scope } });
        await tx.supportConversation.deleteMany({ where: { organizationId: conversation.organizationId, assistantId: conversation.assistantId, id: conversation.id, channel: conversation.channel, externalSessionHash: conversation.externalSessionHash } });
      }
      return candidates.length;
    }, { timeout: 30_000, maxWait: 5_000 });
  }
}
