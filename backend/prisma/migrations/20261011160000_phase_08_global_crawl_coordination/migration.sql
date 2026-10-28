-- Cross-worker public-host pacing. This global table stores only coordination metadata.
CREATE TABLE "KnowledgeHostRateLimit" (
  "hostname" VARCHAR(253) NOT NULL,
  "nextAllowedAt" TIMESTAMPTZ(3) NOT NULL,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeHostRateLimit_pkey" PRIMARY KEY ("hostname")
);

CREATE INDEX "KnowledgeHostRateLimit_updated_idx"
  ON "KnowledgeHostRateLimit"("updatedAt");
