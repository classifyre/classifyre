-- Add FEATURE_EXTRACTION and OBJECT_DETECTION detector types.
-- These are new generic HuggingFace pipeline detectors — no existing findings
-- use these types, so no data migration is needed.

-- Recreate DetectorType enum with both new values.
-- PostgreSQL does not support ADD VALUE inside a transaction, so rename + replace.
ALTER TYPE "DetectorType" RENAME TO "DetectorType_old";

CREATE TYPE "DetectorType" AS ENUM (
  'SECRETS',
  'PII',
  'TOXIC',
  'IMAGE_CLASSIFICATION',
  'TEXT_CLASSIFICATION',
  'FEATURE_EXTRACTION',
  'OBJECT_DETECTION',
  'YARA',
  'BROKEN_LINKS',
  'LANGUAGE',
  'CODE_SECURITY',
  'CUSTOM'
);

-- Migrate the findings table column to the new type.
ALTER TABLE "findings"
  ALTER COLUMN "detector_type" TYPE "DetectorType"
  USING "detector_type"::text::"DetectorType";

-- Drop the old enum.
DROP TYPE "DetectorType_old";
