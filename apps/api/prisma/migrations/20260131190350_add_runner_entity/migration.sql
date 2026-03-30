-- CreateEnum
CREATE TYPE "TriggerType" AS ENUM ('MANUAL', 'SCHEDULED', 'WEBHOOK', 'API');

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "detector_findings" JSONB,
ADD COLUMN     "last_scanned_at" TIMESTAMP(3),
ADD COLUMN     "runner_id" TEXT;

-- AlterTable
ALTER TABLE "detector_runs" ADD COLUMN     "runner_id" TEXT;

-- AlterTable
ALTER TABLE "sources" ADD COLUMN     "current_runner_id" TEXT;

-- CreateTable
CREATE TABLE "runners" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "triggered_by" TEXT,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trigger_type" "TriggerType" NOT NULL DEFAULT 'MANUAL',
    "status" "RunnerStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "recipe" JSONB NOT NULL,
    "detectors" JSONB,
    "assets_created" INTEGER NOT NULL DEFAULT 0,
    "assets_updated" INTEGER NOT NULL DEFAULT 0,
    "assets_deleted" INTEGER NOT NULL DEFAULT 0,
    "total_findings" INTEGER NOT NULL DEFAULT 0,
    "logs" TEXT NOT NULL DEFAULT '',
    "error_message" TEXT,
    "error_details" JSONB,

    CONSTRAINT "runners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "runners_source_id_idx" ON "runners"("source_id");

-- CreateIndex
CREATE INDEX "runners_status_idx" ON "runners"("status");

-- CreateIndex
CREATE INDEX "runners_triggered_at_idx" ON "runners"("triggered_at");

-- CreateIndex
CREATE INDEX "assets_runner_id_idx" ON "assets"("runner_id");

-- CreateIndex
CREATE INDEX "assets_last_scanned_at_idx" ON "assets"("last_scanned_at");

-- CreateIndex
CREATE INDEX "detector_runs_runner_id_idx" ON "detector_runs"("runner_id");

-- CreateIndex
CREATE INDEX "sources_current_runner_id_idx" ON "sources"("current_runner_id");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detector_runs" ADD CONSTRAINT "detector_runs_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runners" ADD CONSTRAINT "runners_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
