-- Transient storage of a sandbox run's input file bytes, used to transport the
-- file to a Kubernetes sandbox job's init-container over the cluster network
-- (no S3, no base64-in-env). Cleared once the job finishes.

-- AlterTable
ALTER TABLE "sandbox_runs" ADD COLUMN "input_data" BYTEA;
