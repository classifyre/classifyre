-- Denormalized copy of asset metadata for convenient runner-asset display.
ALTER TABLE "runner_assets" ADD COLUMN "metadata" JSONB;
CREATE INDEX "runner_assets_metadata_idx" ON "runner_assets" USING GIN ("metadata");
