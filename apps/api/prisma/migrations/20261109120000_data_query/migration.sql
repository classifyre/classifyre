-- SQL over the tables of a workspace (docs/prd/DQ-data-query.md).

-- How SQL names a source: <sql_name>.<schema>.<table>.
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "sql_name" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "sources_sql_name_key" ON "sources" ("sql_name");

DO $$ BEGIN
  CREATE TYPE "QueryRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'ERROR', 'TIMEOUT', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "query_runs" (
  "id" TEXT NOT NULL,
  "sql" TEXT NOT NULL,
  "status" "QueryRunStatus" NOT NULL DEFAULT 'PENDING',
  "actor_ref" TEXT,
  "asset_ids" TEXT[],
  "source_ids" TEXT[],
  "row_count" INTEGER,
  "truncated" BOOLEAN NOT NULL DEFAULT false,
  "truncated_reason" TEXT,
  "columns" JSONB,
  "timings" JSONB,
  "error" JSONB,
  "result" BYTEA,
  "result_bytes" INTEGER,
  "job_name" TEXT,
  "job_namespace" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "query_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "query_runs_actor_ref_created_at_idx" ON "query_runs" ("actor_ref", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "query_runs_status_idx" ON "query_runs" ("status");
CREATE INDEX IF NOT EXISTS "query_runs_expires_at_idx" ON "query_runs" ("expires_at");

CREATE TABLE IF NOT EXISTS "data_query_settings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "max_rows" INTEGER NOT NULL DEFAULT 10000,
  "timeout_seconds" INTEGER NOT NULL DEFAULT 120,
  "updated_by" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "data_query_settings_pkey" PRIMARY KEY ("id")
);
