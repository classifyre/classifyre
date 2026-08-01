-- Namespace data transfer: one row per export or import run, executed by the
-- per-namespace pg-boss worker. Lives in the tenant schema so a namespace's
-- transfer history travels (and is dropped) with the namespace itself.

CREATE TYPE "DataTransferKind" AS ENUM ('EXPORT', 'IMPORT');
CREATE TYPE "DataTransferStatus" AS ENUM ('STAGED', 'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "DataTransferConflict" AS ENUM ('SKIP', 'OVERWRITE');

CREATE TABLE "data_transfer_jobs" (
  "id" TEXT NOT NULL,
  "kind" "DataTransferKind" NOT NULL,
  "status" "DataTransferStatus" NOT NULL DEFAULT 'PENDING',
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "conflict_mode" "DataTransferConflict" NOT NULL DEFAULT 'SKIP',
  "file_name" TEXT,
  "file_size" BIGINT,
  "checksum" VARCHAR(64),
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "processed_rows" INTEGER NOT NULL DEFAULT 0,
  "skipped_rows" INTEGER NOT NULL DEFAULT 0,
  "percent" INTEGER NOT NULL DEFAULT 0,
  "current_table" TEXT,
  "counts" JSONB NOT NULL DEFAULT '{}',
  "warnings" JSONB NOT NULL DEFAULT '[]',
  "error_message" TEXT,
  "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "data_transfer_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "data_transfer_jobs_status_idx" ON "data_transfer_jobs"("status");
CREATE INDEX "data_transfer_jobs_kind_created_at_idx" ON "data_transfer_jobs"("kind", "created_at" DESC);
CREATE INDEX "data_transfer_jobs_expires_at_idx" ON "data_transfer_jobs"("expires_at");

-- The archive's compressed bytes, split across rows so both writing and reading
-- stay streaming. The API and the worker are separate deployments sharing only
-- this database, so an archive on either one's filesystem would be invisible to
-- the other.
CREATE TABLE "data_transfer_chunks" (
  "job_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,

  CONSTRAINT "data_transfer_chunks_pkey" PRIMARY KEY ("job_id", "ordinal"),
  CONSTRAINT "data_transfer_chunks_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "data_transfer_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
