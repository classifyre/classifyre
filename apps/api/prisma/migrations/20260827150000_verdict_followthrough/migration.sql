-- Let a decision be followed through, and be found again later.
--
-- A confirmed duplicate that produces nothing is not a decision, it is a
-- keystroke. These columns record where a verdict was taken further, so the
-- review queue can show what has been judged but not yet acted on — and so
-- someone who confirmed a pair last week can come back and add it to a case.
ALTER TABLE "correlation_pair_verdicts"
  ADD COLUMN IF NOT EXISTS "case_id" TEXT,
  ADD COLUMN IF NOT EXISTS "inquiry_id" TEXT;

-- The decisions view lists by verdict, newest first.
CREATE INDEX IF NOT EXISTS "correlation_pair_verdicts_verdict_decided_at_idx"
  ON "correlation_pair_verdicts"("verdict", "decided_at");
