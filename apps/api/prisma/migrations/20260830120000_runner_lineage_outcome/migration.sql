-- What happened to a run's lineage, so a run can no longer claim an
-- unqualified success while having shipped no relationship edges at all.
--
-- A connector's relationships() can raise, or its assembled edges can fail to
-- send, while every asset it produced lands perfectly. Neither asset errors nor
-- per-detector outcomes can see that, which is how a run created 920 assets,
-- emitted ZERO edges, and reported COMPLETED with the cause visible only in a
-- Kubernetes job log.
--
-- Four counters rather than one, because they are different claims:
--   emitted  - edges the API accepted and resolved.
--   failed   - relationship PASSES that raised. A pass that failed never got to
--              say how many edges it would have produced, so counting edges
--              here would be a fabricated number.
--   lost     - edges assembled and then not sent. A real edge count.
--   dropped  - edges accepted but with an endpoint the API could not resolve.
--              Expected in small numbers (the other half may be ingested later),
--              so this one never downgrades a run on its own.
ALTER TABLE "runners"
  ADD COLUMN IF NOT EXISTS "relationships_emitted" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "relationships_failed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "relationships_lost" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "relationships_dropped" INTEGER NOT NULL DEFAULT 0;
