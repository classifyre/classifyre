-- CreateTable
-- Workspace-level embedding overrides. Every column is nullable: null means
-- "inherit the deployment default" (Helm values on Kubernetes, the bundled
-- defaults in the desktop app), so an existing workspace that never opens the
-- settings page behaves exactly as it did before this table existed.
CREATE TABLE "embedding_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN,
    "provider" TEXT,
    "model" TEXT,
    "revision" TEXT,
    "dimensions" INTEGER,
    "pooling" TEXT,
    "normalize" BOOLEAN,
    "ai_provider_config_id" TEXT,
    "batch_size" INTEGER,
    "worker_concurrency" INTEGER,
    "max_parallel_calls" INTEGER,
    "intra_op_threads" INTEGER,
    "dtype" TEXT,
    "device" TEXT,
    "auto_backfill" BOOLEAN,
    "hnsw_m" INTEGER,
    "hnsw_ef_construction" INTEGER,
    "hnsw_ef_search" INTEGER,
    "rebuild_started_at" TIMESTAMP(3),
    "rebuild_completed_at" TIMESTAMP(3),
    "rebuild_error" TEXT,
    "rebuild_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "embedding_settings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
-- SET NULL rather than CASCADE: deleting the AI provider must drop the remote
-- binding, never the workspace's whole embedding configuration.
ALTER TABLE "embedding_settings" ADD CONSTRAINT "embedding_settings_ai_provider_config_id_fkey" FOREIGN KEY ("ai_provider_config_id") REFERENCES "ai_provider_config"("id") ON DELETE SET NULL ON UPDATE CASCADE;
