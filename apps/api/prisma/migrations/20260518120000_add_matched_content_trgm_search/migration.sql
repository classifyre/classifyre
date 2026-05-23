-- Replaced pg_trgm GIN index with standard PostgreSQL full-text search.
-- pg_trgm is not available in all PostgreSQL distributions.
-- Note: full-text search matches whole words only; partial-word searches
-- (e.g. "AKIAI" to find "AKIAIOSFODNN7EXAMPLE") are not supported.
CREATE INDEX IF NOT EXISTS "findings_matched_content_fts_idx"
  ON "findings" USING GIN (to_tsvector('simple', "matched_content"));
