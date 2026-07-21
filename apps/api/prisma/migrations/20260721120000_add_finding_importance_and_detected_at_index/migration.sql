-- Query-speed fix for search/findings, discovery, and charts.
--
-- 1. Denormalize FindingEvidenceAnalysis.importance_score onto findings so the
--    default "sort by importance" search is a single-table index scan instead
--    of a full parallel seq-scan + hash-join + top-N sort across the whole
--    findings/finding_evidence_analyses tables (measured ~1.45 s / ~1 GB reads
--    on ~400k findings). A DB trigger keeps the copy in sync with every writer
--    (insert-time analysis, recalibration, updateMany) without app changes.
-- 2. Add detected_at indexes that the windowed discovery/charts aggregations
--    filter on (previously only first/last_detected_at were indexed).
--
-- Every statement is idempotent, and the historical backfill is batched with
-- FOR UPDATE ... SKIP LOCKED committing per batch. Migrations here run
-- non-transactionally and this file may execute during a rolling deploy while
-- the old pods + an active scan are still writing findings; a single bulk
-- UPDATE deadlocks against that live traffic (error 40P01). The trigger is
-- created BEFORE the backfill so no concurrent write is missed in between.

-- AlterTable. NOT NULL DEFAULT 0 so unanalyzed findings sort last under a plain
-- DESC order (no NULLS-FIRST/LAST handling needed, so the Prisma @@index and the
-- physical index stay identical and migrate stays drift-free).
ALTER TABLE "findings" ADD COLUMN IF NOT EXISTS "importance_score" DOUBLE PRECISION NOT NULL DEFAULT 0;

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

-- Deadlock-proof historical backfill: small batches, skipping rows currently
-- locked by live ingestion (they are caught on a later sweep, or synced by the
-- trigger once ingestion commits), committing each batch so locks are released.
CREATE OR REPLACE PROCEDURE pg_temp_backfill_finding_importance() AS $$
DECLARE
  updated integer;
BEGIN
  LOOP
    WITH todo AS (
      SELECT f."id", e."importance_score" AS score
      FROM "findings" f
      JOIN "finding_evidence_analyses" e ON e."finding_id" = f."id"
      WHERE f."importance_score" IS DISTINCT FROM e."importance_score"
      FOR UPDATE OF f SKIP LOCKED
      LIMIT 5000
    )
    UPDATE "findings" f
    SET "importance_score" = todo.score
    FROM todo
    WHERE f."id" = todo."id";
    GET DIAGNOSTICS updated = ROW_COUNT;
    COMMIT;
    EXIT WHEN updated = 0;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

CALL pg_temp_backfill_finding_importance();
DROP PROCEDURE pg_temp_backfill_finding_importance();

-- CreateIndex
CREATE INDEX IF NOT EXISTS "findings_importance_score_last_detected_at_idx" ON "findings" ("importance_score" DESC, "last_detected_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "findings_detected_at_idx" ON "findings" ("detected_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "findings_status_detected_at_idx" ON "findings" ("status", "detected_at");
