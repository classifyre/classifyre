-- Storage reclaim: indexes nothing has ever scanned, and one surrogate key
-- nothing has ever read.
--
-- Measured on a 159k-asset workspace whose schema had grown to 17 GB, against
-- pg_stat_user_indexes counters that had never been reset (so the zero-scan
-- figures cover the entire lifetime of the install).

-- 161 MB, 0 scans. Three distinct values across four million rows; every query
-- that filters on lineage_state does so as an extra AND beside a selective
-- predicate the planner uses instead.
DROP INDEX IF EXISTS "correlation_pair_signatures_lineage_state_weighted_idx";

-- 50 MB and 40 MB, 0 scans each. Ranked reads go through the denormalised
-- findings.importance_score and its own index; nothing orders the analyses
-- table by either score.
DROP INDEX IF EXISTS "finding_evidence_analyses_importance_score_idx";
DROP INDEX IF EXISTS "finding_evidence_analyses_quality_score_idx";

-- content_embeddings: (space_id, content_hash) is the only identity a vector
-- has. The surrogate `id` was generated on every insert and read by nothing,
-- costing a 64 MB b-tree plus 37 bytes a row on top of the unique index that
-- was already enforcing the real key.
--
-- The existing unique index is PROMOTED rather than rebuilt: `USING INDEX`
-- adopts it in place and renames it to the constraint name, which on the
-- measured workspace avoids re-sorting 879k rows to recreate 146 MB of index
-- that is already exactly correct.
ALTER TABLE "content_embeddings" DROP CONSTRAINT "content_embeddings_pkey";
ALTER TABLE "content_embeddings" DROP COLUMN "id";
ALTER TABLE "content_embeddings"
  ADD CONSTRAINT "content_embeddings_pkey"
  PRIMARY KEY USING INDEX "content_embeddings_space_id_content_hash_key";
