-- Hypothesis rules: a case's own handling of what a watch brings in.
--
-- A rule says "answers of this watch go to this hypothesis with this stance"
-- (supports, contradicts, neutral), optionally only the answers of one finding
-- type or matching a value pattern. The case links each arrival itself and the
-- board lands it next to the hypothesis. Rules live on the case, like finding
-- filters: the watch is untouched.
--
-- No backfill: no case has a rule, so every existing case behaves as before.

-- ─── Timeline activity types ──────────────────────────────────────────────────
-- `ADD VALUE IF NOT EXISTS` is idempotent and legal inside a transaction as long
-- as the new value is not used in it, so it replays safely across every tenant
-- schema. Nothing below uses these values.
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'HYPOTHESIS_RULE_ADDED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'HYPOTHESIS_RULE_UPDATED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'HYPOTHESIS_RULE_REMOVED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'FINDINGS_AUTO_LINKED';
ALTER TYPE "CaseActivityType" ADD VALUE IF NOT EXISTS 'THREAD_EVIDENCE_REMOVED';

-- ─── case_hypothesis_rules ────────────────────────────────────────────────────
CREATE TABLE "case_hypothesis_rules" (
  "id"              TEXT                    NOT NULL,
  "case_id"         TEXT                    NOT NULL,
  "case_inquiry_id" TEXT                    NOT NULL,
  "thread_id"       TEXT                    NOT NULL,
  "stance"          "EvidenceStance"        NOT NULL DEFAULT 'SUPPORTS',
  "kind"            "CaseFindingFilterKind",
  "pattern"         TEXT,
  "description"     TEXT,
  "created_by"      TEXT,
  "created_at"      TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3)            NOT NULL,

  CONSTRAINT "case_hypothesis_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "case_hypothesis_rules_case_id_idx"
  ON "case_hypothesis_rules"("case_id");
CREATE INDEX "case_hypothesis_rules_case_inquiry_id_idx"
  ON "case_hypothesis_rules"("case_inquiry_id");
CREATE INDEX "case_hypothesis_rules_thread_id_idx"
  ON "case_hypothesis_rules"("thread_id");

ALTER TABLE "case_hypothesis_rules"
  ADD CONSTRAINT "case_hypothesis_rules_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A watch's rules leave with the watch: unlinking deletes the link row.
ALTER TABLE "case_hypothesis_rules"
  ADD CONSTRAINT "case_hypothesis_rules_case_inquiry_id_fkey"
  FOREIGN KEY ("case_inquiry_id") REFERENCES "case_inquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A rule without its hypothesis has nothing to link to.
ALTER TABLE "case_hypothesis_rules"
  ADD CONSTRAINT "case_hypothesis_rules_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "case_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── case_thread_support: which rule made a link ──────────────────────────────
-- Null for a person's own links. Set null when the rule goes: removing a rule
-- keeps the links it made unless the person asked for them to be removed too.
ALTER TABLE "case_thread_support" ADD COLUMN "rule_id" TEXT;
CREATE INDEX "case_thread_support_rule_id_idx" ON "case_thread_support"("rule_id");
ALTER TABLE "case_thread_support"
  ADD CONSTRAINT "case_thread_support_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "case_hypothesis_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
