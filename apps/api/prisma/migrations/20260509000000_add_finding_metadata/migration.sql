-- AlterTable
ALTER TABLE "findings" ADD COLUMN "metadata" JSONB;

-- CreateIndex
CREATE INDEX "findings_metadata_idx" ON "findings" USING GIN ("metadata");
