CREATE TABLE "WidgetConfiguration" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "assistantId" UUID NOT NULL,
    "publicId" VARCHAR(32) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "allowedDomains" JSONB NOT NULL DEFAULT '[]',
    "appearance" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "WidgetConfiguration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WidgetConfiguration_assistantId_key" ON "WidgetConfiguration"("assistantId");
CREATE UNIQUE INDEX "WidgetConfiguration_publicId_key" ON "WidgetConfiguration"("publicId");
CREATE UNIQUE INDEX "WidgetConfiguration_id_organizationId_key" ON "WidgetConfiguration"("id", "organizationId");
CREATE UNIQUE INDEX "WidgetConfiguration_assistantId_organizationId_key" ON "WidgetConfiguration"("assistantId", "organizationId");
CREATE INDEX "WidgetConfiguration_organizationId_enabled_idx" ON "WidgetConfiguration"("organizationId", "enabled");
ALTER TABLE "WidgetConfiguration" ADD CONSTRAINT "WidgetConfiguration_assistantId_organizationId_fkey" FOREIGN KEY ("assistantId", "organizationId") REFERENCES "Chatbot"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WidgetConfiguration" ADD CONSTRAINT "WidgetConfiguration_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
