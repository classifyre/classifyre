-- Shared datasets (docs/prd/DQ-data-query.md §5.12): saved queries shared with
-- audience groups, each an asset of the workspace's built-in source.
CREATE TABLE IF NOT EXISTS "shared_datasets" (
    "asset_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sql" TEXT NOT NULL,
    "owning_group_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'query',
    "inputs" TEXT[],
    "columns" JSONB NOT NULL,
    "lineage" JSONB NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "promoted_at" TIMESTAMP(3),
    "promoted_by" TEXT,
    "unavailable_at" TIMESTAMP(3),
    "unavailable_why" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shared_datasets_pkey" PRIMARY KEY ("asset_id"),
    CONSTRAINT "shared_datasets_asset_id_fkey" FOREIGN KEY ("asset_id")
        REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "shared_datasets_domain_name_key" ON "shared_datasets"("domain", "name");
CREATE INDEX IF NOT EXISTS "shared_datasets_owning_group_id_idx" ON "shared_datasets"("owning_group_id");
CREATE INDEX IF NOT EXISTS "shared_datasets_inputs_idx" ON "shared_datasets" USING GIN ("inputs");

CREATE TABLE IF NOT EXISTS "shared_dataset_versions" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "sql" TEXT NOT NULL,
    "owning_group_id" TEXT NOT NULL,
    "description" TEXT,
    "inputs" TEXT[],
    "changed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shared_dataset_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shared_dataset_versions_asset_id_fkey" FOREIGN KEY ("asset_id")
        REFERENCES "shared_datasets"("asset_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "shared_dataset_versions_asset_id_version_key" ON "shared_dataset_versions"("asset_id", "version");

CREATE TABLE IF NOT EXISTS "shared_dataset_blocks" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "reason" TEXT,
    "blocked_by" TEXT,
    "blocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lifted_by" TEXT,
    "lifted_at" TIMESTAMP(3),
    CONSTRAINT "shared_dataset_blocks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shared_dataset_blocks_asset_id_fkey" FOREIGN KEY ("asset_id")
        REFERENCES "shared_datasets"("asset_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "shared_dataset_blocks_asset_id_idx" ON "shared_dataset_blocks"("asset_id");
CREATE INDEX IF NOT EXISTS "shared_dataset_blocks_scope_type_scope_id_idx" ON "shared_dataset_blocks"("scope_type", "scope_id");

-- `shared` is the built-in source's SQL name: a source that took it before
-- moves aside (its tables become `shared_source.<schema>.<table>`).
UPDATE "sources" SET "sql_name" = 'shared_source'
 WHERE "sql_name" = 'shared' AND "type"::text <> 'SHARED_DATASET';

-- Every workspace has its one built-in source, always (§5.12).
INSERT INTO "sources" ("id", "name", "description", "type", "config", "sql_name", "updated_at")
SELECT md5(random()::text || clock_timestamp()::text)::uuid::text,
       'Shared datasets',
       'Saved queries shared with groups of people. Built in: never scanned, never deleted.',
       'SHARED_DATASET',
       '{"type": "SHARED_DATASET"}'::jsonb,
       'shared',
       CURRENT_TIMESTAMP
 WHERE NOT EXISTS (SELECT 1 FROM "sources" WHERE "type"::text = 'SHARED_DATASET');
