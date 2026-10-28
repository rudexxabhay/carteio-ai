CREATE TYPE "KnowledgeVisibility" AS ENUM ('INTERNAL_RESTRICTED', 'PUBLIC_REFERENCE');
CREATE TYPE "KnowledgeBaseStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

ALTER TABLE "KnowledgeSource"
  ADD COLUMN "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'INTERNAL_RESTRICTED';
CREATE INDEX "KnowledgeSource_org_status_processing_visibility_idx" ON "KnowledgeSource"("organizationId", "status", "processingStatus", "visibility");
CREATE INDEX "KnowledgeSource_org_status_name_idx" ON "KnowledgeSource"("organizationId", "status", "name");

CREATE TABLE "KnowledgeBase" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "createdById" UUID,
  "name" VARCHAR(200) NOT NULL,
  "nameKey" VARCHAR(500) NOT NULL,
  "description" VARCHAR(1000),
  "status" "KnowledgeBaseStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "archivedAt" TIMESTAMPTZ(3),
  CONSTRAINT "KnowledgeBase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeBase_id_organizationId_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "KnowledgeBase_organizationId_nameKey_key" UNIQUE ("organizationId", "nameKey"),
  CONSTRAINT "KnowledgeBase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeBase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "KnowledgeBase_organizationId_status_updatedAt_idx" ON "KnowledgeBase"("organizationId", "status", "updatedAt");
CREATE INDEX "KnowledgeBase_organizationId_name_idx" ON "KnowledgeBase"("organizationId", "name");

CREATE TABLE "KnowledgeBaseSource" (
  "organizationId" UUID NOT NULL,
  "knowledgeBaseId" UUID NOT NULL,
  "sourceId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeBaseSource_pkey" PRIMARY KEY ("knowledgeBaseId", "sourceId"),
  CONSTRAINT "KnowledgeBaseSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeBaseSource_knowledgeBaseId_organizationId_fkey" FOREIGN KEY ("knowledgeBaseId", "organizationId") REFERENCES "KnowledgeBase"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeBaseSource_sourceId_organizationId_fkey" FOREIGN KEY ("sourceId", "organizationId") REFERENCES "KnowledgeSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "KnowledgeBaseSource_organizationId_sourceId_idx" ON "KnowledgeBaseSource"("organizationId", "sourceId");
CREATE INDEX "KnowledgeBaseSource_org_base_created_idx" ON "KnowledgeBaseSource"("organizationId", "knowledgeBaseId", "createdAt");

CREATE TABLE "AssistantKnowledgeBase" (
  "organizationId" UUID NOT NULL,
  "assistantId" UUID NOT NULL,
  "knowledgeBaseId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AssistantKnowledgeBase_pkey" PRIMARY KEY ("assistantId", "knowledgeBaseId"),
  CONSTRAINT "AssistantKnowledgeBase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AssistantKnowledgeBase_assistantId_organizationId_fkey" FOREIGN KEY ("assistantId", "organizationId") REFERENCES "Chatbot"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssistantKnowledgeBase_knowledgeBaseId_organizationId_fkey" FOREIGN KEY ("knowledgeBaseId", "organizationId") REFERENCES "KnowledgeBase"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AssistantKnowledgeBase_organizationId_knowledgeBaseId_idx" ON "AssistantKnowledgeBase"("organizationId", "knowledgeBaseId");
CREATE INDEX "AssistantKnowledgeBase_organizationId_assistantId_idx" ON "AssistantKnowledgeBase"("organizationId", "assistantId");
