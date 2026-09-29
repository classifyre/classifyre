-- The case card's thumbnail: the board drawn small, as shapes (see
-- BoardSketch in packages/schemas/src/case-board.ts). One row per board,
-- written by the web board a few seconds after an edit settles.
CREATE TABLE "case_board_thumbnails" (
  "board_id"   TEXT         NOT NULL,
  "sketch"     JSONB        NOT NULL,
  "version"    INTEGER      NOT NULL,
  "signature"  TEXT         NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "case_board_thumbnails_pkey" PRIMARY KEY ("board_id")
);

ALTER TABLE "case_board_thumbnails"
  ADD CONSTRAINT "case_board_thumbnails_board_id_fkey"
  FOREIGN KEY ("board_id") REFERENCES "case_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
