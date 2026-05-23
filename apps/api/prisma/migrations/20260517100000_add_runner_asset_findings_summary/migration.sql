-- Add findings_summary JSONB column to runner_assets.
-- Stores per-detector / per-severity counts written atomically with the
-- PROCESSED status transition, so findings tallies are always consistent
-- with the saved findings or simply absent (never partially written).
ALTER TABLE "runner_assets"
  ADD COLUMN "findings_summary" JSONB;
