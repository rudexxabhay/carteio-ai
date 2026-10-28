ALTER TABLE "KnowledgeSource"
  ADD COLUMN "knowledgeSection" VARCHAR(40);

CREATE INDEX "KnowledgeSource_org_section_status_idx"
  ON "KnowledgeSource"("organizationId", "knowledgeSection", "status");
