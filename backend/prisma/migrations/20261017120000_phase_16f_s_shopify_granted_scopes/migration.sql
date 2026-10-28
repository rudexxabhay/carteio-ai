ALTER TABLE "IntegrationConnection"
  ADD COLUMN "grantedScopeMetadata" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "grantedScopesVerifiedAt" TIMESTAMPTZ(3);
