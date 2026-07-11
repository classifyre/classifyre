-- Add LOCAL_FOLDER source type (desktop/local-dev only; scans a folder on the machine running the API).
-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'LOCAL_FOLDER';
