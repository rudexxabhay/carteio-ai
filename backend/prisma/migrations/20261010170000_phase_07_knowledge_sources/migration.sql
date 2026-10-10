CREATE TYPE "KnowledgeSourceType" AS ENUM ('WEBSITE', 'FAQ', 'TEXT');
CREATE TYPE "KnowledgeSourceStatus" AS ENUM ('REGISTERED', 'DISABLED', 'ARCHIVED');
CREATE TYPE "KnowledgeProcessingStatus" AS ENUM ('NOT_PROCESSED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED');

CREATE TABLE "KnowledgeSource" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "createdById" UUID,
  "type" "KnowledgeSourceType" NOT NULL,
  "status" "KnowledgeSourceStatus" NOT NULL DEFAULT 'REGISTERED',
  "processingStatus" "KnowledgeProcessingStatus" NOT NULL DEFAULT 'NOT_PROCESSED',
  "name" VARCHAR(200) NOT NULL,
  "description" VARCHAR(1000),
  "sourceUrl" VARCHAR(2048),
  "contentBody" TEXT,
  "category" VARCHAR(120),
  "languageHint" VARCHAR(35),
  "canonicalKey" VARCHAR(80) NOT NULL,
  "sourceVersion" INTEGER NOT NULL DEFAULT 1,
  "lastSyncAt" TIMESTAMPTZ(3),
  "lastSuccessfulSyncAt" TIMESTAMPTZ(3),
  "lastSyncErrorCode" VARCHAR(100),
  "deletedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeSource_id_organizationId_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "KnowledgeSource_organizationId_canonicalKey_key" UNIQUE ("organizationId", "canonicalKey"),
  CONSTRAINT "KnowledgeSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "KnowledgeSource_organizationId_status_updatedAt_idx" ON "KnowledgeSource"("organizationId", "status", "updatedAt");
CREATE INDEX "KnowledgeSource_organizationId_type_processingStatus_idx" ON "KnowledgeSource"("organizationId", "type", "processingStatus");

CREATE TABLE "AssistantKnowledgeSource" (
  "organizationId" UUID NOT NULL,
  "assistantId" UUID NOT NULL,
  "sourceId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantKnowledgeSource_pkey" PRIMARY KEY ("assistantId", "sourceId"),
  CONSTRAINT "AssistantKnowledgeSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AssistantKnowledgeSource_assistantId_organizationId_fkey" FOREIGN KEY ("assistantId", "organizationId") REFERENCES "Chatbot"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssistantKnowledgeSource_sourceId_organizationId_fkey" FOREIGN KEY ("sourceId", "organizationId") REFERENCES "KnowledgeSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AssistantKnowledgeSource_organizationId_sourceId_idx" ON "AssistantKnowledgeSource"("organizationId", "sourceId");
