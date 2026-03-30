-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SCAN', 'FINDING', 'SOURCE', 'SYSTEM');

-- DropIndex
DROP INDEX "findings_asset_id_detector_type_idx";

-- DropIndex
DROP INDEX "findings_detected_at_idx";

-- DropIndex
DROP INDEX "findings_history_idx";

-- DropIndex
DROP INDEX "findings_source_id_severity_idx";

-- AlterTable
ALTER TABLE "runners" ADD COLUMN     "triggered_by" TEXT;

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "event" TEXT,
    "severity" "Severity" NOT NULL DEFAULT 'INFO',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "action_url" TEXT,
    "source_id" TEXT,
    "runner_id" TEXT,
    "finding_id" TEXT,
    "triggered_by" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "is_important" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_type_idx" ON "notifications"("type");

-- CreateIndex
CREATE INDEX "notifications_event_idx" ON "notifications"("event");

-- CreateIndex
CREATE INDEX "notifications_severity_idx" ON "notifications"("severity");

-- CreateIndex
CREATE INDEX "notifications_source_id_idx" ON "notifications"("source_id");

-- CreateIndex
CREATE INDEX "notifications_runner_id_idx" ON "notifications"("runner_id");

-- CreateIndex
CREATE INDEX "notifications_finding_id_idx" ON "notifications"("finding_id");

-- CreateIndex
CREATE INDEX "notifications_is_read_idx" ON "notifications"("is_read");

-- CreateIndex
CREATE INDEX "notifications_is_important_idx" ON "notifications"("is_important");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "findings_resolved_at_idx" ON "findings"("resolved_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_runner_id_fkey" FOREIGN KEY ("runner_id") REFERENCES "runners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
