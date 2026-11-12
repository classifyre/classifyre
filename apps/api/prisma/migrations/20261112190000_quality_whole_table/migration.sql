-- Governed data assets, phase G-4 (docs/prd/GOV-governed-data-assets.md §5.4):
-- whole-table quality rules measured by system query runs, on a schedule.
ALTER TABLE "quality_rules" ADD COLUMN IF NOT EXISTS "schedule" TEXT;
ALTER TABLE "quality_rules" ADD COLUMN IF NOT EXISTS "last_scheduled_at" TIMESTAMP(3);
ALTER TABLE "quality_evaluations" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'done';
ALTER TABLE "quality_evaluations" ADD COLUMN IF NOT EXISTS "query_run_id" TEXT;
ALTER TABLE "query_runs" ADD COLUMN IF NOT EXISTS "purpose" TEXT;
