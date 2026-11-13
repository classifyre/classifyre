-- Column hide/mask (docs/prd/DQ-data-query.md §5.8): what a column shows to
-- people who may query its table but not read it in clear. Null follows the
-- column's classification (personal and sensitive masked, secret hidden).
ALTER TABLE "asset_column_annotations" ADD COLUMN IF NOT EXISTS "access" TEXT;
ALTER TABLE "asset_column_annotations" ADD COLUMN IF NOT EXISTS "mask_kind" TEXT;

-- The masked and hidden columns of the tables a run names, as it ran.
ALTER TABLE "query_runs" ADD COLUMN IF NOT EXISTS "masks" JSONB;
