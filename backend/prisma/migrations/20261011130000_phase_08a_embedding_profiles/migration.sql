-- Record the only explicitly supported semantic profile. Lexical-only chunks
-- are introduced by the following migration, which makes embedding nullable.
ALTER TABLE "KnowledgeChunk"
  ADD COLUMN "embeddingDimensions" INTEGER NOT NULL DEFAULT 1536,
  ADD CONSTRAINT "KnowledgeChunk_embedding_profile_check" CHECK (
    "embeddingProvider" = 'openai'
    AND "embeddingModel" = 'text-embedding-3-small'
    AND "embeddingDimensions" = 1536
  );

-- The partial index and constraint use the same exact provider/model/dimension profile.
DROP INDEX IF EXISTS "KnowledgeChunk_embedding_hnsw_idx";
CREATE INDEX "KnowledgeChunk_embedding_openai_hnsw_idx" ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embeddingProvider" = 'openai'
    AND "embeddingModel" = 'text-embedding-3-small'
    AND "embeddingDimensions" = 1536;
