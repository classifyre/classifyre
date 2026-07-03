-- Add lakehouse + streaming source types (Delta Lake, Iceberg, Kafka).
-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'DELTA_LAKE';
ALTER TYPE "AssetType" ADD VALUE 'ICEBERG';
ALTER TYPE "AssetType" ADD VALUE 'KAFKA';
