ALTER TABLE "KnowledgePage"
  ADD COLUMN "pageCategory" VARCHAR(40),
  ADD COLUMN "languageHint" VARCHAR(35);

ALTER TABLE "KnowledgeSyncRun"
  ADD COLUMN "skippedPages" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "unsupportedPages" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retryableFailures" INTEGER NOT NULL DEFAULT 0;
