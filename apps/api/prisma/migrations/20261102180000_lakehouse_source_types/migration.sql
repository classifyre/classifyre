-- Lakehouse tables are read by the bucket sources now (S3-compatible, Azure
-- Blob, GCS, local folder), each table as one asset, so the path-based
-- DELTA_LAKE and ICEBERG sources go. Their sources are dropped with their
-- assets and findings (both cascade from the source); no data is carried over.
-- New: ICEBERG_REST (any Iceberg REST catalog), DUCKLAKE, TRINO, ATHENA,
-- BIGQUERY, REDSHIFT.
DELETE FROM "sources" WHERE "type"::text IN ('DELTA_LAKE', 'ICEBERG');
DELETE FROM "assets" WHERE "source_type"::text IN ('DELTA_LAKE', 'ICEBERG');

ALTER TYPE "AssetType" RENAME TO "AssetType_old";

CREATE TYPE "AssetType" AS ENUM (
  'JIRA',
  'CONFLUENCE',
  'CROWD',
  'BITBUCKET',
  'SERVICEDESK',
  'XRAY',
  'GOOGLE_DRIVE',
  'GOOGLE_SHEETS',
  'GOOGLE_DOCS',
  'GOOGLE_SLIDES',
  'WORDPRESS',
  'SLACK',
  'S3_COMPATIBLE_STORAGE',
  'AZURE_BLOB_STORAGE',
  'GOOGLE_CLOUD_STORAGE',
  'POSTGRESQL',
  'MYSQL',
  'MSSQL',
  'ORACLE',
  'HIVE',
  'DATABRICKS',
  'SNOWFLAKE',
  'DREMIO',
  'MONGODB',
  'NEO4J',
  'SQLITE',
  'NOTION',
  'POWERBI',
  'TABLEAU',
  'EMAIL',
  'YOUTUBE',
  'REDDIT',
  'KAFKA',
  'ELASTICSEARCH',
  'OPENSEARCH',
  'MEILISEARCH',
  'LOCAL_FOLDER',
  'MICROSOFT_365',
  'GOOGLE_WORKSPACE',
  'DROPBOX',
  'HUGGING_FACE',
  'GIT',
  'SANDBOX',
  'ICEBERG_REST',
  'DUCKLAKE',
  'TRINO',
  'ATHENA',
  'BIGQUERY',
  'REDSHIFT',
  'CUSTOM'
);

ALTER TABLE "sources"
  ALTER COLUMN "type" TYPE "AssetType"
  USING ("type"::text::"AssetType");

ALTER TABLE "assets"
  ALTER COLUMN "source_type" TYPE "AssetType"
  USING ("source_type"::text::"AssetType");

DROP TYPE "AssetType_old";
