-- Remove SPAM detector type and add TEXT_CLASSIFICATION.
-- SPAM was replaced by the generic TextClassificationDetector backed by the
-- HuggingFace text-classification pipeline. No production findings expected.

-- 1. Delete any findings that used SPAM (green-field — no real data expected).
DELETE FROM "findings" WHERE "detector_type" = 'SPAM';

-- 2. Recreate DetectorType enum without SPAM, with TEXT_CLASSIFICATION added.
--    PostgreSQL does not support DROP VALUE / ADD VALUE to an existing enum used
--    in a table column, so rename and replace.
ALTER TYPE "DetectorType" RENAME TO "DetectorType_old";

CREATE TYPE "DetectorType" AS ENUM (
  'SECRETS',
  'PII',
  'TOXIC',
  'IMAGE_CLASSIFICATION',
  'TEXT_CLASSIFICATION',
  'YARA',
  'BROKEN_LINKS',
  'LANGUAGE',
  'CODE_SECURITY',
  'CUSTOM'
);

-- 3. Migrate the findings table column to the new type.
ALTER TABLE "findings"
  ALTER COLUMN "detector_type" TYPE "DetectorType"
  USING "detector_type"::text::"DetectorType";

-- 4. Drop the old enum.
DROP TYPE "DetectorType_old";
