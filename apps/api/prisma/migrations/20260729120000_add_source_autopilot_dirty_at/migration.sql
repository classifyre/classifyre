-- Coalescing window for autopilot cycles.
--
-- A completed scan used to enqueue its own autopilot cycle, debounced only per
-- source (`singletonKey: autopilot:<sourceId>`). With 151 sources that is 151
-- independent cycles of five agents each, every one of them reasoning over
-- whatever fraction of the corpus happened to have landed, and none of them
-- aware of the others.
--
-- `autopilot_dirty_at` is stamped when a scan completes and acknowledged after
-- a corpus-wide cycle succeeds. The set of non-null rows IS the pending batch,
-- so the window needs no separate cycle-state table and no second writer to
-- keep in sync.
--
-- prisma migrate runs each migration inside a transaction, so no transaction
-- control and no CREATE INDEX CONCURRENTLY here. Every statement is idempotent
-- so a partially-applied migration can be re-run.

-- AlterTable. Nullable with no default: existing sources start clean, and the
-- first scan to complete after the upgrade enrolls its source in a batch.
ALTER TABLE "sources" ADD COLUMN IF NOT EXISTS "autopilot_dirty_at" TIMESTAMP(3);

-- CreateIndex. The cycle reads the dirty set on every run and acknowledges it
-- after success; a partial index would be tighter but Prisma cannot express
-- one, and drift between the schema and the DB costs more than the few pages
-- this index takes.
CREATE INDEX IF NOT EXISTS "sources_autopilot_dirty_at_idx" ON "sources" ("autopilot_dirty_at");

-- CreateIndex. Corpus-coverage facts count never-scanned sources with
-- `last_run_at IS NULL` on every system-brief render (i.e. once per agent run).
CREATE INDEX IF NOT EXISTS "sources_last_run_at_idx" ON "sources" ("last_run_at");
