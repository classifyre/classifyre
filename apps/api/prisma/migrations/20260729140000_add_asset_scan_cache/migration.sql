-- Scan cache: let a run skip assets whose content and detector configuration
-- have not moved since their last completed scan.
--
-- Replayed once per tenant schema by database-migrations.ts, so every statement
-- is idempotent and unqualified (it must land in whichever ns_<hex32> schema the
-- search_path points at). Prisma wraps migrations in a transaction, so no
-- CREATE INDEX CONCURRENTLY and no transaction control here.

-- SHA-256 of the bytes actually scanned. Distinct from assets.checksum, which
-- hashes source-reported metadata (for a local folder, only mtime and size) and
-- therefore cannot distinguish a restored backup from an unmodified file.
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "content_hash" VARCHAR(64);

-- Per-detector configuration fingerprints plus the statistics a skipped run
-- should report. Written only after everything for the asset succeeded, so its
-- presence is what proves the previous scan completed.
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "scan_cache" JSONB;

CREATE INDEX IF NOT EXISTS "assets_source_id_content_hash_idx"
  ON "assets" ("source_id", "content_hash");

ALTER TABLE "runners"
  ADD COLUMN IF NOT EXISTS "assets_skipped_cached" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "runners"
  ADD COLUMN IF NOT EXISTS "detector_runs_skipped" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "runner_assets"
  ADD COLUMN IF NOT EXISTS "cache_hit" BOOLEAN NOT NULL DEFAULT false;
