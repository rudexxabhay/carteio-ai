-- Additive Phase 12 ticketing and canonical-conversation outbound messaging.
-- This migration is authored only; do not apply before review and approval.
ALTER TYPE "InboxMessageKind" ADD VALUE IF NOT EXISTS 'BUSINESS_TEAM';
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'ACTIVE', 'PENDING', 'CLOSED');
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');
CREATE TYPE "TicketDraftState" AS ENUM ('COLLECTING', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "OutboundDeliveryState" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'UNSUPPORTED_CHANNEL');

CREATE TABLE "Ticket" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "assistantId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "reference" VARCHAR(24) NOT NULL,
  "title" VARCHAR(180) NOT NULL,
  "description" TEXT NOT NULL,
  "category" VARCHAR(80) NOT NULL,
  "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
  "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
  "customerReference" VARCHAR(80),
  "creationSource" VARCHAR(32) NOT NULL DEFAULT 'AI_CONVERSATION',
  "assignedToUserId" UUID,
  "resolutionRemarks" VARCHAR(2000),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Ticket_id_organizationId_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "Ticket_organizationId_reference_key" UNIQUE ("organizationId", "reference"),
  CONSTRAINT "Ticket_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Ticket_assistantId_organizationId_fkey" FOREIGN KEY ("assistantId", "organizationId") REFERENCES "Chatbot"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Ticket_conversationId_organizationId_fkey" FOREIGN KEY ("conversationId", "organizationId") REFERENCES "SupportConversation"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Ticket_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Ticket_organizationId_status_updatedAt_id_idx" ON "Ticket"("organizationId", "status", "updatedAt", "id");
CREATE INDEX "Ticket_organizationId_title_idx" ON "Ticket"("organizationId", "title");
CREATE INDEX "Ticket_organizationId_customerReference_idx" ON "Ticket"("organizationId", "customerReference");
CREATE INDEX "Ticket_organizationId_category_idx" ON "Ticket"("organizationId", "category");
CREATE INDEX "Ticket_organizationId_priority_updatedAt_idx" ON "Ticket"("organizationId", "priority", "updatedAt");
CREATE INDEX "Ticket_organizationId_assistantId_status_updatedAt_idx" ON "Ticket"("organizationId", "assistantId", "status", "updatedAt");
CREATE INDEX "Ticket_organizationId_assignedToUserId_status_updatedAt_idx" ON "Ticket"("organizationId", "assignedToUserId", "status", "updatedAt");

CREATE TABLE "TicketDraft" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "assistantId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "externalSessionHash" CHAR(64) NOT NULL,
  "state" "TicketDraftState" NOT NULL DEFAULT 'COLLECTING',
  "title" VARCHAR(180),
  "description" TEXT,
  "category" VARCHAR(80),
  "priority" "TicketPriority" NOT NULL DEFAULT 'MEDIUM',
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "ticketId" UUID,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TicketDraft_organizationId_idempotencyKey_key" UNIQUE ("organizationId", "idempotencyKey"),
  CONSTRAINT "TicketDraft_ticketId_key" UNIQUE ("ticketId"),
  CONSTRAINT "TicketDraft_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TicketDraft_conversationId_organizationId_fkey" FOREIGN KEY ("conversationId", "organizationId") REFERENCES "SupportConversation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TicketDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TicketDraft_assistantId_organizationId_fkey" FOREIGN KEY ("assistantId", "organizationId") REFERENCES "Chatbot"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TicketDraft_organizationId_assistantId_externalSessionHash_state_expiresAt_idx" ON "TicketDraft"("organizationId", "assistantId", "externalSessionHash", "state", "expiresAt");

CREATE TABLE "TicketEvent" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "ticketId" UUID NOT NULL,
  "actorUserId" UUID,
  "eventType" VARCHAR(48) NOT NULL,
  "fromValue" VARCHAR(80),
  "toValue" VARCHAR(80),
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TicketEvent_ticketId_organizationId_fkey" FOREIGN KEY ("ticketId", "organizationId") REFERENCES "Ticket"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TicketEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TicketEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "TicketEvent_organizationId_ticketId_createdAt_id_idx" ON "TicketEvent"("organizationId", "ticketId", "createdAt", "id");

CREATE TABLE "TicketInternalNote" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "ticketId" UUID NOT NULL,
  "authorUserId" UUID NOT NULL,
  "content" VARCHAR(4000) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketInternalNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TicketInternalNote_ticketId_organizationId_fkey" FOREIGN KEY ("ticketId", "organizationId") REFERENCES "Ticket"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TicketInternalNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TicketInternalNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "TicketInternalNote_organizationId_ticketId_createdAt_id_idx" ON "TicketInternalNote"("organizationId", "ticketId", "createdAt", "id");

CREATE TABLE "OutboundDelivery" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "ticketId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "state" "OutboundDeliveryState" NOT NULL DEFAULT 'QUEUED',
  "channel" VARCHAR(32) NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3),
  "lastErrorCode" VARCHAR(80),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutboundDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutboundDelivery_id_organizationId_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "OutboundDelivery_messageId_key" UNIQUE ("messageId"),
  CONSTRAINT "OutboundDelivery_ticketId_organizationId_fkey" FOREIGN KEY ("ticketId", "organizationId") REFERENCES "Ticket"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutboundDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutboundDelivery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OutboundDelivery_organizationId_state_nextAttemptAt_createdAt_idx" ON "OutboundDelivery"("organizationId", "state", "nextAttemptAt", "createdAt");
CREATE INDEX "OutboundDelivery_conversationId_createdAt_idx" ON "OutboundDelivery"("conversationId", "createdAt");


CREATE TABLE "OutboundDeliveryAttempt" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "deliveryId" UUID NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "state" "OutboundDeliveryState" NOT NULL,
  "transportEventId" VARCHAR(160),
  "detailCode" VARCHAR(80),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutboundDeliveryAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutboundDeliveryAttempt_transportEventId_key" UNIQUE ("transportEventId"),
  CONSTRAINT "OutboundDeliveryAttempt_deliveryId_attemptNumber_key" UNIQUE ("deliveryId", "attemptNumber"),
  CONSTRAINT "OutboundDeliveryAttempt_deliveryId_organizationId_fkey" FOREIGN KEY ("deliveryId", "organizationId") REFERENCES "OutboundDelivery"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutboundDeliveryAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "OutboundDeliveryAttempt_organizationId_deliveryId_createdAt_idx" ON "OutboundDeliveryAttempt"("organizationId", "deliveryId", "createdAt");
