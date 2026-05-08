-- Remove PROMPT_INJECTION detector type. The detector was powered by a
-- heavyweight HuggingFace model (protectai/deberta-v3-base-prompt-injection-v2)
-- that added a large optional dependency footprint. No production findings exist.

-- 1. Delete any findings that used this type (green-field — no real data expected).
DELETE FROM "findings" WHERE "detector_type" = 'PROMPT_INJECTION';

-- 2. Recreate DetectorType enum without PROMPT_INJECTION.
--    PostgreSQL does not support DROP VALUE, so rename and replace.
ALTER TYPE "DetectorType" RENAME TO "DetectorType_old";

CREATE TYPE "DetectorType" AS ENUM (
  'SECRETS',
  'PII',
  'TOXIC',
  'NSFW',
  'YARA',
  'BROKEN_LINKS',
  'SPAM',
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
