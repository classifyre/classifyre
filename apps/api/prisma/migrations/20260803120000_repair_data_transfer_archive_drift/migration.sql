-- Reconcile databases that applied `20260730150000_add_data_transfer_jobs`
-- before that file was edited in place (commit ae1e3f51 moved archives from an
-- external store into `data_transfer_chunks`). `migrate deploy` never re-runs a
-- migration whose checksum changed, so those databases kept the pre-edit shape
-- and every `prisma.dataTransferJob.create()` failed with P2022 on `archived`.
--
-- Every statement is a no-op on a database that applied the current file.

ALTER TYPE "DataTransferStatus" ADD VALUE IF NOT EXISTS 'STAGED' BEFORE 'PENDING';

ALTER TABLE "data_transfer_jobs"
  ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "data_transfer_jobs" DROP COLUMN IF EXISTS "storage_key";

CREATE TABLE IF NOT EXISTS "data_transfer_chunks" (
  "job_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "data" BYTEA NOT NULL,

  CONSTRAINT "data_transfer_chunks_pkey" PRIMARY KEY ("job_id", "ordinal"),
  CONSTRAINT "data_transfer_chunks_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "data_transfer_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
