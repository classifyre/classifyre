-- CUSTOM source type: extraction logic written by the user as a marimo notebook.
--
-- `CUSTOM` has been present in schema.prisma's AssetType since the initial
-- commit but was never added to the Postgres enum by any migration, so every
-- existing tenant schema is missing the value. `IF NOT EXISTS` keeps this safe
-- for any database where it was somehow already applied.
-- AlterEnum
ALTER TYPE "AssetType" ADD VALUE IF NOT EXISTS 'CUSTOM';

-- Notebook revisions. Immutable: a save writes a new row rather than updating
-- one, so a run can be pinned to the exact code it executed and a bad edit can
-- be rolled back.
CREATE TABLE "custom_source_notebooks" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "custom_source_notebooks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "custom_source_notebooks_source_id_revision_key"
ON "custom_source_notebooks"("source_id", "revision");
CREATE INDEX "custom_source_notebooks_source_id_created_at_idx"
ON "custom_source_notebooks"("source_id", "created_at" DESC);

ALTER TABLE "custom_source_notebooks"
ADD CONSTRAINT "custom_source_notebooks_source_id_fkey"
FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Interactive editing sessions. At most one live session per source; the row is
-- the record the reverse proxy resolves a request against, and the reaper's
-- work list.
CREATE TABLE "custom_source_sessions" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTING',
    "endpoint" TEXT,
    "token" TEXT NOT NULL,
    "job_name" TEXT,
    "job_namespace" TEXT,
    "process_id" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3),
    CONSTRAINT "custom_source_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "custom_source_sessions_source_id_key"
ON "custom_source_sessions"("source_id");
CREATE INDEX "custom_source_sessions_status_last_seen_at_idx"
ON "custom_source_sessions"("status", "last_seen_at");

ALTER TABLE "custom_source_sessions"
ADD CONSTRAINT "custom_source_sessions_source_id_fkey"
FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Which notebook revision a run executed. Nullable: every existing run, and
-- every run of a non-custom source, has none.
ALTER TABLE "runners" ADD COLUMN "notebook_revision" INTEGER;
