-- Phonetic matching now runs per-group in Node (bounded memory) rather than
-- via a SQL self-join that aggregates value pairs into JSONB.  The column is
-- no longer written by the application; drop it if a prior run already added it.
ALTER TABLE "correlation_pair_staging" DROP COLUMN IF EXISTS "phonetic_pairs";
