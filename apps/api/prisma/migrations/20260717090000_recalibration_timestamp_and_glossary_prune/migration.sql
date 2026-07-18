-- Persist recalibration completion so status survives API restarts.
ALTER TABLE "embedding_spaces"
  ADD COLUMN "last_recalibrated_at" TIMESTAMP(3);

-- The provenance migration seeded glossary_terms from legacy agent-memory
-- GLOSSARY entries. Those keys are machine slugs (snake_case observations,
-- not vocabulary) and pollute the operator-facing glossary. Remove
-- agent-origin machine-slug terms; operator-created terms are untouched.
DELETE FROM "glossary_terms"
WHERE "origin" = 'AGENT'
  AND "term" ~ '^[a-z0-9]+(_[a-z0-9]+)+$';
