ALTER TABLE "Chatbot"
  ADD COLUMN "providerMode" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "providerFallbacks" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "PlaygroundMessage"
  ADD COLUMN "providerUsed" VARCHAR(20),
  ADD COLUMN "modelUsed" VARCHAR(120);
