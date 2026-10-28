-- Preserve what each authorization request asked Shopify to grant.
-- This is audit/display metadata only; it never establishes actual grants.
ALTER TABLE "ShopifyOAuthState"
ADD COLUMN "requestedScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
