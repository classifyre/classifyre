-- Add search-engine source types (Elasticsearch, OpenSearch, Meilisearch).
-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE 'ELASTICSEARCH';
ALTER TYPE "AssetType" ADD VALUE 'OPENSEARCH';
ALTER TYPE "AssetType" ADD VALUE 'MEILISEARCH';
