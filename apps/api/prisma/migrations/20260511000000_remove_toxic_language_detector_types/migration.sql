-- Remove TOXIC and LANGUAGE detector types.
-- These detectors were never used in production and their libraries are being removed.

-- 1. Delete any findings that used the removed detector types.
DELETE FROM "findings"
WHERE "detector_type"::text IN (
  'TOXIC',
  'LANGUAGE'
);

-- 2. Recreate the DetectorType enum without the removed values.
--    PostgreSQL does not support DROP VALUE, so we rename + replace.
ALTER TYPE "DetectorType" RENAME TO "DetectorType_old";

CREATE TYPE "DetectorType" AS ENUM (
  'SECRETS',
  'PII',
  'YARA',
  'BROKEN_LINKS',
  'CODE_SECURITY',
  'CUSTOM'
);

-- 3. Migrate the findings table column to the new type.
ALTER TABLE "findings"
  ALTER COLUMN "detector_type" TYPE "DetectorType"
  USING "detector_type"::text::"DetectorType";

-- 4. Drop the old enum.
DROP TYPE "DetectorType_old";
