-- Fail-closed guard for background bulk status changes: the dry-run count the
-- operator reviewed, re-checked by every chunk. Nullable and without a
-- default, so adding it rewrites no rows; operations created before the guard
-- existed, and retire operations (whose count lives in `counts`), stay NULL.
ALTER TABLE "finding_bulk_operations" ADD COLUMN "expected_count" INTEGER;
