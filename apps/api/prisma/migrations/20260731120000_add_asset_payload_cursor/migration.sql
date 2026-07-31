-- Payload sampling: remember how far a strategy has read *inside* one asset.
--
-- Source-level sampling bounds how many assets a run touches; it does not bound
-- how much of each asset it reads. A single Parquet object with millions of rows
-- was re-read end to end on every run, so a run with rows_per_page = 100 could
-- never finish. This column holds the row offset reached in that asset's tabular
-- payload, letting the next AUTOMATIC run resume at the next slice.
--
-- Replayed once per tenant schema by database-migrations.ts, so every statement
-- is idempotent and unqualified (it must land in whichever ns_<hex32> schema the
-- search_path points at). Prisma wraps migrations in a transaction, so no
-- CREATE INDEX CONCURRENTLY and no transaction control here.

-- { v, kind, offset, rows_seen, passes, exhausted, checksum, strategy }.
-- Deliberately separate from assets.scan_cache: that column is proof a scan
-- completed and is only written by sources that opted into caching, while a
-- payload cursor is a position and must survive independently of it.
ALTER TABLE "assets" ADD COLUMN IF NOT EXISTS "payload_cursor" JSONB;
