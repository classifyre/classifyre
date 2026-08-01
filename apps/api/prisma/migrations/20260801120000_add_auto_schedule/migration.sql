-- Adaptive ("automatic") source scheduling.
--
-- Until now a source either had a fixed cron schedule or nothing. Neither fits
-- an initial ingest: a cron picked for steady-state re-checks makes a source
-- with a million rows take weeks to sweep, and a cron tight enough to sweep it
-- keeps hammering the source forever once there is nothing left to read.
--
-- AUTO mode replaces the wall-clock with a feedback loop. A run that ingested
-- something means there is more to read, so the next one starts almost
-- immediately (CATCH_UP). A run that ingested nothing means the sweep has
-- converged, so the interval widens geometrically towards a slow "check only
-- what's new" cadence (STEADY). Failures back off, and a source that keeps
-- failing is PAUSED rather than retried forever.
--
-- Replayed once per tenant schema by database-migrations.ts, so every statement
-- is idempotent and unqualified (it must land in whichever ns_<hex32> schema the
-- search_path points at). Prisma wraps migrations in a transaction, so no
-- CREATE INDEX CONCURRENTLY and no transaction control here.

DO $$
BEGIN
  CREATE TYPE "SourceScheduleMode" AS ENUM ('OFF', 'CRON', 'AUTO');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "AutoSchedulePhase" AS ENUM ('CATCH_UP', 'STEADY', 'BACKOFF', 'PAUSED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "sources"
  ADD COLUMN IF NOT EXISTS "schedule_mode" "SourceScheduleMode" NOT NULL DEFAULT 'OFF',
  ADD COLUMN IF NOT EXISTS "auto_phase" "AutoSchedulePhase" NOT NULL DEFAULT 'CATCH_UP',
  ADD COLUMN IF NOT EXISTS "auto_interval_seconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "auto_no_progress_streak" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "auto_catch_up_runs" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "auto_reason" TEXT,
  -- pg-boss delivers at least once; this makes folding a finished run into the
  -- schedule idempotent per run.
  ADD COLUMN IF NOT EXISTS "auto_last_runner_id" TEXT;

-- Existing schedules keep working unchanged: anything pg-boss is currently
-- driving is CRON, everything else is OFF. No source is silently promoted to
-- AUTO — that is an explicit operator (or agent) choice.
UPDATE "sources"
   SET "schedule_mode" = 'CRON'
 WHERE "schedule_enabled" = true
   AND "schedule_cron" IS NOT NULL
   AND "schedule_mode" = 'OFF';

CREATE INDEX IF NOT EXISTS "sources_schedule_mode_schedule_next_at_idx"
  ON "sources"("schedule_mode", "schedule_next_at");

-- Kill switch: stops the adaptive scheduler from starting anything without
-- losing each source's phase, so flipping it back on resumes where it left off.
ALTER TABLE "instance_settings"
  ADD COLUMN IF NOT EXISTS "auto_schedule_enabled" BOOLEAN NOT NULL DEFAULT true;
