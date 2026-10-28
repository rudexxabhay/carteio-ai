-- Optional per-assistant provider selection. NULL means the owner has not
-- configured a Playground provider yet; no provider is selected implicitly.
ALTER TABLE "Chatbot"
  ADD COLUMN "aiProvider" VARCHAR(20),
  ADD COLUMN "aiModel" VARCHAR(120);

ALTER TABLE "Chatbot"
  ADD CONSTRAINT "Chatbot_aiProvider_supported_check"
  CHECK ("aiProvider" IS NULL OR "aiProvider" IN ('groq', 'openai'));
