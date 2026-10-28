CREATE TABLE "ConnectorSyncSchedule" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "connectorInstanceId" UUID NOT NULL,
  "resourceType" VARCHAR(64) NOT NULL,
  "mode" "ConnectorSyncMode" NOT NULL DEFAULT 'INCREMENTAL',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 1440,
  "nextRunAt" TIMESTAMPTZ(3),
  "lastRunAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectorSyncSchedule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorSyncSchedule_intervalMinutes_check" CHECK ("intervalMinutes" >= 60 AND "intervalMinutes" <= 10080),
  CONSTRAINT "ConnectorSyncSchedule_organizationId_connectorInstanceId_resourceType_key" UNIQUE ("organizationId", "connectorInstanceId", "resourceType"),
  CONSTRAINT "ConnectorSyncSchedule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ConnectorSyncSchedule_connectorInstanceId_organizationId_fkey" FOREIGN KEY ("connectorInstanceId", "organizationId") REFERENCES "ConnectorInstance"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConnectorSyncSchedule_enabled_paused_nextRunAt_id_idx" ON "ConnectorSyncSchedule"("enabled", "paused", "nextRunAt", "id");
CREATE INDEX "ConnectorSyncSchedule_organizationId_connectorInstanceId_enabled_idx" ON "ConnectorSyncSchedule"("organizationId", "connectorInstanceId", "enabled");
