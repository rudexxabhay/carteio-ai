CREATE UNIQUE INDEX "PlaygroundMessage_organizationId_clientTurnId_key"
  ON "PlaygroundMessage"("organizationId", "clientTurnId");
DROP INDEX "PlaygroundMessage_conversationId_clientTurnId_key";
