-- Background bulk finding operations: one row per large status change or
-- out-of-scope retirement, executed in short resumable chunks by the
-- per-namespace pg-boss worker. Lives in the tenant schema with the findings it
-- changes.

CREATE TYPE "FindingBulkOperationKind" AS ENUM ('STATUS_CHANGE', 'RETIRE_OUT_OF_SCOPE');
CREATE TYPE "FindingBulkOperationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

CREATE TABLE "finding_bulk_operations" (
  "id" TEXT NOT NULL,
  "kind" "FindingBulkOperationKind" NOT NULL,
  "status" "FindingBulkOperationStatus" NOT NULL DEFAULT 'PENDING',
  "filters" JSONB NOT NULL DEFAULT '{}',
  "target" JSONB NOT NULL DEFAULT '{}',
  "cursor" TEXT,
  "total_estimate" INTEGER NOT NULL DEFAULT 0,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "changed" INTEGER NOT NULL DEFAULT 0,
  "exempted" INTEGER NOT NULL DEFAULT 0,
  "counts" JSONB NOT NULL DEFAULT '{}',
  "warnings" JSONB NOT NULL DEFAULT '[]',
  "error_message" TEXT,
  "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
  "lease_until" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "finding_bulk_operations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "finding_bulk_operations_status_created_at_idx" ON "finding_bulk_operations"("status", "created_at" DESC);
