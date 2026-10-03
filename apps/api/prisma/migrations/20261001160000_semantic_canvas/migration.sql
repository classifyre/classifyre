-- SL5 · Semantic canvas: TERM items on the case board and the workspace
-- semantic map rollups (docs/prd/SL5-semantic-canvas.md).

ALTER TYPE "CaseBoardItemKind" ADD VALUE IF NOT EXISTS 'TERM';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_TERM_PLACED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_TERM_REMOVED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'MEANING_LINKED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'MEANING_UNLINKED';

CREATE TABLE "term_graph_nodes" (
  "term_id"            TEXT         NOT NULL,
  "scheme_id"          TEXT,
  "direct_asset_count" INTEGER      NOT NULL,
  "total_asset_count"  INTEGER      NOT NULL,
  "finding_count"      INTEGER      NOT NULL,
  "source_count"       INTEGER      NOT NULL,
  "severity_counts"    JSONB        NOT NULL,
  "last_linked_at"     TIMESTAMP(3),
  CONSTRAINT "term_graph_nodes_pkey" PRIMARY KEY ("term_id")
);

CREATE TABLE "term_graph_links" (
  "term_a_id"   TEXT          NOT NULL,
  "term_b_id"   TEXT          NOT NULL,
  "kind"        TEXT          NOT NULL,
  "label"       TEXT          NOT NULL DEFAULT '',
  "asset_count" INTEGER       NOT NULL DEFAULT 0,
  "lift"        DECIMAL(8,3),
  CONSTRAINT "term_graph_links_pkey" PRIMARY KEY ("term_a_id", "term_b_id", "kind", "label")
);
CREATE INDEX "term_graph_links_term_a_id_idx" ON "term_graph_links"("term_a_id");

CREATE TABLE "term_graph_state" (
  "id"           TEXT         NOT NULL DEFAULT 'singleton',
  "refreshed_at" TIMESTAMP(3),
  "duration_ms"  INTEGER,
  "is_built"     BOOLEAN      NOT NULL DEFAULT false,
  "updated_at"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "term_graph_state_pkey" PRIMARY KEY ("id")
);
