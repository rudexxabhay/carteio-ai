-- Phase 16: associate provider connectors with the existing normalized commerce
-- connection records and persist one-time, tenant-bound Shopify OAuth state.
ALTER TABLE "ConnectorInstance"
  ADD COLUMN "integrationConnectionId" UUID;

ALTER TABLE "CommerceProduct"
  ADD COLUMN "availabilityStatus" VARCHAR(40);

ALTER TABLE "CommerceProductVariant"
  ADD COLUMN "availabilityStatus" VARCHAR(40);

ALTER TABLE "CommerceOrder"
  ADD COLUMN "externalUpdatedAt" TIMESTAMPTZ(3);

CREATE INDEX "CommerceProduct_organizationId_connectionId_externalUpdatedAt_idx"
  ON "CommerceProduct"("organizationId", "connectionId", "externalUpdatedAt");

CREATE INDEX "CommerceOrder_organizationId_connectionId_externalUpdatedAt_idx"
  ON "CommerceOrder"("organizationId", "connectionId", "externalUpdatedAt");

CREATE UNIQUE INDEX "ConnectorInstance_integrationConnectionId_key"
  ON "ConnectorInstance"("integrationConnectionId");

CREATE UNIQUE INDEX "ConnectorInstance_integrationConnectionId_organizationId_key"
  ON "ConnectorInstance"("integrationConnectionId", "organizationId");

ALTER TABLE "ConnectorInstance"
  ADD CONSTRAINT "ConnectorInstance_integrationConnectionId_organizationId_fkey"
  FOREIGN KEY ("integrationConnectionId", "organizationId")
  REFERENCES "IntegrationConnection"("id", "organizationId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ShopifyOAuthState" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "connectorInstanceId" UUID NOT NULL,
  "shopDomain" VARCHAR(253) NOT NULL,
  "stateHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "consumedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShopifyOAuthState_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShopifyOAuthState_stateHash_key" UNIQUE ("stateHash"),
  CONSTRAINT "ShopifyOAuthState_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ShopifyOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ShopifyOAuthState_connectorInstanceId_organizationId_fkey" FOREIGN KEY ("connectorInstanceId", "organizationId") REFERENCES "ConnectorInstance"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ShopifyOAuthState_organizationId_connectorInstanceId_expiresAt_idx"
  ON "ShopifyOAuthState"("organizationId", "connectorInstanceId", "expiresAt");
CREATE INDEX "ShopifyOAuthState_expiresAt_idx"
  ON "ShopifyOAuthState"("expiresAt");
