-- TRUNCATE existing findings (no production data)
TRUNCATE TABLE "findings" CASCADE;

-- Remove metadata column (no longer needed)
ALTER TABLE "findings" DROP COLUMN IF EXISTS "metadata";

-- Add detection identity column
ALTER TABLE "findings" ADD COLUMN "detection_identity" VARCHAR(64) NOT NULL;

-- Add history tracking
ALTER TABLE "findings" ADD COLUMN "history" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Add timestamps
ALTER TABLE "findings" ADD COLUMN "first_detected_at" TIMESTAMP(3);
ALTER TABLE "findings" ADD COLUMN "last_detected_at" TIMESTAMP(3);
ALTER TABLE "findings" ADD COLUMN "resolved_at" TIMESTAMP(3);

-- Add resolution reason
ALTER TABLE "findings" ADD COLUMN "resolution_reason" TEXT;

-- Create indexes
CREATE UNIQUE INDEX "findings_detection_identity_key" ON "findings"("detection_identity");
CREATE INDEX "findings_detection_identity_status_idx" ON "findings"("detection_identity", "status");
CREATE INDEX "findings_history_idx" ON "findings" USING GIN ("history");
CREATE INDEX "findings_first_detected_at_idx" ON "findings"("first_detected_at");
CREATE INDEX "findings_last_detected_at_idx" ON "findings"("last_detected_at");
CREATE INDEX "findings_resolved_at_idx" ON "findings"("resolved_at") WHERE "resolved_at" IS NOT NULL;

-- Drop old indexes that are redundant with new composite index
DROP INDEX IF EXISTS "findings_detectedAt_idx";
DROP INDEX IF EXISTS "findings_sourceId_severity_idx";
DROP INDEX IF EXISTS "findings_assetId_detectorType_idx";
