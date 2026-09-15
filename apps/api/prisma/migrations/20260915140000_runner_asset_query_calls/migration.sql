-- Persist the ctx.query_assets() call budget on the run.
--
-- The counter lived in a process-local Map: one API replica (or one restart)
-- could not see another's counts, so a run queried past its 100 calls. A
-- column with a default rewrites no existing rows, and the service increments
-- it atomically (a single update returning the new value) before running the
-- query, so concurrent calls cannot both read the same count.
ALTER TABLE "runners" ADD COLUMN "asset_query_calls" INTEGER NOT NULL DEFAULT 0;
