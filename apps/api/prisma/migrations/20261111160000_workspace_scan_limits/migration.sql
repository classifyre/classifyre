-- Per-workspace scan limits; null follows the Helm chart / all-in-one image.
ALTER TABLE "instance_settings"
  ADD COLUMN IF NOT EXISTS "max_concurrent_runners" INTEGER,
  ADD COLUMN IF NOT EXISTS "auto_schedule_max_concurrent" INTEGER,
  ADD COLUMN IF NOT EXISTS "max_runners_per_source" INTEGER;
