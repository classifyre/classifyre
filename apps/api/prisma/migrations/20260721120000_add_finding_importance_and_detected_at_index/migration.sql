-- Query-speed fix for search/findings, discovery, and charts.
--
-- 1. Denormalize FindingEvidenceAnalysis.importance_score onto findings so the
--    default "sort by importance" search is a single-table index scan instead
--    of a full parallel seq-scan + hash-join + top-N sort across the whole
--    findings/finding_evidence_analyses tables (measured ~1.45 s / ~1 GB reads
--    on 396k findings). A DB trigger keeps the copy in sync with every writer
--    (insert-time analysis, recalibration, updateMany) without app changes.
-- 2. Add detected_at indexes that the windowed discovery/charts aggregations
--    filter on (previously only first/last_detected_at were indexed).

-- AlterTable. NOT NULL DEFAULT 0 so unanalyzed findings sort last under a plain
-- DESC order (no NULLS-FIRST/LAST handling needed, so the Prisma @@index and the
-- physical index stay identical and migrate stays drift-free).
ALTER TABLE "findings" ADD COLUMN "importance_score" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Backfill from existing evidence analyses.
UPDATE "findings" AS f
SET "importance_score" = e."importance_score"
FROM "finding_evidence_analyses" AS e
WHERE e."finding_id" = f."id";

-- Sync trigger: mirror finding_evidence_analyses.importance_score onto findings.
-- On DELETE the WHERE matches nothing when the parent finding is itself being
-- cascade-deleted (row already gone), so it is a harmless no-op in that path.
CREATE OR REPLACE FUNCTION sync_finding_importance_score() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    UPDATE "findings" SET "importance_score" = 0 WHERE "id" = OLD."finding_id";
    RETURN OLD;
  ELSE
    UPDATE "findings" SET "importance_score" = NEW."importance_score"
    WHERE "id" = NEW."finding_id"
      AND "importance_score" IS DISTINCT FROM NEW."importance_score";
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_finding_importance_score ON "finding_evidence_analyses";
CREATE TRIGGER trg_sync_finding_importance_score
AFTER INSERT OR DELETE OR UPDATE OF "importance_score" ON "finding_evidence_analyses"
FOR EACH ROW EXECUTE FUNCTION sync_finding_importance_score();

-- CreateIndex
CREATE INDEX "findings_importance_score_last_detected_at_idx" ON "findings" ("importance_score" DESC, "last_detected_at" DESC);

-- CreateIndex
CREATE INDEX "findings_detected_at_idx" ON "findings" ("detected_at");

-- CreateIndex
CREATE INDEX "findings_status_detected_at_idx" ON "findings" ("status", "detected_at");
