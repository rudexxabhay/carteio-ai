ALTER TABLE "Chatbot"
  DROP CONSTRAINT "Chatbot_aiProvider_supported_check";

ALTER TABLE "Chatbot"
  ADD CONSTRAINT "Chatbot_aiProvider_supported_check"
  CHECK ("aiProvider" IS NULL OR "aiProvider" IN ('groq', 'gemini', 'openai'));
