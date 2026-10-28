-- Website authorization, bounded crawl configuration, sync scheduling and history.
-- Additive to Phase 07 sources; existing website registrations remain unverified.
CREATE TYPE "KnowledgeSyncPolicy" AS ENUM ('MANUAL', 'DAILY', 'WEEKLY');

ALTER TABLE "KnowledgeSource"
  ADD COLUMN "verificationStatus" "WebsiteVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
  ADD COLUMN "verificationTokenHash" CHAR(64),
  ADD COLUMN "verificationExpiresAt" TIMESTAMPTZ(3),
  ADD COLUMN "verifiedAt" TIMESTAMPTZ(3),
  ADD COLUMN "syncPolicy" "KnowledgeSyncPolicy" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "syncPaused" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "nextSyncAt" TIMESTAMPTZ(3),
  ADD COLUMN "lastSyncAttemptAt" TIMESTAMPTZ(3),
  ADD COLUMN "crawlPathPrefix" VARCHAR(2048),
  ADD COLUMN "crawlMaxPages" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "crawlMaxDepth" INTEGER NOT NULL DEFAULT 3,
  ADD CONSTRAINT "KnowledgeSource_crawl_limits_check" CHECK (
    "crawlMaxPages" BETWEEN 1 AND 200 AND "crawlMaxDepth" BETWEEN 0 AND 8
  );

ALTER TABLE "KnowledgePage"
  ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "KnowledgeSyncRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "sourceId" UUID NOT NULL,
  "jobId" UUID,
  "status" VARCHAR(24) NOT NULL,
  "discoveredPages" INTEGER NOT NULL DEFAULT 0,
  "changedPages" INTEGER NOT NULL DEFAULT 0,
  "unchangedPages" INTEGER NOT NULL DEFAULT 0,
  "removedPages" INTEGER NOT NULL DEFAULT 0,
  "failedPages" INTEGER NOT NULL DEFAULT 0,
  "errorCode" VARCHAR(100),
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeSyncRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KnowledgeSyncRun_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeSyncRun_source_org_fkey" FOREIGN KEY ("sourceId", "organizationId") REFERENCES "KnowledgeSource"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "KnowledgeSyncRun_counts_check" CHECK (
    "discoveredPages" >= 0 AND "changedPages" >= 0 AND "unchangedPages" >= 0 AND "removedPages" >= 0 AND "failedPages" >= 0
  )
);

CREATE INDEX "KnowledgeSource_sync_schedule_idx" ON "KnowledgeSource"("syncPolicy", "nextSyncAt");
CREATE INDEX "KnowledgePage_org_source_generation_idx" ON "KnowledgePage"("organizationId", "sourceId", "generation");
CREATE INDEX "KnowledgeSyncRun_org_source_started_idx" ON "KnowledgeSyncRun"("organizationId", "sourceId", "startedAt");
