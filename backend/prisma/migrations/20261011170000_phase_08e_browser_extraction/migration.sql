-- Additive to the existing Phase 08 chain. Existing pages retain their HTML provenance.
ALTER TABLE "KnowledgePage"
  ADD COLUMN "extractionMethod" VARCHAR(24) NOT NULL DEFAULT 'HTML',
  ADD CONSTRAINT "KnowledgePage_extraction_method_check"
    CHECK ("extractionMethod" IN ('HTML', 'BROWSER_RENDERED'));

ALTER TABLE "KnowledgeProcessingJob"
  ADD COLUMN "stage" VARCHAR(32),
  ADD CONSTRAINT "KnowledgeProcessingJob_stage_check"
    CHECK ("stage" IS NULL OR "stage" IN ('HTML_EXTRACTION', 'BROWSER_RENDERING', 'INDEXING', 'INDEX_PUBLISHED'));
