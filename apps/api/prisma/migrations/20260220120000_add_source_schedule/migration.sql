-- AlterTable
ALTER TABLE "sources"
  ADD COLUMN "schedule_enabled"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "schedule_cron"     TEXT,
  ADD COLUMN "schedule_timezone" TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN "schedule_next_at"  TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "sources_schedule_enabled_idx" ON "sources"("schedule_enabled");
