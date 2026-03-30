-- CreateEnum
CREATE TYPE "RunnerExecutionMode" AS ENUM ('LOCAL', 'KUBERNETES', 'EXTERNAL');

-- AlterTable
ALTER TABLE "runners"
ADD COLUMN "execution_mode" "RunnerExecutionMode",
ADD COLUMN "job_name" TEXT,
ADD COLUMN "job_namespace" TEXT;

-- CreateIndex
CREATE INDEX "runners_execution_mode_idx" ON "runners"("execution_mode");
