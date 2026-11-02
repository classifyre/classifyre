-- Notebooks can now tag and link assets of other sources. Say who did.
--
-- A tag is a finding and a link is an edge; neither recorded an author because
-- the asset's own source was always the author. These columns name the source
-- that asserted the row and the run that last did, so a run can retire exactly
-- what it stopped asserting and nothing a connector, a person or another
-- source wrote.
ALTER TABLE "findings" ADD COLUMN "asserted_by_source_id" TEXT,
                       ADD COLUMN "asserted_by_runner_id" TEXT;
ALTER TABLE "findings" ADD CONSTRAINT "findings_asserted_by_source_id_fkey"
  FOREIGN KEY ("asserted_by_source_id") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "findings_asserted_by_source_id_asserted_by_runner_id_idx"
  ON "findings"("asserted_by_source_id", "asserted_by_runner_id");

ALTER TABLE "edges" ADD COLUMN "asserted_by_source_id" TEXT,
                    ADD COLUMN "asserted_by_runner_id" TEXT;
CREATE INDEX "edges_asserted_by_source_id_asserted_by_runner_id_idx"
  ON "edges"("asserted_by_source_id", "asserted_by_runner_id");

-- ctx.query_assets() no longer has a per-run call budget; the counter is dead.
ALTER TABLE "runners" DROP COLUMN "asset_query_calls";
