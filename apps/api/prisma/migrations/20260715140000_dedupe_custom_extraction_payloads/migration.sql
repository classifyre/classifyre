CREATE TABLE "extraction_payloads" (
  "content_hash" VARCHAR(64) NOT NULL,
  "pipeline_result" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "extraction_payloads_pkey" PRIMARY KEY ("content_hash")
);

ALTER TABLE "custom_detector_extractions"
  ADD COLUMN "payload_hash" VARCHAR(64);

-- This branch has not shipped yet, but keeping the migration data-preserving
-- makes test-merges and developer databases deterministic.
INSERT INTO "extraction_payloads" ("content_hash", "pipeline_result")
SELECT DISTINCT
  encode(sha256(convert_to("pipeline_result"::text, 'UTF8')), 'hex'),
  "pipeline_result"
FROM "custom_detector_extractions"
ON CONFLICT ("content_hash") DO NOTHING;

UPDATE "custom_detector_extractions"
SET "payload_hash" =
  encode(sha256(convert_to("pipeline_result"::text, 'UTF8')), 'hex')
WHERE "payload_hash" IS NULL;

ALTER TABLE "custom_detector_extractions"
  ALTER COLUMN "payload_hash" SET NOT NULL,
  DROP COLUMN "pipeline_result";

CREATE INDEX "custom_detector_extractions_payload_hash_idx"
  ON "custom_detector_extractions"("payload_hash");

ALTER TABLE "custom_detector_extractions"
  ADD CONSTRAINT "custom_detector_extractions_payload_hash_fkey"
  FOREIGN KEY ("payload_hash")
  REFERENCES "extraction_payloads"("content_hash")
  ON DELETE RESTRICT;
