CREATE TABLE "custom_detector_extractions" (
    "id" TEXT NOT NULL,
    "finding_id" TEXT NOT NULL,
    "custom_detector_id" TEXT,
    "custom_detector_key" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "runner_id" TEXT,
    "extraction_method" TEXT NOT NULL,
    "detector_version" INTEGER NOT NULL DEFAULT 1,
    "field_count" INTEGER NOT NULL DEFAULT 0,
    "populated_fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "extracted_data" JSONB NOT NULL,
    "extracted_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_detector_extractions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "custom_detector_extractions_finding_id_key" ON "custom_detector_extractions"("finding_id");
CREATE INDEX "custom_detector_extractions_custom_detector_key_idx" ON "custom_detector_extractions"("custom_detector_key");
CREATE INDEX "custom_detector_extractions_custom_detector_id_idx" ON "custom_detector_extractions"("custom_detector_id");
CREATE INDEX "custom_detector_extractions_source_id_idx" ON "custom_detector_extractions"("source_id");
CREATE INDEX "custom_detector_extractions_asset_id_idx" ON "custom_detector_extractions"("asset_id");
CREATE INDEX "custom_detector_extractions_runner_id_idx" ON "custom_detector_extractions"("runner_id");
CREATE INDEX "custom_detector_extractions_extracted_data_gin_idx" ON "custom_detector_extractions" USING GIN ("extracted_data");

ALTER TABLE "custom_detector_extractions" ADD CONSTRAINT "custom_detector_extractions_finding_id_fkey"
    FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_detector_extractions" ADD CONSTRAINT "custom_detector_extractions_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_detector_extractions" ADD CONSTRAINT "custom_detector_extractions_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "custom_detector_extractions" ADD CONSTRAINT "custom_detector_extractions_custom_detector_id_fkey"
    FOREIGN KEY ("custom_detector_id") REFERENCES "custom_detectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
