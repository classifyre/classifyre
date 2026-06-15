-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AgentDecisionAction" ADD VALUE 'LINK_DUPLICATE';
ALTER TYPE "AgentDecisionAction" ADD VALUE 'UPDATE_CLUSTER';

-- AlterEnum
ALTER TYPE "AgentKind" ADD VALUE 'DUPLICATES';

-- CreateTable
CREATE TABLE "asset_correlation_values" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "detector_type" "DetectorType" NOT NULL,
    "custom_detector_key" TEXT,
    "normalized_value" TEXT NOT NULL,
    "value_hash" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_correlation_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_signatures" (
    "asset_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "component_hashes" JSONB NOT NULL,
    "all_values_hash" VARCHAR(64) NOT NULL,
    "value_count" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_signatures_pkey" PRIMARY KEY ("asset_id")
);

-- CreateTable
CREATE TABLE "asset_clusters" (
    "id" TEXT NOT NULL,
    "label" TEXT,
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "source_count" INTEGER NOT NULL DEFAULT 0,
    "top_values" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_clusters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_cluster_members" (
    "cluster_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_cluster_members_pkey" PRIMARY KEY ("cluster_id","asset_id")
);

-- CreateIndex
CREATE INDEX "asset_correlation_values_value_hash_idx" ON "asset_correlation_values"("value_hash");

-- CreateIndex
CREATE INDEX "asset_correlation_values_asset_id_idx" ON "asset_correlation_values"("asset_id");

-- CreateIndex
CREATE INDEX "asset_correlation_values_source_id_idx" ON "asset_correlation_values"("source_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_correlation_values_asset_id_value_hash_key" ON "asset_correlation_values"("asset_id", "value_hash");

-- CreateIndex
CREATE INDEX "asset_signatures_all_values_hash_idx" ON "asset_signatures"("all_values_hash");

-- CreateIndex
CREATE INDEX "asset_signatures_source_id_idx" ON "asset_signatures"("source_id");

-- CreateIndex
CREATE INDEX "asset_clusters_member_count_idx" ON "asset_clusters"("member_count");

-- CreateIndex
CREATE INDEX "asset_cluster_members_cluster_id_idx" ON "asset_cluster_members"("cluster_id");

-- CreateIndex
CREATE UNIQUE INDEX "asset_cluster_members_asset_id_key" ON "asset_cluster_members"("asset_id");

-- AddForeignKey
ALTER TABLE "asset_correlation_values" ADD CONSTRAINT "asset_correlation_values_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_signatures" ADD CONSTRAINT "asset_signatures_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_cluster_members" ADD CONSTRAINT "asset_cluster_members_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "asset_clusters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_cluster_members" ADD CONSTRAINT "asset_cluster_members_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
