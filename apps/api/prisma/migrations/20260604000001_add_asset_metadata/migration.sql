-- Add normalized source-specific metadata to assets.
ALTER TABLE "assets" ADD COLUMN "metadata" JSONB;
CREATE INDEX "assets_metadata_idx" ON "assets" USING GIN ("metadata");
