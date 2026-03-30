-- Remove slug columns from glossary_terms and metric_definitions.
-- Records are now identified exclusively by their UUID id.

ALTER TABLE "glossary_terms" DROP COLUMN IF EXISTS "slug";
ALTER TABLE "metric_definitions" DROP COLUMN IF EXISTS "slug";
