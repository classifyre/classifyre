-- Hypotheses currently record only narrative statements, leaving detector authoring
-- without a queryable description of what evidence would settle the claim.
--
-- This is a column rather than another CaseThreadEntry because hypotheses.open queries
-- it every cycle; entries remain the append-only narrative history. It is nullable
-- because existing hypotheses have no honest predicate to backfill.
--
-- Adding a nullable column takes a brief ACCESS EXCLUSIVE lock without rewriting rows.
-- IF NOT EXISTS also covers namespaces provisioned from schema.prisma during deploy.

-- AlterTable
ALTER TABLE "case_threads" ADD COLUMN IF NOT EXISTS "testable_predicate" TEXT;
