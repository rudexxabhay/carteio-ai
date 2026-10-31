-- Allow the existing OpenRouter-compatible embedding profile while retaining direct OpenAI rows.
-- Uses the existing vector(1536) column and pgvector extension; no vector table/schema change.
ALTER TABLE "KnowledgeChunk"
  DROP CONSTRAINT "KnowledgeChunk_embedding_profile_check",
  ADD CONSTRAINT "KnowledgeChunk_embedding_profile_check" CHECK (
    ("embedding" IS NULL AND "embeddingProvider" = 'postgres' AND "embeddingModel" = 'fts-simple' AND "embeddingDimensions" = 0)
    OR
    ("embedding" IS NOT NULL AND "embeddingDimensions" = 1536 AND (
      ("embeddingProvider" = 'openai' AND "embeddingModel" = 'text-embedding-3-small')
      OR ("embeddingProvider" = 'openrouter' AND "embeddingModel" = 'openai/text-embedding-3-small')
    ))
  );

DROP INDEX IF EXISTS "KnowledgeChunk_embedding_openai_small_hnsw_idx";
CREATE INDEX "KnowledgeChunk_embedding_profile_hnsw_idx"
  ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL AND "embeddingDimensions" = 1536 AND (
    ("embeddingProvider" = 'openai' AND "embeddingModel" = 'text-embedding-3-small')
    OR ("embeddingProvider" = 'openrouter' AND "embeddingModel" = 'openai/text-embedding-3-small')
  );
