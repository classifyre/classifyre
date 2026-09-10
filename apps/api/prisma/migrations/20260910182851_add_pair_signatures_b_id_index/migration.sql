-- Incremental review-index refreshes rewrite only pairs involving touched
-- assets (`DELETE ... WHERE a_id = ANY(...) OR b_id = ANY(...)`), instead of
-- truncating the whole table. The primary key leads with a_id, so the b_id
-- side of that disjunction fell back to a sequential scan over millions of
-- rows on every incremental cycle — 5+ minutes on a 3.1M-row table
-- (2026-09-10). A trailing-column btree makes both sides bitmap-indexable.
-- Plain CREATE INDEX (not CONCURRENTLY): Prisma runs migrations inside a
-- transaction, and the build holds AccessExclusiveLock on the table while it
-- runs. Pair-signature writes only happen during a recompute, but review-queue
-- reads block for the duration of the build — deploy off-peak on big estates.
CREATE INDEX IF NOT EXISTS "correlation_pair_signatures_b_id_idx"
  ON "correlation_pair_signatures" ("b_id");
