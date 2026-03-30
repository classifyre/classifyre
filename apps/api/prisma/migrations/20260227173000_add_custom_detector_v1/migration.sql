ALTER TYPE "DetectorType" ADD VALUE IF NOT EXISTS 'CUSTOM';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CustomDetectorMethod') THEN
    CREATE TYPE "CustomDetectorMethod" AS ENUM ('RULESET', 'CLASSIFIER', 'ENTITY');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CustomDetectorTrainingStatus') THEN
    CREATE TYPE "CustomDetectorTrainingStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');
  END IF;
END
$$;

ALTER TABLE "findings"
  ADD COLUMN IF NOT EXISTS "custom_detector_id" TEXT,
  ADD COLUMN IF NOT EXISTS "custom_detector_key" TEXT,
  ADD COLUMN IF NOT EXISTS "custom_detector_name" TEXT;

CREATE INDEX IF NOT EXISTS "findings_custom_detector_id_idx" ON "findings"("custom_detector_id");
CREATE INDEX IF NOT EXISTS "findings_custom_detector_key_idx" ON "findings"("custom_detector_key");

CREATE TABLE IF NOT EXISTS "custom_detectors" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "method" "CustomDetectorMethod" NOT NULL,
  "config" JSONB NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1,
  "last_trained_at" TIMESTAMP(3),
  "last_training_summary" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "custom_detectors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "custom_detectors_key_key" ON "custom_detectors"("key");
CREATE INDEX IF NOT EXISTS "custom_detectors_method_idx" ON "custom_detectors"("method");
CREATE INDEX IF NOT EXISTS "custom_detectors_is_active_idx" ON "custom_detectors"("is_active");

CREATE TABLE IF NOT EXISTS "custom_detector_feedback" (
  "id" TEXT NOT NULL,
  "custom_detector_id" TEXT,
  "source_id" TEXT NOT NULL,
  "custom_detector_key" TEXT NOT NULL,
  "custom_detector_name" TEXT,
  "finding_id" TEXT,
  "finding_type" TEXT,
  "label" TEXT,
  "matched_content" TEXT NOT NULL,
  "status" "FindingStatus" NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "custom_detector_feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "custom_detector_feedback_custom_detector_id_idx" ON "custom_detector_feedback"("custom_detector_id");
CREATE INDEX IF NOT EXISTS "custom_detector_feedback_source_id_custom_detector_key_idx" ON "custom_detector_feedback"("source_id", "custom_detector_key");
CREATE INDEX IF NOT EXISTS "custom_detector_feedback_finding_id_idx" ON "custom_detector_feedback"("finding_id");
CREATE INDEX IF NOT EXISTS "custom_detector_feedback_status_idx" ON "custom_detector_feedback"("status");

CREATE TABLE IF NOT EXISTS "custom_detector_training_runs" (
  "id" TEXT NOT NULL,
  "custom_detector_id" TEXT NOT NULL,
  "source_id" TEXT,
  "status" "CustomDetectorTrainingStatus" NOT NULL DEFAULT 'PENDING',
  "strategy" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "duration_ms" INTEGER,
  "trained_examples" INTEGER,
  "positive_examples" INTEGER,
  "negative_examples" INTEGER,
  "metrics" JSONB,
  "model_artifact_path" TEXT,
  "config_hash" TEXT,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "custom_detector_training_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "custom_detector_training_runs_custom_detector_id_created_at_idx" ON "custom_detector_training_runs"("custom_detector_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "custom_detector_training_runs_source_id_idx" ON "custom_detector_training_runs"("source_id");
CREATE INDEX IF NOT EXISTS "custom_detector_training_runs_status_idx" ON "custom_detector_training_runs"("status");

ALTER TABLE "findings"
  ADD CONSTRAINT "findings_custom_detector_id_fkey"
  FOREIGN KEY ("custom_detector_id") REFERENCES "custom_detectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "custom_detector_feedback"
  ADD CONSTRAINT "custom_detector_feedback_custom_detector_id_fkey"
  FOREIGN KEY ("custom_detector_id") REFERENCES "custom_detectors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "custom_detector_feedback"
  ADD CONSTRAINT "custom_detector_feedback_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "custom_detector_feedback"
  ADD CONSTRAINT "custom_detector_feedback_finding_id_fkey"
  FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "custom_detector_training_runs"
  ADD CONSTRAINT "custom_detector_training_runs_custom_detector_id_fkey"
  FOREIGN KEY ("custom_detector_id") REFERENCES "custom_detectors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "custom_detector_training_runs"
  ADD CONSTRAINT "custom_detector_training_runs_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
