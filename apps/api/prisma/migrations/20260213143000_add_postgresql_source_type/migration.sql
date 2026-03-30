-- Add PostgreSQL source type for source/asset enums
ALTER TYPE "AssetType" ADD VALUE IF NOT EXISTS 'POSTGRESQL';
