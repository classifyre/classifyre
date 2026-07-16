-- Per-run asset lifecycle, so runner counters mean what they say.
--
-- assetsCreated/Updated/Unchanged were counted from assets.status — the
-- asset's *current* state, which every later run overwrites. Worse, the CLI
-- ingests in two passes (stubs first, then the payload with findings), so an
-- asset created by pass 1 was seen as unchanged by pass 2 and every asset on a
-- first run ended up UNCHANGED. A ten-asset first run reported
-- "assetsCreated: 0, assetsUnchanged: 10".
--
-- change_type records what a given run did to a given asset and is never
-- rewritten by a later run. Existing rows get NULL and are reported as
-- unknown rather than being guessed at.

CREATE TYPE "RunnerAssetChangeType" AS ENUM ('CREATED', 'UPDATED', 'UNCHANGED', 'DELETED');

ALTER TABLE "runner_assets" ADD COLUMN "change_type" "RunnerAssetChangeType";

-- Findings first seen by a run, as opposed to total_findings, which is the
-- post-reconciliation set currently associated with it.
ALTER TABLE "runners" ADD COLUMN "findings_created" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "runner_assets_runner_id_change_type_idx"
  ON "runner_assets"("runner_id", "change_type");
