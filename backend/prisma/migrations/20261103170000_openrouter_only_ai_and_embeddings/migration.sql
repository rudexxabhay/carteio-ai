-- Converge existing assistant and embedding metadata on the sole supported provider.
-- Existing vectors are retained: the embedding model/dimension and vector values are unchanged.
ALTER TABLE "Chatbot"
  DROP CONSTRAINT "Chatbot_aiProvider_supported_check";

UPDATE "Chatbot"
SET "aiProvider" = 'openrouter',
    "aiModel" = NULL,
    "providerMode" = 'MANUAL',
    "providerFallbacks" = '[]'::jsonb
WHERE "aiProvider" IS DISTINCT FROM 'openrouter'
   OR "providerMode" IS DISTINCT FROM 'MANUAL'
   OR "providerFallbacks" IS DISTINCT FROM '[]'::jsonb;

ALTER TABLE "Chatbot"
  ADD CONSTRAINT "Chatbot_aiProvider_supported_check"
    CHECK ("aiProvider" IS NULL OR "aiProvider" = 'openrouter');

UPDATE "KnowledgeChunk"
SET "embeddingProvider" = 'openrouter',
    "embeddingModel" = 'openai/text-embedding-3-small'
WHERE "embedding" IS NOT NULL
  AND "embeddingProvider" = 'openai'
  AND "embeddingModel" = 'text-embedding-3-small'
  AND "embeddingDimensions" = 1536;

ALTER TABLE "KnowledgeChunk"
  DROP CONSTRAINT "KnowledgeChunk_embedding_profile_check",
  ADD CONSTRAINT "KnowledgeChunk_embedding_profile_check" CHECK (
    ("embedding" IS NULL AND "embeddingProvider" = 'postgres' AND "embeddingModel" = 'fts-simple' AND "embeddingDimensions" = 0)
    OR ("embedding" IS NOT NULL AND "embeddingProvider" = 'openrouter' AND "embeddingModel" = 'openai/text-embedding-3-small' AND "embeddingDimensions" = 1536)
  );

DROP INDEX IF EXISTS "KnowledgeChunk_embedding_profile_hnsw_idx";
CREATE INDEX "KnowledgeChunk_embedding_profile_hnsw_idx"
  ON "KnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL
    AND "embeddingProvider" = 'openrouter'
    AND "embeddingModel" = 'openai/text-embedding-3-small'
    AND "embeddingDimensions" = 1536;
