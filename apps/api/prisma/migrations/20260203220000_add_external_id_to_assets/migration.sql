-- Add external_id to assets and align indexes with schema.prisma
ALTER TABLE "assets" ADD COLUMN "external_id" TEXT NOT NULL;

CREATE INDEX "assets_external_id_idx" ON "assets"("external_id");

CREATE UNIQUE INDEX "assets_source_id_external_id_key" ON "assets"("source_id", "external_id");
