-- DropForeignKey
ALTER TABLE "metric_definitions" DROP CONSTRAINT IF EXISTS "metric_definitions_glossary_term_id_fkey";

-- DropIndex
DROP INDEX IF EXISTS "metric_definitions_glossary_term_id_idx";

-- AlterTable
ALTER TABLE "metric_definitions" DROP COLUMN IF EXISTS "glossary_term_id";

-- DropTable
DROP TABLE IF EXISTS "glossary_terms";

-- DropTable
DROP TABLE IF EXISTS "metric_dashboard_placements";
