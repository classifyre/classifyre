-- Remove the four standalone transformer detector types.
-- TEXT_CLASSIFICATION, IMAGE_CLASSIFICATION, FEATURE_EXTRACTION, and OBJECT_DETECTION
-- are now implemented as custom detectors with a pipeline_schema (type: "TEXT_CLASSIFICATION"
-- etc.) rather than as standalone built-in detector types. Users who want to run these
-- models create a CustomDetector and pick the appropriate pipeline schema type.
--
-- Any existing findings stored under these detector types are deleted. These types were
-- only added recently and no production data is expected; transformer pipeline detectors
-- require model downloads and would not have produced findings in a default deployment.

-- 1. Delete any findings that used the removed detector types.
DELETE FROM "findings"
WHERE "detector_type"::text IN (
  'TEXT_CLASSIFICATION',
  'IMAGE_CLASSIFICATION',
  'FEATURE_EXTRACTION',
  'OBJECT_DETECTION'
);

-- 2. Recreate the DetectorType enum without the four removed values.
--    PostgreSQL does not support DROP VALUE, so we rename + replace.
ALTER TYPE "DetectorType" RENAME TO "DetectorType_old";

CREATE TYPE "DetectorType" AS ENUM (
  'SECRETS',
  'PII',
  'TOXIC',
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
