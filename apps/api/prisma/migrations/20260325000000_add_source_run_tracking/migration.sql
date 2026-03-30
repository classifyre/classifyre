-- Add run tracking fields to sources table for notification intelligence.
-- consecutive_failures: counts how many runs in a row have failed (reset to 0 on success)
-- last_run_status: mirrors the terminal status of the most recent run
-- last_run_at: timestamp of the most recent terminal state (completed or error)

ALTER TABLE "sources" ADD COLUMN "consecutive_failures" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sources" ADD COLUMN "last_run_status" "RunnerStatus";
ALTER TABLE "sources" ADD COLUMN "last_run_at" TIMESTAMP(3);
