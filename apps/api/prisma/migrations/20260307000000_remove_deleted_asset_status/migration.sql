-- Remove DELETED asset status: assets that were not in a sample run should not
-- be marked deleted, since sampling means only a subset of assets appear per run.
-- Migrate all DELETED assets to UNCHANGED and remove the enum value.

-- Step 1: Migrate all DELETED assets to UNCHANGED
UPDATE assets SET status = 'UNCHANGED' WHERE status = 'DELETED';

-- Step 2: Recreate the AssetStatus enum without DELETED
ALTER TYPE "AssetStatus" RENAME TO "AssetStatus_old";
CREATE TYPE "AssetStatus" AS ENUM ('NEW', 'UPDATED', 'UNCHANGED');

-- Step 3: Migrate the column to the new enum type
ALTER TABLE assets ALTER COLUMN status DROP DEFAULT;
ALTER TABLE assets
  ALTER COLUMN status TYPE "AssetStatus"
  USING status::text::"AssetStatus";
ALTER TABLE assets ALTER COLUMN status SET DEFAULT 'NEW'::"AssetStatus";

-- Step 4: Drop the old enum
DROP TYPE "AssetStatus_old";

-- Step 5: Drop the assets_deleted column from runners (always 0 going forward)
ALTER TABLE runners DROP COLUMN IF EXISTS assets_deleted;
