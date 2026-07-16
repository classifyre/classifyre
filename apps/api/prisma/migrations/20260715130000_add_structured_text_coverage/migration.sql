CREATE TYPE "TextExtractionStatus" AS ENUM (
  'NOT_APPLICABLE',
  'EXTRACTED',
  'EMPTY',
  'ENGINE_UNAVAILABLE',
  'ZERO_FRAMES',
  'FAILED'
);

ALTER TABLE "runner_assets"
  ADD COLUMN "text_extraction_status" "TextExtractionStatus";

ALTER TABLE "runners"
  ADD COLUMN "text_coverage" JSONB;

CREATE INDEX "runner_assets_runner_id_text_extraction_status_idx"
  ON "runner_assets"("runner_id", "text_extraction_status");
