-- CreateTable
CREATE TABLE "correlation_pair_staging" (
    "id" BIGSERIAL NOT NULL,
    "run_id" TEXT NOT NULL,
    "a_id" TEXT NOT NULL,
    "b_id" TEXT NOT NULL,
    "shared_count" INTEGER NOT NULL,
    "weighted_shared" DECIMAL(12,4) NOT NULL,
    "shared_by_label" JSONB NOT NULL,

    CONSTRAINT "correlation_pair_staging_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "correlation_pair_staging_run_id_id_idx" ON "correlation_pair_staging"("run_id", "id");
