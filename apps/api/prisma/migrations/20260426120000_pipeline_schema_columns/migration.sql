-- Replace method+config on custom_detectors with a single pipeline_schema JSONB column.
-- Replace extraction_method+field_count+populated_fields+extracted_data on
-- custom_detector_extractions with a single pipeline_result JSONB column.

-- ─── custom_detectors ────────────────────────────────────────────────────────

-- 1. Add pipeline_schema with a temporary default so existing rows are valid.
ALTER TABLE "custom_detectors"
  ADD COLUMN IF NOT EXISTS "pipeline_schema" JSONB;

-- 2. Backfill: wrap existing method+config into the new pipeline_schema shape.
--    GLINER2 is the only type that existed before this migration.
UPDATE "custom_detectors"
SET "pipeline_schema" = jsonb_build_object(
  'type',   'GLINER2',
  'entities',       COALESCE("config"->'entities', '[]'::jsonb),
  'classification', COALESCE("config"->'classification', '{}'::jsonb),
  'validation',     COALESCE("config"->'validation', '{}'::jsonb)
)
WHERE "pipeline_schema" IS NULL;

-- 3. Make the column NOT NULL now that every row is populated.
ALTER TABLE "custom_detectors"
  ALTER COLUMN "pipeline_schema" SET NOT NULL;

-- 4. Drop old columns and the method index.
DROP INDEX IF EXISTS "custom_detectors_method_idx";

ALTER TABLE "custom_detectors"
  DROP COLUMN IF EXISTS "method",
  DROP COLUMN IF EXISTS "config";

-- 5. Drop the CustomDetectorMethod enum (no longer referenced).
DROP TYPE IF EXISTS "CustomDetectorMethod";

-- ─── custom_detector_extractions ─────────────────────────────────────────────

-- 6. Add pipeline_result with a temporary default.
ALTER TABLE "custom_detector_extractions"
  ADD COLUMN IF NOT EXISTS "pipeline_result" JSONB;

-- 7. Backfill: wrap extracted_data into the new pipeline_result shape.
UPDATE "custom_detector_extractions"
SET "pipeline_result" = jsonb_build_object(
  'entities',       '[]'::jsonb,
  'classification', '{}'::jsonb,
  'metadata',       jsonb_build_object(
    'runner',            COALESCE("extraction_method", 'GLINER2'),
    'migrated_from',     'extracted_data'
  ),
  'extracted_data', COALESCE("extracted_data", '{}'::jsonb)
)
WHERE "pipeline_result" IS NULL;

-- 8. Make pipeline_result NOT NULL.
ALTER TABLE "custom_detector_extractions"
  ALTER COLUMN "pipeline_result" SET NOT NULL;

-- 9. Drop the GIN index on extracted_data before dropping the column.
DROP INDEX IF EXISTS "custom_detector_extractions_extracted_data_gin_idx";

-- 10. Drop old columns.
ALTER TABLE "custom_detector_extractions"
  DROP COLUMN IF EXISTS "extraction_method",
  DROP COLUMN IF EXISTS "field_count",
  DROP COLUMN IF EXISTS "populated_fields",
  DROP COLUMN IF EXISTS "extracted_data";

-- 11. Add a GIN index on the new column for JSONB queries.
CREATE INDEX IF NOT EXISTS "custom_detector_extractions_pipeline_result_gin_idx"
  ON "custom_detector_extractions" USING GIN ("pipeline_result");
