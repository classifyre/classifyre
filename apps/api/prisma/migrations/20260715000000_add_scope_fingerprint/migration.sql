-- Scope fingerprinting for safe asset retirement.
--
-- Before this, a full scan (sampling.strategy = ALL) retired every asset absent
-- from the run. That conflated two very different situations: an object being
-- deleted from the source, and the source's scope being narrowed so we stopped
-- looking at the object. Narrowing a populated source therefore destroyed live
-- assets and auto-resolved their findings.
--
-- Assets now record the scope they were last ingested under. Retirement is only
-- permitted when that matches the current scope. Existing rows get NULL, which
-- never matches, so they are retained (not retired) until their next ingest —
-- one deliberately conservative run per source after this migration.

ALTER TABLE "assets" ADD COLUMN "scope_fingerprint" VARCHAR(64);

ALTER TABLE "runners" ADD COLUMN "scope_fingerprint" VARCHAR(64);
ALTER TABLE "runners" ADD COLUMN "assets_out_of_scope" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "assets_source_id_scope_fingerprint_idx"
  ON "assets"("source_id", "scope_fingerprint");
