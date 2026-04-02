DELETE FROM "sources" WHERE "type" = 'SITEMAP';
DELETE FROM "assets" WHERE "source_type" = 'SITEMAP';

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
  'MONGODB',
  'POWERBI',
  'TABLEAU',
  'CUSTOM'
);

ALTER TABLE "sources"
  ALTER COLUMN "type" TYPE "AssetType"
  USING ("type"::text::"AssetType");

ALTER TABLE "assets"
  ALTER COLUMN "source_type" TYPE "AssetType"
  USING ("source_type"::text::"AssetType");

DROP TYPE "AssetType_old";
