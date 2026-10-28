CREATE TYPE "ConnectorInstanceState" AS ENUM ('DRAFT', 'CONNECTING', 'CONNECTED', 'DEGRADED', 'ERROR', 'DISCONNECTED');
CREATE TYPE "ConnectorSyncJobState" AS ENUM ('PENDING', 'RUNNING', 'RETRY_WAIT', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "ConnectorSyncMode" AS ENUM ('FULL', 'INCREMENTAL');
CREATE TYPE "ConnectorWebhookState" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');

CREATE TABLE "ConnectorInstance" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "connectorId" VARCHAR(80) NOT NULL,
  "connectorType" VARCHAR(40) NOT NULL,
  "connectorVersion" VARCHAR(32) NOT NULL,
  "displayName" VARCHAR(160) NOT NULL,
  "configuration" JSONB NOT NULL,
  "state" "ConnectorInstanceState" NOT NULL DEFAULT 'DRAFT',
  "verifiedCapabilities" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "webhookPublicId" VARCHAR(64),
  "lastVerifiedAt" TIMESTAMPTZ(3),
  "lastErrorCode" VARCHAR(100),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ConnectorInstance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorInstance_id_organizationId_key" UNIQUE ("id", "organizationId"),
  CONSTRAINT "ConnectorInstance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ConnectorInstance_webhookPublicId_key" ON "ConnectorInstance"("webhookPublicId");
CREATE INDEX "ConnectorInstance_organizationId_state_updatedAt_idx" ON "ConnectorInstance"("organizationId", "state", "updatedAt");
CREATE INDEX "ConnectorInstance_organizationId_connectorId_createdAt_idx" ON "ConnectorInstance"("organizationId", "connectorId", "createdAt");

CREATE TABLE "ConnectorCredential" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "connectorInstanceId" UUID NOT NULL,
  "ciphertext" BYTEA NOT NULL,
  "nonce" BYTEA NOT NULL,
  "authTag" BYTEA NOT NULL,
  "keyVersion" VARCHAR(32) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ConnectorCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorCredential_connectorInstanceId_key" UNIQUE ("connectorInstanceId"),
  CONSTRAINT "ConnectorCredential_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ConnectorCredential_connectorInstanceId_organizationId_fkey" FOREIGN KEY ("connectorInstanceId", "organizationId") REFERENCES "ConnectorInstance"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConnectorCredential_organizationId_connectorInstanceId_idx" ON "ConnectorCredential"("organizationId", "connectorInstanceId");
CREATE UNIQUE INDEX "ConnectorCredential_connectorInstanceId_organizationId_key" ON "ConnectorCredential"("connectorInstanceId", "organizationId");

CREATE TABLE "ConnectorSyncJob" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "connectorInstanceId" UUID NOT NULL,
  "resourceType" VARCHAR(64) NOT NULL,
  "mode" "ConnectorSyncMode" NOT NULL,
  "state" "ConnectorSyncJobState" NOT NULL DEFAULT 'PENDING',
  "checkpoint" JSONB,
  "cursor" VARCHAR(2048),
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "scheduledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" VARCHAR(64),
  "leaseUntil" TIMESTAMPTZ(3),
  "lastErrorCode" VARCHAR(100),
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ConnectorSyncJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorSyncJob_organizationId_connectorInstanceId_idempotencyKey_key" UNIQUE ("organizationId", "connectorInstanceId", "idempotencyKey"),
  CONSTRAINT "ConnectorSyncJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ConnectorSyncJob_connectorInstanceId_organizationId_fkey" FOREIGN KEY ("connectorInstanceId", "organizationId") REFERENCES "ConnectorInstance"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConnectorSyncJob_organizationId_connectorInstanceId_createdAt_id_idx" ON "ConnectorSyncJob"("organizationId", "connectorInstanceId", "createdAt", "id");
CREATE INDEX "ConnectorSyncJob_state_scheduledAt_leaseUntil_createdAt_idx" ON "ConnectorSyncJob"("state", "scheduledAt", "leaseUntil", "createdAt");

CREATE TABLE "ConnectorWebhookEvent" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "connectorInstanceId" UUID NOT NULL,
  "externalEventId" VARCHAR(200) NOT NULL,
  "eventType" VARCHAR(120) NOT NULL,
  "rawBodyCiphertext" BYTEA NOT NULL,
  "rawBodyNonce" BYTEA NOT NULL,
  "rawBodyAuthTag" BYTEA NOT NULL,
  "rawBodyKeyVersion" VARCHAR(32) NOT NULL,
  "payloadHash" CHAR(64) NOT NULL,
  "state" "ConnectorWebhookState" NOT NULL DEFAULT 'RECEIVED',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" VARCHAR(64),
  "leaseUntil" TIMESTAMPTZ(3),
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ(3),
  "lastErrorCode" VARCHAR(100),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ConnectorWebhookEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ConnectorWebhookEvent_connectorInstanceId_externalEventId_key" UNIQUE ("connectorInstanceId", "externalEventId"),
  CONSTRAINT "ConnectorWebhookEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ConnectorWebhookEvent_connectorInstanceId_organizationId_fkey" FOREIGN KEY ("connectorInstanceId", "organizationId") REFERENCES "ConnectorInstance"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConnectorWebhookEvent_organizationId_connectorInstanceId_receivedAt_id_idx" ON "ConnectorWebhookEvent"("organizationId", "connectorInstanceId", "receivedAt", "id");
CREATE INDEX "ConnectorWebhookEvent_state_nextAttemptAt_leaseUntil_receivedAt_id_idx" ON "ConnectorWebhookEvent"("state", "nextAttemptAt", "leaseUntil", "receivedAt", "id");
