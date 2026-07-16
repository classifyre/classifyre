-- Semantic storage requires pgvector. If the server package is missing or the
-- migration user cannot install extensions, migration deployment must fail.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;

CREATE TABLE "embedding_spaces" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "dim" INTEGER NOT NULL,
  "pooling" TEXT NOT NULL,
  "normalized" BOOLEAN NOT NULL DEFAULT true,
  "is_active" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "embedding_spaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "content_embeddings" (
  "id" TEXT NOT NULL,
  "space_id" TEXT NOT NULL,
  "content_hash" VARCHAR(64) NOT NULL,
  -- Untyped vector permits multiple model dimensions in one table. Each
  -- embedding space receives its own dimension-cast partial HNSW index.
  "vec" public.vector NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "content_embeddings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_chunks" (
  "id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "page" INTEGER,
  "char_offset" INTEGER NOT NULL,
  "char_length" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "content_hash" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "asset_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "finding_evidence_analyses" (
  "finding_id" TEXT NOT NULL,
  "space_id" TEXT NOT NULL,
  "importance_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "quality_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "semantic_outlier" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "similar_count" INTEGER NOT NULL DEFAULT 0,
  "duplicate_group_hash" VARCHAR(64),
  "reasons" JSONB NOT NULL DEFAULT '[]',
  "signals" JSONB NOT NULL DEFAULT '{}',
  "analyzed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "finding_evidence_analyses_pkey" PRIMARY KEY ("finding_id")
);

ALTER TABLE "findings" ADD COLUMN "embed_content_hash" VARCHAR(64);
ALTER TABLE "runners" ADD COLUMN "findings_resolved" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "runners" ADD COLUMN "findings_retained" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "embedding_spaces_provider_model_revision_dim_pooling_normalized_key"
  ON "embedding_spaces"("provider", "model", "revision", "dim", "pooling", "normalized");
CREATE INDEX "embedding_spaces_is_active_idx" ON "embedding_spaces"("is_active");
CREATE UNIQUE INDEX "content_embeddings_space_id_content_hash_key"
  ON "content_embeddings"("space_id", "content_hash");
CREATE INDEX "content_embeddings_content_hash_idx" ON "content_embeddings"("content_hash");
CREATE UNIQUE INDEX "asset_chunks_asset_id_ordinal_key" ON "asset_chunks"("asset_id", "ordinal");
CREATE INDEX "asset_chunks_source_id_idx" ON "asset_chunks"("source_id");
CREATE INDEX "asset_chunks_content_hash_idx" ON "asset_chunks"("content_hash");
CREATE INDEX "findings_embed_content_hash_idx" ON "findings"("embed_content_hash");
CREATE INDEX "finding_evidence_analyses_importance_score_idx"
  ON "finding_evidence_analyses"("importance_score" DESC);
CREATE INDEX "finding_evidence_analyses_quality_score_idx"
  ON "finding_evidence_analyses"("quality_score" DESC);
CREATE INDEX "finding_evidence_analyses_duplicate_group_hash_idx"
  ON "finding_evidence_analyses"("duplicate_group_hash");

ALTER TABLE "content_embeddings" ADD CONSTRAINT "content_embeddings_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "embedding_spaces"("id") ON DELETE CASCADE;
ALTER TABLE "asset_chunks" ADD CONSTRAINT "asset_chunks_asset_id_fkey"
  FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE;
ALTER TABLE "asset_chunks" ADD CONSTRAINT "asset_chunks_source_id_fkey"
  FOREIGN KEY ("source_id") REFERENCES "sources"("id") ON DELETE CASCADE;
ALTER TABLE "finding_evidence_analyses" ADD CONSTRAINT "finding_evidence_analyses_finding_id_fkey"
  FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE CASCADE;
ALTER TABLE "finding_evidence_analyses" ADD CONSTRAINT "finding_evidence_analyses_space_id_fkey"
  FOREIGN KEY ("space_id") REFERENCES "embedding_spaces"("id") ON DELETE CASCADE;
