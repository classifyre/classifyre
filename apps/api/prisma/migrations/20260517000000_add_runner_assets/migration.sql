-- CreateEnum
CREATE TYPE "RunnerAssetStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'ERROR');

-- CreateTable
CREATE TABLE "runner_assets" (
    "runner_id" TEXT NOT NULL,
    "asset_hash" TEXT NOT NULL,
    "status" "RunnerAssetStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runner_assets_pkey" PRIMARY KEY ("runner_id","asset_hash")
);

-- CreateIndex
CREATE INDEX "runner_assets_runner_id_status_idx" ON "runner_assets"("runner_id", "status");

-- AddForeignKey
ALTER TABLE "runner_assets" ADD CONSTRAINT "runner_assets_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE CASCADE ON UPDATE CASCADE;
