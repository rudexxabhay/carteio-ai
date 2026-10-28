-- Additive lease and retry metadata for the Phase 12 durable ticket outbox.
-- Authored only; apply after review and approval.
ALTER TYPE "OutboundDeliveryState" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TABLE "OutboundDelivery"
  ADD COLUMN "leaseToken" VARCHAR(64),
  ADD COLUMN "leaseUntil" TIMESTAMPTZ(3),
  ADD COLUMN "permanentFailure" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "OutboundDeliveryAttempt"
  ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "completedAt" TIMESTAMPTZ(3);
CREATE INDEX "OutboundDelivery_state_leaseUntil_createdAt_idx"
  ON "OutboundDelivery"("state", "leaseUntil", "createdAt");
CREATE INDEX "OutboundDelivery_state_channel_createdAt_idx"
  ON "OutboundDelivery"("state", "channel", "createdAt");
ALTER TABLE "OutboundDelivery"
  ADD COLUMN "sentAt" TIMESTAMPTZ(3),
  ADD COLUMN "deliveredAt" TIMESTAMPTZ(3),
  ADD COLUMN "failedAt" TIMESTAMPTZ(3);
