-- Add lakehouse + streaming source types (Delta Lake, Iceberg, Hudi, Spark Catalog, Kafka).
-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'DELTA_LAKE';
ALTER TYPE "AssetType" ADD VALUE 'ICEBERG';
ALTER TYPE "AssetType" ADD VALUE 'HUDI';
ALTER TYPE "AssetType" ADD VALUE 'SPARK_CATALOG';
ALTER TYPE "AssetType" ADD VALUE 'KAFKA';
