ALTER TABLE "PlaygroundConversation"
  ADD COLUMN "diagnosticCaptureEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PlaygroundDiagnosticTrace" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "assistantId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "requestId" UUID NOT NULL,
  "clientTurnId" UUID,
  "attempt" INTEGER NOT NULL DEFAULT 1,
  "outcome" VARCHAR(16) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "PlaygroundDiagnosticTrace_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlaygroundDiagnosticTrace_requestId_key" UNIQUE ("requestId"),
  CONSTRAINT "PlaygroundDiagnosticTrace_attempt_key" UNIQUE ("conversationId", "clientTurnId", "attempt"),
  CONSTRAINT "PlaygroundDiagnosticTrace_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlaygroundDiagnosticTrace_assistant_org_fkey" FOREIGN KEY ("assistantId", "organizationId") REFERENCES "Chatbot"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlaygroundDiagnosticTrace_conversation_org_fkey" FOREIGN KEY ("conversationId", "organizationId") REFERENCES "PlaygroundConversation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlaygroundDiagnosticTrace_user_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PlaygroundDiagnosticTrace_attempt_check" CHECK ("attempt" > 0),
  CONSTRAINT "PlaygroundDiagnosticTrace_outcome_check" CHECK ("outcome" IN ('COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT')),
  CONSTRAINT "PlaygroundDiagnosticTrace_payload_size_check" CHECK (pg_column_size("payload") <= 262144)
);

CREATE INDEX "PlaygroundDiagnosticTrace_org_conversation_created_idx"
  ON "PlaygroundDiagnosticTrace"("organizationId", "conversationId", "createdAt");
CREATE INDEX "PlaygroundDiagnosticTrace_expires_idx"
  ON "PlaygroundDiagnosticTrace"("expiresAt");
