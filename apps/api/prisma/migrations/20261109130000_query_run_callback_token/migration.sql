-- A query job posts its result with a token good for that one run; the run
-- keeps its sha256 until the result is in (docs/prd/DQ-data-query.md §5.4).
ALTER TABLE "query_runs" ADD COLUMN IF NOT EXISTS "callback_token_hash" TEXT;
