-- Forward-only Phase 08 foundation. Requires Neon/PostgreSQL pgvector support.
-- Intentionally not applied by this change.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "KnowledgeJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED');

ALTER TABLE "KnowledgeSource"
  ADD COLUMN "activeIndexGeneration" INTEGER,
  ADD COLUMN "processingErrorCode" VARCHAR(100);

CREATE TABLE "KnowledgeProcessingJob" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "sourceId" UUID NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "status" "KnowledgeJobStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leasedAt" TIMESTAMPTZ(3),
  "leaseOwner" VARCHAR(120),
  "heartbeatAt" TIMESTAMPTZ(3),
  "errorCode" VARCHAR(100),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "KnowledgeProcessingJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeProcessingJob_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeProcessingJob_source_org_fkey" FOREIGN KEY ("sourceId", "organizationId") REFERENCES "KnowledgeSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "KnowledgeProcessingJob_status_available_created_idx" ON "KnowledgeProcessingJob"("status", "availableAt", "createdAt");
CREATE INDEX "KnowledgeProcessingJob_org_source_version_status_idx" ON "KnowledgeProcessingJob"("organizationId", "sourceId", "sourceVersion", "status");
CREATE UNIQUE INDEX "KnowledgeProcessingJob_active_source_version_key" ON "KnowledgeProcessingJob"("sourceId", "sourceVersion", "kind") WHERE "status" IN ('QUEUED', 'PROCESSING', 'RETRY_WAIT');

CREATE TABLE "KnowledgePage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "sourceId" UUID NOT NULL,
  "canonicalUrl" VARCHAR(2048) NOT NULL,
  "title" VARCHAR(500) NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" CHAR(64) NOT NULL,
  "sourceVersion" INTEGER NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'READY',
  "fetchedAt" TIMESTAMPTZ(3) NOT NULL,
  "indexedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "KnowledgePage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgePage_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "KnowledgePage_source_org_fkey" FOREIGN KEY ("sourceId", "organizationId") REFERENCES "KnowledgeSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgePage_source_url_version_key" UNIQUE ("sourceId", "canonicalUrl", "sourceVersion"),
  CONSTRAINT "KnowledgePage_id_organizationId_key" UNIQUE ("id", "organizationId")
);
CREATE INDEX "KnowledgePage_org_source_version_status_idx" ON "KnowledgePage"("organizationId", "sourceId", "sourceVersion", "status");

CREATE TABLE "KnowledgeChunk" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "sourceId" UUID NOT NULL,
  "pageId" UUID,
  "sourceVersion" INTEGER NOT NULL,
  "generation" INTEGER NOT NULL,
  "sequence" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" CHAR(64) NOT NULL,
  "locator" VARCHAR(2048),
  "embeddingProvider" VARCHAR(40) NOT NULL,
  "embeddingModel" VARCHAR(120) NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "indexedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeChunk_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeChunk_source_org_fkey" FOREIGN KEY ("sourceId", "organizationId") REFERENCES "KnowledgeSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeChunk_page_org_fkey" FOREIGN KEY ("pageId", "organizationId") REFERENCES "KnowledgePage"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeChunk_id_organizationId_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "KnowledgeChunk_source_generation_sequence_key" UNIQUE ("sourceId", "generation", "sequence")
);
CREATE INDEX "KnowledgeChunk_org_source_version_generation_idx" ON "KnowledgeChunk"("organizationId", "sourceId", "sourceVersion", "generation");
CREATE INDEX "KnowledgeChunk_embedding_hnsw_idx" ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "KnowledgeChunk_content_fts_idx" ON "KnowledgeChunk" USING gin (to_tsvector('simple', "content"));
