-- Convert assets.asset_type from the AssetContentType enum to a free-form text
-- column holding the catalog asset kind (file, image, page, comment, table, ...).
-- The AssetContentType enum type is retained for other models (SandboxRun).
ALTER TABLE "assets" ALTER COLUMN "asset_type" TYPE TEXT USING "asset_type"::text;
