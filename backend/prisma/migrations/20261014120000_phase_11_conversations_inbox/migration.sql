-- Additive Phase 11 inbox fields. Existing support and Playground records are preserved.
ALTER TABLE "SupportConversation"
  ADD COLUMN "resolvedAt" TIMESTAMPTZ(3),
  ADD COLUMN "lastCustomerMessageAt" TIMESTAMPTZ(3),
  ADD COLUMN "lastMessagePreview" VARCHAR(500),
  ADD COLUMN "messageCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "SupportConversation" c SET
  "messageCount" = (SELECT COUNT(*)::integer FROM "SupportMessage" m WHERE m."conversationId" = c."id" AND m."organizationId" = c."organizationId"),
  "lastMessagePreview" = (SELECT LEFT(m."content", 500) FROM "SupportMessage" m WHERE m."conversationId" = c."id" AND m."organizationId" = c."organizationId" ORDER BY m."createdAt" DESC, m."id" DESC LIMIT 1),
  "lastCustomerMessageAt" = (SELECT MAX(m."createdAt") FROM "SupportMessage" m WHERE m."conversationId" = c."id" AND m."organizationId" = c."organizationId" AND m."kind" = 'CUSTOMER');

ALTER TABLE "SupportMessage" ADD COLUMN "idempotencyKey" VARCHAR(160);
CREATE UNIQUE INDEX "SupportMessage_org_conversation_idempotency_key" ON "SupportMessage"("organizationId", "conversationId", "idempotencyKey");
CREATE INDEX "SupportConversation_organizationId_channel_lastMessageAt_idx" ON "SupportConversation"("organizationId", "channel", "lastMessageAt");

CREATE TABLE "SupportConversationReadState" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "readAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "SupportConversationReadState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportConversationReadState_conversationId_organizationId_fkey" FOREIGN KEY ("conversationId", "organizationId") REFERENCES "SupportConversation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportConversationReadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SupportConversationReadState_conversationId_userId_key" ON "SupportConversationReadState"("conversationId", "userId");
CREATE INDEX "SupportConversationReadState_organizationId_userId_readAt_idx" ON "SupportConversationReadState"("organizationId", "userId", "readAt");
