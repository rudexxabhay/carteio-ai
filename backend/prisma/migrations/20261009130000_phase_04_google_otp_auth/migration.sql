CREATE TABLE "AuthIdentity" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "providerSubject" VARCHAR(255) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AuthIdentity_provider_providerSubject_key" ON "AuthIdentity"("provider", "providerSubject");
CREATE UNIQUE INDEX "AuthIdentity_userId_provider_key" ON "AuthIdentity"("userId", "provider");

CREATE TABLE "EmailOtpChallenge" (
  "id" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "codeHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "consumedAt" TIMESTAMPTZ(3),
  CONSTRAINT "EmailOtpChallenge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailOtpChallenge_email_key" ON "EmailOtpChallenge"("email");
CREATE INDEX "EmailOtpChallenge_expiresAt_idx" ON "EmailOtpChallenge"("expiresAt");
CREATE INDEX "EmailOtpChallenge_consumedAt_createdAt_idx" ON "EmailOtpChallenge"("consumedAt", "createdAt");
