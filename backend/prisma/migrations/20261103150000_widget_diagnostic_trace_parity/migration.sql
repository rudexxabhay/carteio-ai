ALTER TABLE "PlaygroundDiagnosticTrace"
  ALTER COLUMN "conversationId" DROP NOT NULL,
  ADD COLUMN "supportConversationId" UUID,
  ADD COLUMN "channel" VARCHAR(32) NOT NULL DEFAULT 'PLAYGROUND';

ALTER TABLE "PlaygroundDiagnosticTrace"
  ADD CONSTRAINT "PlaygroundDiagnosticTrace_support_conversation_org_fkey"
    FOREIGN KEY ("supportConversationId", "organizationId")
    REFERENCES "SupportConversation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "PlaygroundDiagnosticTrace_channel_check"
    CHECK ("channel" IN ('PLAYGROUND', 'PUBLIC_WIDGET')),
  ADD CONSTRAINT "PlaygroundDiagnosticTrace_conversation_identity_check"
    CHECK (("channel" = 'PLAYGROUND' AND "conversationId" IS NOT NULL AND "supportConversationId" IS NULL)
        OR ("channel" = 'PUBLIC_WIDGET' AND "conversationId" IS NULL AND "supportConversationId" IS NOT NULL));

CREATE UNIQUE INDEX "PlaygroundDiagnosticTrace_support_attempt_key"
  ON "PlaygroundDiagnosticTrace"("supportConversationId", "clientTurnId", "attempt");
CREATE INDEX "PlaygroundDiagnosticTrace_org_support_created_idx"
  ON "PlaygroundDiagnosticTrace"("organizationId", "supportConversationId", "createdAt");
