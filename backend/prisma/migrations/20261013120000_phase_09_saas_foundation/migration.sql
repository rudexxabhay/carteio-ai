-- Additive Phase 09 SaaS foundation. This file is authored only; it has not been applied.
CREATE TYPE "IntegrationPlatform" AS ENUM ('SHOPIFY', 'WOOCOMMERCE', 'WORDPRESS', 'CUSTOM_API', 'STATIC_WEBSITE');
CREATE TYPE "IntegrationConnectionState" AS ENUM ('DRAFT', 'PENDING_VERIFICATION', 'CONNECTED', 'SYNCING', 'CONNECTED_WITH_WARNINGS', 'ERROR', 'DISCONNECTED', 'REVOKED');
CREATE TYPE "CommerceSyncState" AS ENUM ('PENDING', 'SYNCING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "PlatformRole" AS ENUM ('SUPPORT', 'OPERATIONS', 'ADMIN');
CREATE TYPE "SubscriptionState" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'SETUP_REQUIRED');

ALTER TABLE "Organization" ADD COLUMN "timezone" VARCHAR(80) NOT NULL DEFAULT 'UTC';
ALTER TABLE "Organization" ADD COLUMN "locale" VARCHAR(35) NOT NULL DEFAULT 'en';

CREATE TABLE "IntegrationConnection" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "platform" "IntegrationPlatform" NOT NULL,
  "displayName" VARCHAR(200) NOT NULL,
  "siteUrl" VARCHAR(2048),
  "externalAccountId" VARCHAR(255),
  "state" "IntegrationConnectionState" NOT NULL DEFAULT 'DRAFT',
  "secretReference" VARCHAR(512),
  "grantedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "lastErrorCode" VARCHAR(100),
  "lastSyncAt" TIMESTAMPTZ(3),
  "lastSuccessfulSyncAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "IntegrationConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "IntegrationConnection_id_organizationId_key" ON "IntegrationConnection"("id", "organizationId");
CREATE INDEX "IntegrationConnection_organizationId_state_updatedAt_idx" ON "IntegrationConnection"("organizationId", "state", "updatedAt");
CREATE INDEX "IntegrationConnection_organizationId_platform_createdAt_idx" ON "IntegrationConnection"("organizationId", "platform", "createdAt");

CREATE TABLE "CommerceSyncJob" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "resourceType" VARCHAR(40) NOT NULL,
  "state" "CommerceSyncState" NOT NULL DEFAULT 'PENDING',
  "cursor" VARCHAR(2048),
  "errorCode" VARCHAR(100),
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CommerceSyncJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceSyncJob_connectionId_organizationId_fkey" FOREIGN KEY ("connectionId", "organizationId") REFERENCES "IntegrationConnection"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "CommerceSyncJob_organizationId_connectionId_createdAt_idx" ON "CommerceSyncJob"("organizationId", "connectionId", "createdAt");
CREATE INDEX "CommerceSyncJob_state_createdAt_idx" ON "CommerceSyncJob"("state", "createdAt");

CREATE TABLE "CommerceProduct" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "externalId" VARCHAR(255) NOT NULL,
  "name" VARCHAR(500) NOT NULL,
  "description" TEXT,
  "sku" VARCHAR(160),
  "category" VARCHAR(200),
  "currency" CHAR(3),
  "price" DECIMAL(18,4),
  "inventory" INTEGER,
  "rawStatus" VARCHAR(80),
  "productUrl" VARCHAR(2048),
  "imageUrl" VARCHAR(2048),
  "externalUpdatedAt" TIMESTAMPTZ(3),
  "syncedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CommerceProduct_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceProduct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommerceProduct_connectionId_organizationId_fkey" FOREIGN KEY ("connectionId", "organizationId") REFERENCES "IntegrationConnection"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommerceProduct_connectionId_externalId_key" ON "CommerceProduct"("connectionId", "externalId");
CREATE INDEX "CommerceProduct_organizationId_name_idx" ON "CommerceProduct"("organizationId", "name");
CREATE INDEX "CommerceProduct_organizationId_sku_idx" ON "CommerceProduct"("organizationId", "sku");
CREATE INDEX "CommerceProduct_organizationId_category_rawStatus_idx" ON "CommerceProduct"("organizationId", "category", "rawStatus");
CREATE INDEX "CommerceProduct_organizationId_syncedAt_idx" ON "CommerceProduct"("organizationId", "syncedAt");

CREATE TABLE "CommerceProductVariant" (
  "id" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "externalId" VARCHAR(255) NOT NULL,
  "title" VARCHAR(500) NOT NULL,
  "sku" VARCHAR(160),
  "currency" CHAR(3),
  "price" DECIMAL(18,4),
  "inventory" INTEGER,
  "rawStatus" VARCHAR(80),
  CONSTRAINT "CommerceProductVariant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "CommerceProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommerceProductVariant_productId_externalId_key" ON "CommerceProductVariant"("productId", "externalId");
CREATE INDEX "CommerceProductVariant_sku_idx" ON "CommerceProductVariant"("sku");

CREATE TABLE "CommerceOrder" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "externalId" VARCHAR(255) NOT NULL,
  "displayReference" VARCHAR(160),
  "customerReference" VARCHAR(255),
  "financialStatus" VARCHAR(80),
  "fulfillmentStatus" VARCHAR(80),
  "currency" CHAR(3),
  "subtotal" DECIMAL(18,4),
  "discountTotal" DECIMAL(18,4),
  "shippingTotal" DECIMAL(18,4),
  "taxTotal" DECIMAL(18,4),
  "total" DECIMAL(18,4),
  "refundedTotal" DECIMAL(18,4),
  "orderedAt" TIMESTAMPTZ(3),
  "rawStatus" VARCHAR(100),
  "syncedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CommerceOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CommerceOrder_connectionId_organizationId_fkey" FOREIGN KEY ("connectionId", "organizationId") REFERENCES "IntegrationConnection"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommerceOrder_connectionId_externalId_key" ON "CommerceOrder"("connectionId", "externalId");
CREATE INDEX "CommerceOrder_organizationId_orderedAt_idx" ON "CommerceOrder"("organizationId", "orderedAt");
CREATE INDEX "CommerceOrder_organizationId_financialStatus_fulfillmentStatus_orderedAt_idx" ON "CommerceOrder"("organizationId", "financialStatus", "fulfillmentStatus", "orderedAt");
CREATE INDEX "CommerceOrder_organizationId_displayReference_idx" ON "CommerceOrder"("organizationId", "displayReference");

CREATE TABLE "CommerceOrderLine" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "externalId" VARCHAR(255) NOT NULL,
  "productExternalId" VARCHAR(255),
  "name" VARCHAR(500) NOT NULL,
  "sku" VARCHAR(160),
  "quantity" INTEGER NOT NULL,
  "currency" CHAR(3),
  "unitPrice" DECIMAL(18,4),
  "total" DECIMAL(18,4),
  CONSTRAINT "CommerceOrderLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommerceOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CommerceOrderLine_orderId_externalId_key" ON "CommerceOrderLine"("orderId", "externalId");
CREATE INDEX "CommerceOrderLine_productExternalId_idx" ON "CommerceOrderLine"("productExternalId");

CREATE TABLE "Plan" (
  "id" UUID NOT NULL,
  "key" VARCHAR(64) NOT NULL,
  "displayName" VARCHAR(120) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "priceMinor" INTEGER,
  "currency" CHAR(3),
  "interval" VARCHAR(20),
  "entitlements" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Plan_key_key" ON "Plan"("key");

CREATE TABLE "WorkspaceSubscription" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "planId" UUID NOT NULL,
  "state" "SubscriptionState" NOT NULL DEFAULT 'SETUP_REQUIRED',
  "provider" VARCHAR(60),
  "externalId" VARCHAR(255),
  "currentPeriodStart" TIMESTAMPTZ(3),
  "currentPeriodEnd" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "WorkspaceSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkspaceSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkspaceSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "WorkspaceSubscription_organizationId_state_updatedAt_idx" ON "WorkspaceSubscription"("organizationId", "state", "updatedAt");

CREATE TABLE "UsageLedgerEntry" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "metric" VARCHAR(80) NOT NULL,
  "quantity" DECIMAL(18,6) NOT NULL,
  "provider" VARCHAR(40),
  "source" VARCHAR(40) NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UsageLedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsageLedgerEntry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UsageLedgerEntry_organizationId_idempotencyKey_key" ON "UsageLedgerEntry"("organizationId", "idempotencyKey");
CREATE INDEX "UsageLedgerEntry_organizationId_metric_occurredAt_idx" ON "UsageLedgerEntry"("organizationId", "metric", "occurredAt");

CREATE TABLE "PlatformOperator" (
  "userId" UUID NOT NULL,
  "role" "PlatformRole" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformOperator_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "PlatformOperator_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PlatformAuditEvent" (
  "id" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "action" VARCHAR(120) NOT NULL,
  "entityType" VARCHAR(80) NOT NULL,
  "entityId" VARCHAR(128),
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformAuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PlatformAuditEvent_actorUserId_createdAt_idx" ON "PlatformAuditEvent"("actorUserId", "createdAt");
CREATE INDEX "PlatformAuditEvent_entityType_entityId_createdAt_idx" ON "PlatformAuditEvent"("entityType", "entityId", "createdAt");

CREATE TYPE "InboxConversationState" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'CLOSED');
CREATE TYPE "InboxMessageKind" AS ENUM ('CUSTOMER', 'AI', 'HUMAN', 'INTERNAL_NOTE', 'SYSTEM');
CREATE TYPE "WorkflowExecutionState" AS ENUM ('PROPOSED', 'AWAITING_APPROVAL', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "WorkflowStepState" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

CREATE TABLE "SupportConversation" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "assistantId" UUID NOT NULL,
  "externalSessionHash" CHAR(64) NOT NULL,
  "channel" VARCHAR(32) NOT NULL,
  "state" "InboxConversationState" NOT NULL DEFAULT 'OPEN',
  "assignedToUserId" UUID,
  "lastMessageAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SupportConversation_assistantId_organizationId_fkey" FOREIGN KEY ("assistantId", "organizationId") REFERENCES "Chatbot"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportConversation_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SupportConversation_organizationId_assistantId_externalSessionHash_key" ON "SupportConversation"("organizationId", "assistantId", "externalSessionHash");
CREATE UNIQUE INDEX "SupportConversation_id_organizationId_key" ON "SupportConversation"("id", "organizationId");
CREATE INDEX "SupportConversation_organizationId_state_lastMessageAt_idx" ON "SupportConversation"("organizationId", "state", "lastMessageAt");
CREATE INDEX "SupportConversation_organizationId_assistantId_state_lastMessageAt_idx" ON "SupportConversation"("organizationId", "assistantId", "state", "lastMessageAt");
CREATE INDEX "SupportConversation_assignedToUserId_state_lastMessageAt_idx" ON "SupportConversation"("assignedToUserId", "state", "lastMessageAt");

CREATE TABLE "SupportMessage" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "authorUserId" UUID,
  "kind" "InboxMessageKind" NOT NULL,
  "content" TEXT NOT NULL,
  "provider" VARCHAR(40),
  "model" VARCHAR(120),
  "sourceRefs" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupportMessage_conversationId_organizationId_fkey" FOREIGN KEY ("conversationId", "organizationId") REFERENCES "SupportConversation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SupportMessage_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "SupportMessage_organizationId_conversationId_createdAt_idx" ON "SupportMessage"("organizationId", "conversationId", "createdAt");

CREATE TABLE "WorkflowExecution" (
  "id" UUID NOT NULL,
  "organizationId" UUID NOT NULL,
  "assistantId" UUID NOT NULL,
  "requestedBy" UUID,
  "idempotencyKey" VARCHAR(160) NOT NULL,
  "actionKey" VARCHAR(100) NOT NULL,
  "argumentHash" CHAR(64) NOT NULL,
  "state" "WorkflowExecutionState" NOT NULL DEFAULT 'PROPOSED',
  "stepLimit" INTEGER NOT NULL DEFAULT 8,
  "deadlineAt" TIMESTAMPTZ(3) NOT NULL,
  "safeResult" JSONB,
  "errorCode" VARCHAR(100),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "WorkflowExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkflowExecution_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkflowExecution_assistantId_organizationId_fkey" FOREIGN KEY ("assistantId", "organizationId") REFERENCES "Chatbot"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkflowExecution_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkflowExecution_organizationId_idempotencyKey_key" ON "WorkflowExecution"("organizationId", "idempotencyKey");
CREATE UNIQUE INDEX "WorkflowExecution_id_organizationId_key" ON "WorkflowExecution"("id", "organizationId");
CREATE INDEX "WorkflowExecution_organizationId_state_createdAt_idx" ON "WorkflowExecution"("organizationId", "state", "createdAt");
CREATE INDEX "WorkflowExecution_deadlineAt_state_idx" ON "WorkflowExecution"("deadlineAt", "state");

CREATE TABLE "WorkflowStep" (
  "id" UUID NOT NULL,
  "executionId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "toolKey" VARCHAR(100) NOT NULL,
  "state" "WorkflowStepState" NOT NULL DEFAULT 'PENDING',
  "safeInput" JSONB NOT NULL,
  "safeOutput" JSONB,
  "errorCode" VARCHAR(100),
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkflowStep_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "WorkflowExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkflowStep_executionId_sequence_key" ON "WorkflowStep"("executionId", "sequence");
CREATE INDEX "WorkflowStep_state_createdAt_idx" ON "WorkflowStep"("state", "createdAt");

CREATE TABLE "WorkflowApproval" (
  "id" UUID NOT NULL,
  "executionId" UUID NOT NULL,
  "argumentHash" CHAR(64) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "approvedById" UUID,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "decidedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkflowApproval_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "WorkflowExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkflowApproval_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkflowApproval_executionId_key" ON "WorkflowApproval"("executionId");
CREATE INDEX "WorkflowApproval_status_expiresAt_idx" ON "WorkflowApproval"("status", "expiresAt");
