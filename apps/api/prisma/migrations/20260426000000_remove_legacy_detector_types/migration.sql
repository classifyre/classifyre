-- Remove legacy stub detector types that were never production-ready.
-- These were regex/keyword heuristics or ML models requiring external tokens,
-- replaced by the CustomDetector system (RULESET, CLASSIFIER, ENTITY methods
-- backed by GLiNER2 / mDeBERTa).
--
-- Types removed: PLAGIARISM, IMAGE_VIOLENCE, OCR_PII, DEID_SCORE, HATE_SPEECH,
--   AI_GENERATED, CONTENT_QUALITY, BIAS, DUPLICATE, DOMAIN_CLASS, CONTENT_TYPE,
--   SENSITIVITY_TIER, JURISDICTION_TAG, PHISHING_URL

-- 1. Delete any findings that used these legacy types (stub detectors — no real data expected).
DELETE FROM "findings"
WHERE "detector_type"::text IN (
  'PLAGIARISM',
  'IMAGE_VIOLENCE',
  'OCR_PII',
  'DEID_SCORE',
  'HATE_SPEECH',
  'AI_GENERATED',
  'CONTENT_QUALITY',
  'BIAS',
  'DUPLICATE',
  'DOMAIN_CLASS',
  'CONTENT_TYPE',
  'SENSITIVITY_TIER',
  'JURISDICTION_TAG',
  'PHISHING_URL'
);

-- 2. Recreate the DetectorType enum without the removed values.
--    PostgreSQL does not support DROP VALUE, so we rename and replace.
ALTER TYPE "DetectorType" RENAME TO "DetectorType_old";

CREATE TYPE "DetectorType" AS ENUM (
  'SECRETS',
  'PII',
  'TOXIC',
  'NSFW',
  'YARA',
  'BROKEN_LINKS',
  'PROMPT_INJECTION',
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
