-- Missing-text coverage, so an empty OCR result stops being invisible.
--
-- OCR and transcription returning nothing produced no asset error, no warning,
-- and no counter — the run reported complete success while covering none of the
-- asset's actual content. Across the first corpus, 718 OCR calls returned empty
-- (409 in one dataset alone) and every runner still reported zero errors.
--
-- This is deliberately not modelled as an error: nothing failed. It is coverage
-- — the content was never read — and it belongs next to the other counters an
-- operator reads to decide whether a run can be trusted.

ALTER TABLE "runner_assets" ADD COLUMN "empty_text" BOOLEAN;

ALTER TABLE "runners" ADD COLUMN "assets_without_text" INTEGER NOT NULL DEFAULT 0;

-- Supports the per-run coverage count.
CREATE INDEX "runner_assets_runner_id_empty_text_idx"
  ON "runner_assets"("runner_id", "empty_text");
