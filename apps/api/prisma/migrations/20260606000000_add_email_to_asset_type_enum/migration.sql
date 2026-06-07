-- Add EMAIL source type to the AssetType enum
ALTER TYPE "AssetType" ADD VALUE IF NOT EXISTS 'EMAIL';
