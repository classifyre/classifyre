-- The built-in source of shared datasets (docs/prd/DQ-data-query.md §5.12).
-- Its own migration: a new enum value cannot be used in the batch that adds it.
ALTER TYPE "AssetType" ADD VALUE IF NOT EXISTS 'SHARED_DATASET';
