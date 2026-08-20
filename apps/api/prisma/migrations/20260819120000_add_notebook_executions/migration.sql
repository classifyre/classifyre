-- CreateEnum
CREATE TYPE "NotebookExecutionMode" AS ENUM ('CELL', 'ALL', 'TEST_CONNECTION', 'PREVIEW_EXTRACT');

-- CreateEnum
CREATE TYPE "NotebookExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'ERROR', 'CANCELLED', 'TIMEOUT');

-- CreateTable
CREATE TABLE "notebook_executions" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "mode" "NotebookExecutionMode" NOT NULL,
    "target_cell_id" TEXT,
    "status" "NotebookExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "cells" JSONB NOT NULL,
    "outputs" JSONB,
    "failed_cell_id" TEXT,
    "error" JSONB,
    "duration_ms" INTEGER,
    "triggered_by" TEXT,
    "job_name" TEXT,
    "job_namespace" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notebook_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notebook_executions_source_id_created_at_idx" ON "notebook_executions"("source_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notebook_executions_status_idx" ON "notebook_executions"("status");

-- AddForeignKey
ALTER TABLE "notebook_executions" ADD CONSTRAINT "notebook_executions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
