CREATE TABLE "PlaygroundConversation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "assistantId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "channel" VARCHAR(32) NOT NULL DEFAULT 'PLAYGROUND',
  "nextSequence" INTEGER NOT NULL DEFAULT 0,
  "activeRequestId" UUID,
  "activeRequestUntil" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PlaygroundConversation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlaygroundConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlaygroundConversation_assistantId_organizationId_fkey" FOREIGN KEY ("assistantId", "organizationId") REFERENCES "Chatbot"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlaygroundConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlaygroundConversation_nextSequence_check" CHECK ("nextSequence" >= 0)
);
CREATE UNIQUE INDEX "PlaygroundConversation_id_organizationId_key" ON "PlaygroundConversation"("id", "organizationId");
CREATE INDEX "PlaygroundConversation_org_assistant_user_expiry_idx" ON "PlaygroundConversation"("organizationId", "assistantId", "userId", "expiresAt");
CREATE INDEX "PlaygroundConversation_expiresAt_idx" ON "PlaygroundConversation"("expiresAt");

CREATE TABLE "PlaygroundMessage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "clientTurnId" UUID,
  "role" VARCHAR(16) NOT NULL,
  "content" TEXT NOT NULL,
  "responseCategory" VARCHAR(40),
  "answerOrigin" VARCHAR(40),
  "sourceReferences" JSONB,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaygroundMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlaygroundMessage_conversationId_organizationId_fkey" FOREIGN KEY ("conversationId", "organizationId") REFERENCES "PlaygroundConversation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlaygroundMessage_role_check" CHECK ("role" IN ('user', 'assistant')),
  CONSTRAINT "PlaygroundMessage_sequence_check" CHECK ("sequence" >= 0),
  CONSTRAINT "PlaygroundMessage_inputTokens_check" CHECK ("inputTokens" IS NULL OR "inputTokens" >= 0),
  CONSTRAINT "PlaygroundMessage_outputTokens_check" CHECK ("outputTokens" IS NULL OR "outputTokens" >= 0)
);
CREATE UNIQUE INDEX "PlaygroundMessage_conversationId_sequence_key" ON "PlaygroundMessage"("conversationId", "sequence");
CREATE UNIQUE INDEX "PlaygroundMessage_conversationId_clientTurnId_key" ON "PlaygroundMessage"("conversationId", "clientTurnId");
CREATE INDEX "PlaygroundMessage_org_conversation_created_idx" ON "PlaygroundMessage"("organizationId", "conversationId", "createdAt");

CREATE TABLE "PlaygroundRateLimit" (
  "scopeKey" VARCHAR(160) NOT NULL,
  "windowStartedAt" TIMESTAMPTZ(3) NOT NULL,
  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlaygroundRateLimit_pkey" PRIMARY KEY ("scopeKey"),
  CONSTRAINT "PlaygroundRateLimit_requestCount_check" CHECK ("requestCount" >= 0)
);
CREATE INDEX "PlaygroundRateLimit_updatedAt_idx" ON "PlaygroundRateLimit"("updatedAt");
