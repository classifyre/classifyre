-- Hybrid asset search reads the words of passages (POST /search/assets).
--
-- An expression index over asset_chunks.text was not enough: the planner finds
-- the passages that hold a word, but every one of them is then tokenised again
-- to be ranked, and a question with a few ordinary words ("revenue", "year")
-- ranks thousands (5 s on 19,000 passages). The words are kept as a column
-- instead, generated from the text, and indexed — the same GIN index over words
-- that findings (findings_matched_content_fts_idx) and asset names already have.
--
-- Figures are squeezed first: a separator between two digits is dropped, so
-- "10,114.8" and a PDF converter's "10 ,114 . 8" are both the word 101148. The
-- search squeezes the question the same way (FIGURE_SEPARATORS in
-- chunk-lexical.ts, asserted equal to the pattern here in its spec).
ALTER TABLE "asset_chunks"
  ADD COLUMN IF NOT EXISTS "text_tsv" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('simple', regexp_replace("text", '(\d)\s?[.,]\s?(?=\d)', '\1', 'g'))
  ) STORED;

CREATE INDEX IF NOT EXISTS "asset_chunks_text_tsv_idx"
  ON "asset_chunks" USING GIN ("text_tsv");
