-- Draft versions bind typed customer confirmation to the exact displayed payload.
-- Authored only; do not apply before review and approval.
ALTER TABLE "TicketDraft" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SupportConversation" ADD COLUMN "activeRequestId" UUID;
ALTER TABLE "SupportConversation" ADD COLUMN "activeRequestUntil" TIMESTAMPTZ(3);
ALTER TABLE "SupportMessage" ADD COLUMN "responseCategory" VARCHAR(64);
ALTER TABLE "SupportMessage" ADD COLUMN "answerOrigin" VARCHAR(40);
