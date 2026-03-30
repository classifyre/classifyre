-- CreateEnum
CREATE TYPE "SandboxRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'ERROR');

-- CreateTable
CREATE TABLE "sandbox_runs" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_extension" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "detectors" JSONB NOT NULL,
    "findings" JSONB NOT NULL DEFAULT '[]',
    "status" "SandboxRunStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "duration_ms" INTEGER,

    CONSTRAINT "sandbox_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sandbox_runs_status_idx" ON "sandbox_runs"("status");

-- CreateIndex
CREATE INDEX "sandbox_runs_created_at_idx" ON "sandbox_runs"("created_at");
