-- Store embeddings at half precision.
--
-- `halfvec` is two bytes a dimension instead of four. Measured on a 879,135-row
-- space at 384 dimensions: pg_column_size(vec) was 1,544 bytes against 776 as
-- halfvec, and content_embeddings was 3,757 MB in total — a 1,723 MB heap and a
-- 1,717 MB partial HNSW index. Both halve.
--
-- Half precision was already the representation for 2,001-4,000 dimensions,
-- because it is the only one pgvector can HNSW-index that high. This makes it
-- the representation everywhere, which removes the branch rather than adding
-- one. It is the single lossy change in this set: float16 carries about three
-- decimal digits, and with components in [-1, 1] under cosine the neighbour
-- ordering is effectively unchanged, but it is an approximation.
--
-- The per-space HNSW indexes are dropped rather than converted. ALTER TYPE
-- rebuilds every dependent index inline, and building one of these was measured
-- at roughly twenty minutes for 879k vectors — far too long to sit inside a
-- boot-time migration, and pointless here besides, since the expression has to
-- change anyway. EmbeddingService.ensureHnswIndex rebuilds them CONCURRENTLY in
-- the background on the next start; until then similarity queries fall back to
-- a sequential scan, which is slower and never wrong.
--
-- The index names are generated per space (content_embeddings_<space uuid with
-- the dashes removed>_hnsw) and are not in Prisma's migration history, so they
-- are found by pattern rather than named.
DO $$
DECLARE
  idx record;
BEGIN
  FOR idx IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema()
      AND c.relkind = 'i'
      AND c.relname LIKE 'content\_embeddings\_%\_hnsw'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I.%I', current_schema(), idx.relname);
  END LOOP;
END $$;

-- Fail early, and say something useful, if any vector cannot survive the cast.
--
-- The cast rejects a component whose magnitude exceeds the float16 range
-- (~65504) with `"70000" is out of range for type halfvec` -- no table, no
-- row, no count, thrown from inside an ALTER that the boot-time migrator will
-- then retry on every restart. This turns that into one actionable line.
--
-- Not a NaN check: pgvector refuses NaN and infinity at the `vector` type
-- itself ("NaN not allowed in vector"), so a non-finite component cannot be
-- stored in this column at all. Overflow is the only reachable failure, and
-- only for a space configured without normalization -- a normalized embedding
-- has components in [-1, 1]. Measured on a 879,135-row space, the largest
-- absolute component was 0.166.
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad
  FROM (
    SELECT max(abs(component)) AS peak
    FROM content_embeddings,
         LATERAL unnest(vec::real[]) AS component
    GROUP BY ctid
  ) magnitudes
  WHERE peak > 65504;

  IF bad > 0 THEN
    RAISE EXCEPTION
      'Cannot store embeddings at half precision: % row(s) in content_embeddings have a component above the float16 range (65504). That space is not normalized. Re-embed it with normalization enabled, or delete those rows (reconciliation re-creates them), then re-run this migration.', bad;
  END IF;
END $$;

-- Schema-qualified. Migrations run with search_path set to the tenant schema
-- (ns_<uuid>), and pgvector's types live in public, so a bare `halfvec` here
-- fails with "type halfvec does not exist" on every namespace -- while passing
-- against a shadow database created in public.
ALTER TABLE "content_embeddings"
  ALTER COLUMN "vec" TYPE public.halfvec USING "vec"::public.halfvec;
