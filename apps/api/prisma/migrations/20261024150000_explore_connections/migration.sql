-- Explore replaces the source connection map.
--
-- The map was a rollup of every edge by source pair, rebuilt by re-joining the
-- whole edges table; nothing reads it any more. Explore asks the edge table
-- about a handful of assets at a time instead.
DROP TABLE IF EXISTS "source_graph_boundary_assets";
DROP TABLE IF EXISTS "source_graph_links";
DROP TABLE IF EXISTS "source_graph_nodes";
DROP TABLE IF EXISTS "source_graph_state";

-- Deleting a source cascaded its assets but left the edges that named them
-- (edges carries no foreign key: an endpoint may be an external URN). Source
-- deletion now removes them in the same transaction; this clears what earlier
-- deletions left behind, so a link never points at an asset that is gone.
DELETE FROM "edges" e
 WHERE e."from_type" = 'asset'
   AND NOT EXISTS (SELECT 1 FROM "assets" a WHERE a."id" = e."from_id");
DELETE FROM "edges" e
 WHERE e."to_type" = 'asset'
   AND NOT EXISTS (SELECT 1 FROM "assets" a WHERE a."id" = e."to_id");

-- Explore lists the links people drew last. They are a handful among millions
-- of edges, so a partial index keeps that a seek instead of a scan.
CREATE INDEX IF NOT EXISTS "edges_manual_created_at_idx"
  ON "edges" ("created_at" DESC)
  WHERE "origin" = 'MANUAL'::"EdgeOrigin";
