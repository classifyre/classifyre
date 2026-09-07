-- Pre-aggregated source connection map, for the workspace dashboard.
--
-- The dashboard opens on "how do my sources connect". Answering that from
-- `edges` means joining it to `assets` twice over the whole corpus, and the
-- question is asked on every visit — the same shape of query the finding-stats
-- rollup was built to eliminate.
--
-- Nothing here is ever truncated. The grain is what keeps the payload small: a
-- workspace with two million assets across twelve sources produces twelve rows
-- in source_graph_nodes and a few dozen in source_graph_links, because the
-- tables are keyed by source rather than by asset. Assets with no edges at all
-- produce no rows anywhere — they are a subtraction on their source's row.

CREATE TABLE IF NOT EXISTS "source_graph_nodes" (
  "source_id" TEXT NOT NULL,
  "asset_count" INTEGER NOT NULL,
  "connected_asset_count" INTEGER NOT NULL,
  "internal_edge_count" INTEGER NOT NULL,
  "finding_count" INTEGER NOT NULL,
  "severity_counts" JSONB NOT NULL,
  CONSTRAINT "source_graph_nodes_pkey" PRIMARY KEY ("source_id")
);

-- Split by relation class rather than totalled: FLOW is lineage, IDENTITY is
-- the same thing seen twice, REFERENCE propagates nothing. They are different
-- questions, and the canvas filters to one at a time.
CREATE TABLE IF NOT EXISTS "source_graph_links" (
  "source_a_id" TEXT NOT NULL,
  "source_b_id" TEXT NOT NULL,
  "relation_class" "EdgeClass" NOT NULL,
  "edge_count" INTEGER NOT NULL,
  "asset_count" INTEGER NOT NULL,
  CONSTRAINT "source_graph_links_pkey"
    PRIMARY KEY ("source_a_id", "source_b_id", "relation_class")
);

CREATE INDEX IF NOT EXISTS "source_graph_links_source_a_id_idx"
  ON "source_graph_links" ("source_a_id");

-- The assets worth drawing on their own: the ones whose edges leave their
-- source.
--
-- peer_source_id holds the literal 'external' rather than NULL when the far end
-- is an endpoint nothing has scanned yet. It is part of the primary key, and
-- Postgres treats NULLs as distinct, so a nullable column would quietly allow
-- duplicate rows for one asset. Source ids are UUIDs; the sentinel cannot
-- collide with a real one.
CREATE TABLE IF NOT EXISTS "source_graph_boundary_assets" (
  "asset_id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "peer_source_id" TEXT NOT NULL,
  "relation_class" "EdgeClass" NOT NULL,
  "edge_count" INTEGER NOT NULL,
  CONSTRAINT "source_graph_boundary_assets_pkey"
    PRIMARY KEY ("asset_id", "peer_source_id", "relation_class")
);

CREATE INDEX IF NOT EXISTS "source_graph_boundary_assets_source_id_idx"
  ON "source_graph_boundary_assets" ("source_id");

CREATE TABLE IF NOT EXISTS "source_graph_state" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "refreshed_at" TIMESTAMP(3),
  "duration_ms" INTEGER,
  "is_built" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "source_graph_state_pkey" PRIMARY KEY ("id")
);
