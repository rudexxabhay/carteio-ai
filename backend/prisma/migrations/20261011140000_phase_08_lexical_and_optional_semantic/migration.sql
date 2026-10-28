-- Optional semantic vectors; lexical chunks remain fully searchable without an API key.
-- Additive, forward-only correction after Phase 08/08A. No source, chunk, or job rows are deleted.
CREATE TYPE "KnowledgeSemanticStatus" AS ENUM ('NOT_CONFIGURED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED');

ALTER TABLE "KnowledgeSource"
  ADD COLUMN "semanticIndexStatus" "KnowledgeSemanticStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  ADD COLUMN "semanticIndexErrorCode" VARCHAR(100);

ALTER TABLE "KnowledgeChunk"
  ALTER COLUMN "embedding" DROP NOT NULL;

ALTER TABLE "KnowledgeChunk"
  DROP CONSTRAINT "KnowledgeChunk_embedding_profile_check",
  ADD CONSTRAINT "KnowledgeChunk_embedding_profile_check" CHECK (
    ("embedding" IS NULL AND "embeddingProvider" = 'postgres' AND "embeddingModel" = 'fts-simple' AND "embeddingDimensions" = 0)
    OR
    ("embedding" IS NOT NULL AND "embeddingProvider" = 'openai' AND "embeddingModel" = 'text-embedding-3-small' AND "embeddingDimensions" = 1536)
  );

DROP INDEX IF EXISTS "KnowledgeChunk_embedding_openai_hnsw_idx";
CREATE INDEX "KnowledgeChunk_embedding_openai_small_hnsw_idx" ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL AND "embeddingProvider" = 'openai'
    AND "embeddingModel" = 'text-embedding-3-small' AND "embeddingDimensions" = 1536;

CREATE INDEX "KnowledgeSource_name_fts_idx" ON "KnowledgeSource" USING gin (to_tsvector('simple', "name"));
