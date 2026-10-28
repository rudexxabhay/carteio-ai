ALTER TABLE "Chatbot"
  ADD COLUMN "greetingMessage" VARCHAR(500),
  ADD COLUMN "escalationMessage" VARCHAR(500),
  ADD COLUMN "responseStyle" VARCHAR(20) NOT NULL DEFAULT 'balanced';

CREATE TABLE "AssistantBusinessRule" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "assistantId" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "instruction" VARCHAR(2000) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AssistantBusinessRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssistantBusinessRule_id_organizationId_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "AssistantBusinessRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AssistantBusinessRule_assistantId_organizationId_fkey" FOREIGN KEY ("assistantId", "organizationId") REFERENCES "Chatbot"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AssistantBusinessRule_org_assistant_enabled_updated_idx"
  ON "AssistantBusinessRule"("organizationId", "assistantId", "enabled", "updatedAt");
