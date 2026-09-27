-- Escalation rules: the other action of a case finding rule. A filter keeps a
-- kind of finding out of a case; an escalation marks it — highlighted on the
-- board, counted on the case, brought in by a watch even with auto-add off.
--
-- No backfill: every existing rule stays a filter (the column default) and no
-- finding is escalated.

-- ─── Timeline activity types ──────────────────────────────────────────────────
-- Idempotent and legal inside a transaction while unused in it.
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'FINDINGS_ESCALATED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'ESCALATION_CLEARED';

-- ─── Rules: filter or escalate ────────────────────────────────────────────────
CREATE TYPE "CaseFindingRuleAction" AS ENUM ('EXCLUDE', 'ESCALATE');

ALTER TABLE "case_finding_filters"
  ADD COLUMN "action" "CaseFindingRuleAction" NOT NULL DEFAULT 'EXCLUDE';

-- ─── Escalated findings ───────────────────────────────────────────────────────
ALTER TABLE "case_findings"
  ADD COLUMN "escalated_at"       TIMESTAMP(3),
  ADD COLUMN "escalation_rule_id" TEXT,
  ADD COLUMN "escalation_label"   TEXT;

CREATE INDEX "case_findings_case_id_escalated_at_idx"
  ON "case_findings"("case_id", "escalated_at");

ALTER TABLE "cases"
  ADD COLUMN "last_escalated_at" TIMESTAMP(3);
