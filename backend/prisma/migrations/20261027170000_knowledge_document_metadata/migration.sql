-- Additive metadata only; existing source identities, visibility and chunks are unchanged.
ALTER TABLE "KnowledgeSource" ADD COLUMN "document" JSONB;
