-- Correlation finding nodes used to repeat the full normalized value in both
-- `label` and `matchedContent`. Mark existing derived snapshots stale so the
-- background refresher republishes them in the compact format.
UPDATE "correlation_graph_snapshot"
SET
  "requested_version" = "requested_version" + 1,
  "last_invalidation" = 'graph payload format compacted',
  "updated_at" = CURRENT_TIMESTAMP;
