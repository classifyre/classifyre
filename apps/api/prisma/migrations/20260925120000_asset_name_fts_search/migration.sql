-- Search as you type over asset names (POST /search/quick). A substring match
-- on names has no index to use, so a query that matched nothing read every
-- asset. Word prefixes go through this index instead, as finding content
-- already does (findings_matched_content_fts_idx), with the same trade-off:
-- whole words and their beginnings, not text in the middle of a word — the
-- search falls back to a short, time-capped substring scan for those.
CREATE INDEX IF NOT EXISTS "assets_name_fts_idx"
  ON "assets" USING GIN (to_tsvector('simple', "name"));
