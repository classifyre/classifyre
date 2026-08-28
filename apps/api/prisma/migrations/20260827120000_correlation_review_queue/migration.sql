-- Correlation review queue.
--
-- Turns the correlation engine's pair output into a queue with a completion
-- state: authored verdicts (correlation_pair_verdicts, correlation_review_batches)
-- plus a set of derived rollups rebuilt wholesale by
-- CorrelationService.refreshReviewIndex() after every recompute.
--
-- The derived tables carry no foreign keys on purpose — they are TRUNCATEd and
-- reinserted, and a cascade fights that. Verdicts carry none either: a decision
-- has to survive the deletion of the assets it was about, as an audit record.
-- Only the two per-asset caches cascade, because that is exactly what they are.

CREATE TYPE "CorrelationVerdict" AS ENUM ('CONFIRMED', 'REJECTED', 'UNSURE', 'SPLIT');
CREATE TYPE "CorrelationPatternFamily" AS ENUM ('SHARED_LABELS', 'PHONETIC', 'IDENTICAL_CONTENT', 'NEAR_DUPLICATE_TEXT');
CREATE TYPE "CorrelationLineageState" AS ENUM ('PATH', 'NO_PATH', 'UNKNOWN');
CREATE TYPE "CorrelationLineageRelation" AS ENUM ('ANCESTOR_DESCENDANT', 'SIBLING', 'CONNECTED_OTHER', 'DISCONNECTED', 'UNKNOWN');

-- ── Authored ────────────────────────────────────────────────────────────────

CREATE TABLE "correlation_pair_verdicts" (
    "id" TEXT NOT NULL,
    "a_id" TEXT NOT NULL,
    "b_id" TEXT NOT NULL,
    "verdict" "CorrelationVerdict" NOT NULL,
    "pattern_key" TEXT NOT NULL,
    "score_at_verdict" DECIMAL(4,3) NOT NULL,
    "batch_id" TEXT NOT NULL,
    "note" TEXT,
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correlation_pair_verdicts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "correlation_pair_verdicts_a_id_b_id_key" ON "correlation_pair_verdicts"("a_id", "b_id");
CREATE INDEX "correlation_pair_verdicts_pattern_key_verdict_idx" ON "correlation_pair_verdicts"("pattern_key", "verdict");
CREATE INDEX "correlation_pair_verdicts_batch_id_idx" ON "correlation_pair_verdicts"("batch_id");
CREATE INDEX "correlation_pair_verdicts_decided_at_idx" ON "correlation_pair_verdicts"("decided_at");

CREATE TABLE "correlation_review_batches" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "pattern_key" TEXT,
    "pair_count" INTEGER NOT NULL,
    "cluster_count" INTEGER NOT NULL,
    "asset_count" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "undo_payload" JSONB,
    "undone_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correlation_review_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "correlation_review_batches_created_at_idx" ON "correlation_review_batches"("created_at");

-- ── Derived ─────────────────────────────────────────────────────────────────

CREATE TABLE "correlation_patterns" (
    "pattern_key" TEXT NOT NULL,
    "family" "CorrelationPatternFamily" NOT NULL,
    "labels" TEXT[],
    "pair_count" INTEGER NOT NULL,
    "cluster_count" INTEGER NOT NULL,
    "asset_count" INTEGER NOT NULL,
    "true_pair_count" INTEGER NOT NULL,
    "avg_weighted" DECIMAL(4,3) NOT NULL,
    "max_weighted" DECIMAL(4,3) NOT NULL,
    "score_buckets" INTEGER[],
    "decided_buckets" INTEGER[],
    "cluster_buckets" INTEGER[],
    "lineage_path_pairs" INTEGER NOT NULL,
    "lineage_no_path_pairs" INTEGER NOT NULL,
    "lineage_unknown_pairs" INTEGER NOT NULL,
    "topology_shape" TEXT NOT NULL,
    "rule_kind" TEXT NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correlation_patterns_pkey" PRIMARY KEY ("pattern_key")
);

CREATE INDEX "correlation_patterns_pair_count_idx" ON "correlation_patterns"("pair_count");

CREATE TABLE "correlation_pair_signatures" (
    "a_id" TEXT NOT NULL,
    "b_id" TEXT NOT NULL,
    "pattern_key" TEXT NOT NULL,
    "family" "CorrelationPatternFamily" NOT NULL,
    "weighted" DECIMAL(4,3) NOT NULL,
    "shared_count" INTEGER NOT NULL,
    "labels" TEXT[],
    "cluster_id" TEXT,
    "source_a_id" TEXT NOT NULL,
    "source_b_id" TEXT NOT NULL,
    "lineage_state" "CorrelationLineageState" NOT NULL,
    "lineage_relation" "CorrelationLineageRelation" NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "correlation_pair_signatures_pkey" PRIMARY KEY ("a_id", "b_id")
);

-- "the next N undecided pairs in this pattern" must be a range seek, not a scan.
CREATE INDEX "correlation_pair_signatures_pattern_key_weighted_idx" ON "correlation_pair_signatures"("pattern_key", "weighted" DESC);
CREATE INDEX "correlation_pair_signatures_cluster_id_idx" ON "correlation_pair_signatures"("cluster_id");
CREATE INDEX "correlation_pair_signatures_lineage_state_weighted_idx" ON "correlation_pair_signatures"("lineage_state", "weighted" DESC);

CREATE TABLE "correlation_cluster_patterns" (
    "cluster_id" TEXT NOT NULL,
    "pattern_key" TEXT NOT NULL,
    "pair_count" INTEGER NOT NULL,
    "undecided_pairs" INTEGER NOT NULL,
    "member_count" INTEGER NOT NULL,
    "source_count" INTEGER NOT NULL,
    "max_weighted" DECIMAL(4,3) NOT NULL,
    "avg_weighted" DECIMAL(4,3) NOT NULL,
    "shape" TEXT NOT NULL,
    "lineage_state" "CorrelationLineageState" NOT NULL,
    "labels" TEXT[],

    CONSTRAINT "correlation_cluster_patterns_pkey" PRIMARY KEY ("cluster_id", "pattern_key")
);

CREATE INDEX "correlation_cluster_patterns_pattern_key_undecided_pairs_ma_idx" ON "correlation_cluster_patterns"("pattern_key", "undecided_pairs" DESC, "max_weighted" DESC);

CREATE TABLE "correlation_source_pairs" (
    "source_a_id" TEXT NOT NULL,
    "source_b_id" TEXT NOT NULL,
    "pair_count" INTEGER NOT NULL,
    "asset_count" INTEGER NOT NULL,

    CONSTRAINT "correlation_source_pairs_pkey" PRIMARY KEY ("source_a_id", "source_b_id")
);

-- ── Per-asset caches (these do cascade) ─────────────────────────────────────

CREATE TABLE "asset_label_profiles" (
    "asset_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "nf_count" INTEGER NOT NULL,
    "nf_weight" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "asset_label_profiles_pkey" PRIMARY KEY ("asset_id", "label")
);

CREATE TABLE "asset_lineage_profiles" (
    "asset_id" TEXT NOT NULL,
    "degree" INTEGER NOT NULL,
    "component_id" TEXT,
    "component_size" INTEGER NOT NULL,
    "upstream_roots" TEXT[],
    "computed_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_lineage_profiles_pkey" PRIMARY KEY ("asset_id")
);

CREATE INDEX "asset_lineage_profiles_component_id_idx" ON "asset_lineage_profiles"("component_id");

ALTER TABLE "asset_label_profiles" ADD CONSTRAINT "asset_label_profiles_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "asset_lineage_profiles" ADD CONSTRAINT "asset_lineage_profiles_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
