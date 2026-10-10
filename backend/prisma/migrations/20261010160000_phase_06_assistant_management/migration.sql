CREATE TYPE "AssistantStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

ALTER TABLE "Chatbot"
  ADD COLUMN "createdById" UUID,
  ADD COLUMN "description" VARCHAR(1000),
  ADD COLUMN "businessPurpose" VARCHAR(500),
  ADD COLUMN "systemInstructions" VARCHAR(10000),
  ADD COLUMN "defaultLanguage" VARCHAR(35) NOT NULL DEFAULT 'en',
  ADD COLUMN "responseTone" VARCHAR(32) NOT NULL DEFAULT 'professional',
  ADD COLUMN "fallbackMessage" VARCHAR(500) NOT NULL DEFAULT 'I’m not able to help with that right now. Please contact the business directly.';

ALTER TABLE "Chatbot"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "AssistantStatus"
    USING (CASE "status"::text
      WHEN 'ACTIVE' THEN 'ACTIVE'
      ELSE 'INACTIVE'
    END)::"AssistantStatus",
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

ALTER TABLE "Chatbot"
  ADD CONSTRAINT "Chatbot_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "Chatbot_organizationId_status_idx";
CREATE INDEX "Chatbot_organizationId_status_updatedAt_idx" ON "Chatbot"("organizationId", "status", "updatedAt");
