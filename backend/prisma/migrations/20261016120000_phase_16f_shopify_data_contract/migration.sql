ALTER TABLE "CommerceProduct"
  ADD COLUMN "productType" VARCHAR(200),
  ADD COLUMN "taxonomyCategoryId" VARCHAR(255),
  ADD COLUMN "taxonomyCategory" VARCHAR(500),
  ADD COLUMN "collections" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "collectionSearchTerms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "vendor" VARCHAR(200),
  ADD COLUMN "handle" VARCHAR(255),
  ADD COLUMN "compareAtPrice" DECIMAL(18,4),
  ADD COLUMN "createdAtSource" TIMESTAMPTZ(3),
  ADD COLUMN "imageAltText" VARCHAR(500),
  ADD COLUMN "imageWidth" INTEGER,
  ADD COLUMN "imageHeight" INTEGER,
  ADD COLUMN "imageEvidence" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "CommerceProductVariant"
  ADD COLUMN "compareAtPrice" DECIMAL(18,4),
  ADD COLUMN "selectedOptions" JSONB;
