-- Case board: the investigation canvas (docs/architecture/CASE_BOARD_PRD.md).
--
-- The board stores view state only (positions, sizes, colours, grouping) plus
-- the objects that exist nowhere else — sticky notes, frames and the links a
-- person drew on this one board. Evidence, findings and hypotheses stay in the
-- case tables they already live in.
--
-- No backfill: boards and their items are created lazily the first time a case
-- board is opened.

-- ─── Timeline activity types ──────────────────────────────────────────────────
-- `ADD VALUE IF NOT EXISTS` is idempotent and legal inside a transaction as long
-- as the new value is not used in it, so it replays safely across every tenant
-- schema. Nothing below uses these values.
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_NOTE_ADDED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_NOTE_UPDATED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_NOTE_REMOVED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_FRAME_ADDED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_FRAME_UPDATED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_FRAME_REMOVED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_LINK_ADDED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_LINK_UPDATED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_LINK_REMOVED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_LINK_PROMOTED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_ITEM_HIGHLIGHTED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_ARRANGED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'BOARD_SNAPSHOT_TAKEN';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'COMMENT_RESOLVED';

-- ─── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE "CaseBoardItemKind" AS ENUM ('EVIDENCE', 'HYPOTHESIS', 'COMMENT', 'NOTE', 'FRAME');
CREATE TYPE "BoardLinkCertainty" AS ENUM ('CONFIRMED', 'SUSPECTED');

-- ─── Existing tables ──────────────────────────────────────────────────────────
-- Rollout switch, per workspace. Off keeps the legacy case graph.
ALTER TABLE "instance_settings"
  ADD COLUMN "case_board_enabled" BOOLEAN NOT NULL DEFAULT false;

-- DISCUSSION threads double as board comments; resolving greys the pin.
ALTER TABLE "case_threads"
  ADD COLUMN "resolved_at" TIMESTAMP(3),
  ADD COLUMN "resolved_by" TEXT;

-- ─── case_boards ──────────────────────────────────────────────────────────────
CREATE TABLE "case_boards" (
  "id"         TEXT         NOT NULL,
  "case_id"    TEXT         NOT NULL,
  "version"    INTEGER      NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "case_boards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "case_boards_case_id_key" ON "case_boards"("case_id");

ALTER TABLE "case_boards"
  ADD CONSTRAINT "case_boards_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── case_board_items ─────────────────────────────────────────────────────────
CREATE TABLE "case_board_items" (
  "id"         TEXT                NOT NULL,
  "board_id"   TEXT                NOT NULL,
  "kind"       "CaseBoardItemKind" NOT NULL,
  "ref_id"     TEXT,
  "x"          DOUBLE PRECISION,
  "y"          DOUBLE PRECISION,
  "width"      DOUBLE PRECISION,
  "height"     DOUBLE PRECISION,
  "z"          INTEGER             NOT NULL DEFAULT 0,
  "parent_id"  TEXT,
  "collapsed"  BOOLEAN             NOT NULL DEFAULT false,
  "style"      JSONB,
  "content"    JSONB,
  "created_by" TEXT,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3)        NOT NULL,
  "deleted_at" TIMESTAMP(3),

  CONSTRAINT "case_board_items_pkey" PRIMARY KEY ("id")
);

-- One item per domain row. Notes and frames carry no ref_id, and NULLs are
-- distinct in a unique index, so they never collide. The lazy reconcile's
-- ON CONFLICT (board_id, kind, ref_id) DO NOTHING relies on this index.
CREATE UNIQUE INDEX "case_board_items_board_id_kind_ref_id_key"
  ON "case_board_items"("board_id", "kind", "ref_id");
CREATE INDEX "case_board_items_board_id_deleted_at_idx"
  ON "case_board_items"("board_id", "deleted_at");
CREATE INDEX "case_board_items_parent_id_idx"
  ON "case_board_items"("parent_id");

ALTER TABLE "case_board_items"
  ADD CONSTRAINT "case_board_items_board_id_fkey"
  FOREIGN KEY ("board_id") REFERENCES "case_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_board_items"
  ADD CONSTRAINT "case_board_items_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "case_board_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── case_board_links ─────────────────────────────────────────────────────────
-- Links drawn on one board. Deliberately not in `edges`: a link drawn in one
-- case must not surface in another case or in lineage.
CREATE TABLE "case_board_links" (
  "id"                TEXT                 NOT NULL,
  "board_id"          TEXT                 NOT NULL,
  "source_item_id"    TEXT                 NOT NULL,
  "source_finding_id" TEXT,
  "target_item_id"    TEXT                 NOT NULL,
  "target_finding_id" TEXT,
  "kind"              TEXT                 NOT NULL,
  "label"             TEXT,
  "certainty"         "BoardLinkCertainty" NOT NULL DEFAULT 'CONFIRMED',
  "confidence"        DECIMAL(3,2),
  "note"              TEXT,
  "promoted_edge_id"  TEXT,
  "created_by"        TEXT,
  "updated_by"        TEXT,
  "created_at"        TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3)         NOT NULL,
  "deleted_at"        TIMESTAMP(3),

  CONSTRAINT "case_board_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "case_board_links_board_id_deleted_at_idx"
  ON "case_board_links"("board_id", "deleted_at");
CREATE INDEX "case_board_links_source_item_id_idx"
  ON "case_board_links"("source_item_id");
CREATE INDEX "case_board_links_target_item_id_idx"
  ON "case_board_links"("target_item_id");

ALTER TABLE "case_board_links"
  ADD CONSTRAINT "case_board_links_board_id_fkey"
  FOREIGN KEY ("board_id") REFERENCES "case_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── case_board_snapshots ─────────────────────────────────────────────────────
CREATE TABLE "case_board_snapshots" (
  "id"         TEXT         NOT NULL,
  "board_id"   TEXT         NOT NULL,
  "reason"     TEXT         NOT NULL,
  "version"    INTEGER      NOT NULL,
  "payload"    JSONB        NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "case_board_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "case_board_snapshots_board_id_created_at_idx"
  ON "case_board_snapshots"("board_id", "created_at" DESC);

ALTER TABLE "case_board_snapshots"
  ADD CONSTRAINT "case_board_snapshots_board_id_fkey"
  FOREIGN KEY ("board_id") REFERENCES "case_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
