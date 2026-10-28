-- Backfill the fixed retention deadline for pre-existing Phase 12 tickets.
-- This migration adds no destructive operation; expired records are processed later
-- only by the tenant/assistant/conversation-scoped retention worker.
ALTER TABLE "Ticket" ADD COLUMN "expiresAt" TIMESTAMPTZ(3);
UPDATE "Ticket" SET "expiresAt" = "createdAt" + INTERVAL '72 hours' WHERE "expiresAt" IS NULL;
ALTER TABLE "Ticket" ALTER COLUMN "expiresAt" SET NOT NULL;
CREATE INDEX "Ticket_organizationId_assistantId_conversationId_expiresAt_idx" ON "Ticket"("organizationId", "assistantId", "conversationId", "expiresAt");
ALTER TABLE "SupportMessage" ADD COLUMN "ticketId" UUID;
UPDATE "SupportMessage" m SET "ticketId" = d."ticketId" FROM "OutboundDelivery" d WHERE d."messageId" = m."id" AND d."ticketId" IS NOT NULL;
UPDATE "SupportMessage" m SET "ticketId" = e."ticketId" FROM "TicketEvent" e WHERE m."idempotencyKey" = 'ticket-status:' || e."id"::text AND e."eventType" = 'STATUS_CHANGED';
UPDATE "SupportMessage" m SET "ticketId" = d."ticketId" FROM "TicketDraft" d WHERE m."idempotencyKey" LIKE 'ticket-confirm:' || d."id"::text || ':%' AND d."ticketId" IS NOT NULL;
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_ticketId_organizationId_fkey" FOREIGN KEY ("ticketId", "organizationId") REFERENCES "Ticket"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "SupportMessage_ticketId_organizationId_createdAt_idx" ON "SupportMessage"("ticketId", "organizationId", "createdAt");
CREATE TABLE "WidgetSession" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "assistantId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "accessTokenHash" CHAR(64) NOT NULL,
  "resumeTokenHash" CHAR(64) NOT NULL,
  "visitorSessionId" VARCHAR(64) NOT NULL,
  "origin" VARCHAR(512) NOT NULL,
  "accessExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "resumeExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WidgetSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WidgetSession_accessTokenHash_key" ON "WidgetSession"("accessTokenHash");
CREATE INDEX "WidgetSession_resumeTokenHash_resumeExpiresAt_idx" ON "WidgetSession"("resumeTokenHash", "resumeExpiresAt");
CREATE INDEX "WidgetSession_organizationId_assistantId_conversationId_accessExpiresAt_idx" ON "WidgetSession"("organizationId", "assistantId", "conversationId", "accessExpiresAt");
ALTER TABLE "WidgetSession" ADD CONSTRAINT "WidgetSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WidgetSession" ADD CONSTRAINT "WidgetSession_assistantId_organizationId_fkey" FOREIGN KEY ("assistantId", "organizationId") REFERENCES "Chatbot"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WidgetSession" ADD CONSTRAINT "WidgetSession_conversationId_organizationId_fkey" FOREIGN KEY ("conversationId", "organizationId") REFERENCES "SupportConversation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
