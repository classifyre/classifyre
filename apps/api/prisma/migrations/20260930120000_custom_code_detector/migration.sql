-- Code detectors (custom-detector pipeline type CODE_DETECTOR, PRD G1).
--
-- 1. Uploaded detector files (lists, models, reference tables) read with
--    ctx.file(name). Bytes live in Postgres like source files do.
-- 2. Notebook executions can belong to a detector instead of a source: a
--    detector's cells run without a source, and its preview runs against one
--    asset of a chosen source.
-- 3. Test scenarios can carry a whole asset (rows, pages, metadata) instead of
--    only text.

ALTER TYPE "NotebookExecutionMode" ADD VALUE IF NOT EXISTS 'PREVIEW_DETECT';
ALTER TYPE "NotebookScope" ADD VALUE IF NOT EXISTS 'DETECTOR';

CREATE TABLE "custom_detector_files" (
  "id"                 TEXT         NOT NULL,
  "custom_detector_id" TEXT         NOT NULL,
  "file_name"          TEXT         NOT NULL,
  "declared_mime_type" TEXT         NOT NULL,
  "file_size_bytes"    INTEGER      NOT NULL,
  "content_hash"       VARCHAR(64)  NOT NULL,
  "data"               BYTEA        NOT NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "custom_detector_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "custom_detector_files_custom_detector_id_file_name_key"
  ON "custom_detector_files"("custom_detector_id", "file_name");

ALTER TABLE "custom_detector_files"
  ADD CONSTRAINT "custom_detector_files_custom_detector_id_fkey"
  FOREIGN KEY ("custom_detector_id") REFERENCES "custom_detectors"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notebook_executions" ALTER COLUMN "source_id" DROP NOT NULL;
ALTER TABLE "notebook_executions" ADD COLUMN "custom_detector_id" TEXT;
ALTER TABLE "notebook_executions" ADD COLUMN "asset_id" TEXT;

ALTER TABLE "notebook_executions"
  ADD CONSTRAINT "notebook_executions_custom_detector_id_fkey"
  FOREIGN KEY ("custom_detector_id") REFERENCES "custom_detectors"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "notebook_executions_custom_detector_id_created_at_idx"
  ON "notebook_executions"("custom_detector_id", "created_at" DESC);

ALTER TABLE "custom_detector_test_scenarios" ADD COLUMN "input_asset" JSONB;
