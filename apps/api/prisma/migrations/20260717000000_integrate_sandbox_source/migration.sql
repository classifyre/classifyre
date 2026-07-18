ALTER TYPE "AssetType" ADD VALUE IF NOT EXISTS 'SANDBOX';

CREATE TABLE "source_files" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "declared_mime_type" TEXT NOT NULL,
    "file_extension" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "source_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "source_files_source_id_content_hash_key"
ON "source_files"("source_id", "content_hash");
CREATE INDEX "source_files_source_id_created_at_idx"
ON "source_files"("source_id", "created_at" DESC);
CREATE INDEX "source_files_content_hash_idx" ON "source_files"("content_hash");

ALTER TABLE "source_files" ADD CONSTRAINT "source_files_source_id_fkey"
FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP TABLE IF EXISTS "sandbox_runs";
DROP TYPE IF EXISTS "SandboxRunStatus";
DROP TYPE IF EXISTS "AssetContentType";
