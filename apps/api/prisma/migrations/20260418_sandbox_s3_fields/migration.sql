-- Add S3 file storage fields to sandbox_runs
ALTER TABLE "sandbox_runs" ADD COLUMN "s3_key" TEXT;
ALTER TABLE "sandbox_runs" ADD COLUMN "content_hash" TEXT;

-- Index for fast duplicate detection by content hash
CREATE INDEX "sandbox_runs_content_hash_idx" ON "sandbox_runs"("content_hash");
