-- Replace the single findings_summary JSONB blob with three typed columns:
--   findings_total        INTEGER       – scalar count for fast ordering/filtering
--   findings_by_severity  JSONB         – { critical, high, medium, low, info } counts
--   findings_by_detector  JSONB         – { <detector>: { total, critical, … } } counts
ALTER TABLE "runner_assets"
  DROP COLUMN IF EXISTS "findings_summary",
  ADD COLUMN "findings_total"        INTEGER,
  ADD COLUMN "findings_by_severity"  JSONB,
  ADD COLUMN "findings_by_detector"  JSONB;
