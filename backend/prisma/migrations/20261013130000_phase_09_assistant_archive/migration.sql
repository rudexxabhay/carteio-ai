-- Additive, reversible assistant archive state. No records are deleted or rewritten.
ALTER TABLE "Chatbot" ADD COLUMN "archivedAt" TIMESTAMPTZ(3);
CREATE INDEX "Chatbot_organizationId_archivedAt_updatedAt_idx"
  ON "Chatbot"("organizationId", "archivedAt", "updatedAt");
