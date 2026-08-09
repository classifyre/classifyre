-- Per-workspace scan concurrency.
--
-- How many scans may run at once was a process-wide environment variable
-- (MAX_CONCURRENT_RUNNERS), which the desktop app pinned to 1. That is one
-- number for every workspace on the machine, unreachable from the UI, and it
-- makes a large corpus crawl: a workspace with 151 sources at ~12 minutes a
-- scan needs about 29 hours for a single sweep at concurrency 1.
--
-- It belongs on instance_settings because that table is per-namespace — each
-- workspace gets its own value, which is what an operator with one small and
-- one large workspace actually wants.
--
-- Default 2 rather than 1: two scans keep a laptop busy without saturating it
-- (the detector pool already sizes itself to half the cores), and it halves the
-- sweep time for the multi-source case that motivated this. 0 means unlimited,
-- matching the semantics the environment variable already had.
--
-- prisma migrate runs each migration inside a transaction, so no transaction
-- control here. The statement is idempotent so a partial apply can be re-run.

-- AlterTable
ALTER TABLE "instance_settings"
  ADD COLUMN IF NOT EXISTS "max_concurrent_runners" INTEGER NOT NULL DEFAULT 2;
