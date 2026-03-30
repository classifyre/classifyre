-- Align assets table with single_asset_scan_results schema
-- 1) Rename legacy columns
ALTER TABLE "assets" RENAME COLUMN "external_id" TO "hash";
ALTER TABLE "assets" RENAME COLUMN "external_urn" TO "external_url";
ALTER TABLE "assets" RENAME COLUMN "type" TO "source_type";

-- 2) Drop columns no longer part of the normalized asset model
ALTER TABLE "assets" DROP COLUMN "subtype";
ALTER TABLE "assets" DROP COLUMN "preview";

-- 3) Add schema-aligned columns
CREATE TYPE "AssetContentType" AS ENUM ('TXT', 'IMAGE', 'VIDEO', 'AUDIO', 'HTML', 'BINARY', 'OTHER');

ALTER TABLE "assets"
  ADD COLUMN "links" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "asset_type" "AssetContentType" NOT NULL DEFAULT 'OTHER';

-- 4) Recreate indexes and uniqueness constraints with new names
DROP INDEX IF EXISTS "assets_external_id_idx";
DROP INDEX IF EXISTS "assets_external_urn_idx";
DROP INDEX IF EXISTS "assets_type_idx";
DROP INDEX IF EXISTS "assets_source_id_external_id_key";

CREATE INDEX "assets_hash_idx" ON "assets"("hash");
CREATE INDEX "assets_external_url_idx" ON "assets"("external_url");
CREATE INDEX "assets_source_type_idx" ON "assets"("source_type");
CREATE INDEX "assets_asset_type_idx" ON "assets"("asset_type");
CREATE UNIQUE INDEX "assets_source_id_hash_key" ON "assets"("source_id", "hash");
