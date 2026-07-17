ALTER TABLE "glossary_terms"
ADD COLUMN "proposed_aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
