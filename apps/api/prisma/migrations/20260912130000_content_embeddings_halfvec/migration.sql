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

-- Schema-qualified. Migrations run with search_path set to the tenant schema
-- (ns_<uuid>), and pgvector's types live in public, so a bare `halfvec` here
-- fails with "type halfvec does not exist" on every namespace -- while passing
-- against a shadow database created in public.
ALTER TABLE "content_embeddings"
  ALTER COLUMN "vec" TYPE public.halfvec USING "vec"::public.halfvec;
