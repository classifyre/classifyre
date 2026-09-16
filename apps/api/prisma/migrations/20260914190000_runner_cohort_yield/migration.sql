-- Per ctx.cohort() of a run: band visits, HIGH/CRITICAL hits and the weights
-- used. Nullable and without a default, so adding it rewrites no rows.
ALTER TABLE "runners" ADD COLUMN "cohort_yield" JSONB;
