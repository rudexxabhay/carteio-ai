CREATE TABLE "ConnectorDataPermission" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "connectorInstanceId" UUID NOT NULL,
  "category" VARCHAR(40) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ConnectorDataPermission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorDataPermission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectorDataPermission_connectorInstanceId_organizationId_fkey" FOREIGN KEY ("connectorInstanceId", "organizationId") REFERENCES "ConnectorInstance"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConnectorDataPermission_organizationId_connectorInstanceId_category_key" ON "ConnectorDataPermission"("organizationId", "connectorInstanceId", "category");
CREATE INDEX "ConnectorDataPermission_organizationId_category_enabled_idx" ON "ConnectorDataPermission"("organizationId", "category", "enabled");

CREATE TABLE "AssistantConnectorDataPermission" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organizationId" UUID NOT NULL,
  "connectorInstanceId" UUID NOT NULL,
  "assistantId" UUID NOT NULL,
  "category" VARCHAR(40) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "updatedById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "AssistantConnectorDataPermission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AssistantConnectorDataPermission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssistantConnectorDataPermission_connectorInstanceId_organizationId_fkey" FOREIGN KEY ("connectorInstanceId", "organizationId") REFERENCES "ConnectorInstance"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AssistantConnectorDataPermission_assistantId_organizationId_fkey" FOREIGN KEY ("assistantId", "organizationId") REFERENCES "Chatbot"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AssistantConnectorDataPermission_organizationId_connectorInstanceId_assistantId_category_key" ON "AssistantConnectorDataPermission"("organizationId", "connectorInstanceId", "assistantId", "category");
CREATE INDEX "AssistantConnectorDataPermission_organizationId_assistantId_category_enabled_idx" ON "AssistantConnectorDataPermission"("organizationId", "assistantId", "category", "enabled");

-- Preserve the existing product and price answer path for already connected stores.
-- Optional/sensitive categories remain denied until an owner explicitly enables them.
ALTER TABLE "KnowledgeSource" ADD COLUMN "connectorInstanceId" UUID;
ALTER TABLE "KnowledgeSource" ADD COLUMN "connectorDataCategory" VARCHAR(40);
CREATE INDEX "KnowledgeSource_organizationId_connectorInstanceId_connectorDataCategory_idx" ON "KnowledgeSource"("organizationId", "connectorInstanceId", "connectorDataCategory");
INSERT INTO "ConnectorDataPermission" ("organizationId", "connectorInstanceId", "category", "enabled", "syncEnabled", "updatedAt")
SELECT c."organizationId", c."id", p.category, true, true, CURRENT_TIMESTAMP
FROM "ConnectorInstance" c
CROSS JOIN (VALUES ('PRODUCTS'), ('PRICES'), ('CATEGORIES')) AS p(category)
WHERE c."state" = 'CONNECTED' AND c."verifiedCapabilities" @> '["PRODUCT_CATALOG"]'::jsonb
ON CONFLICT ("organizationId", "connectorInstanceId", "category") DO NOTHING;

INSERT INTO "AssistantConnectorDataPermission" ("organizationId", "connectorInstanceId", "assistantId", "category", "enabled", "updatedAt")
SELECT c."organizationId", c."id", a."id", p.category, true, CURRENT_TIMESTAMP
FROM "ConnectorInstance" c
JOIN "Chatbot" a ON a."organizationId" = c."organizationId" AND a."status" = 'ACTIVE' AND a."archivedAt" IS NULL
CROSS JOIN (VALUES ('PRODUCTS'), ('PRICES'), ('CATEGORIES')) AS p(category)
WHERE c."state" = 'CONNECTED' AND c."verifiedCapabilities" @> '["PRODUCT_CATALOG"]'::jsonb
ON CONFLICT ("organizationId", "connectorInstanceId", "assistantId", "category") DO NOTHING;
