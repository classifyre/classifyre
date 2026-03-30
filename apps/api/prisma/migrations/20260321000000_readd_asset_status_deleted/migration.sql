-- Re-add DELETED asset status for full-scan (strategy=ALL) sources.
-- When sampling strategy is ALL, every asset in the source is visited each run,
-- so an asset absent from the run genuinely no longer exists in the source.
-- For RANDOM/LATEST strategies the old no-op behaviour is preserved.

-- Step 1: Recreate the AssetStatus enum with DELETED
ALTER TYPE "AssetStatus" RENAME TO "AssetStatus_old";
CREATE TYPE "AssetStatus" AS ENUM ('NEW', 'UPDATED', 'UNCHANGED', 'DELETED');

-- Step 2: Migrate the column to the new enum type
ALTER TABLE assets ALTER COLUMN status DROP DEFAULT;
ALTER TABLE assets
  ALTER COLUMN status TYPE "AssetStatus"
  USING status::text::"AssetStatus";
ALTER TABLE assets ALTER COLUMN status SET DEFAULT 'NEW'::"AssetStatus";

-- Step 3: Drop the old enum
DROP TYPE "AssetStatus_old";

-- Step 4: Restore assets_deleted column on runners (tracks count of assets marked deleted per run)
ALTER TABLE runners ADD COLUMN IF NOT EXISTS assets_deleted INTEGER NOT NULL DEFAULT 0;
