-- Enable trigram extension for fast ILIKE full-text search on text columns.
-- This is idempotent and safe to run on existing databases.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index on matched_content so ILIKE '%q%' scans use the index
-- instead of doing a sequential table scan.
CREATE INDEX IF NOT EXISTS "findings_matched_content_trgm_idx"
  ON "findings" USING GIN ("matched_content" gin_trgm_ops);
