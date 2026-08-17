-- Per-agent scheduling policy for the harness.
--
-- The harness had one cadence and one readiness gate for every agent, so each
-- one was paced by the slowest thing in the instance. Measured on a live
-- 151-source workspace: ESCALATION completes in 2.8 minutes and CONFIG in 2.2
-- hours, and both waited behind the same gate — `inquiry.match.source` holding
-- 16 jobs at ~579 s apiece. Only the deterministic DUPLICATES step ran for two
-- days; every LLM agent's last attempt failed with "Run exceeded its maximum
-- lifetime", a constant nobody could change.
--
-- Two needs were conflated. Some work must react to new data immediately (a new
-- asset reaching the glossary, an inquiry match, a case escalation); other work
-- needs the whole corpus settled to decide well (detector tuning, inquiry
-- portfolio design). One timer cannot serve both, so each agent now carries its
-- own trigger mode and its own gates, and time survives only as a guardrail —
-- a floor between runs and a staleness backstop.
--
-- Every added column is nullable (agent_configs) or carries the value its
-- hardcoded constant already held (instance_settings), so an upgraded instance
-- behaves exactly as it did before an operator changes anything.
--
-- Replayed once per tenant schema by database-migrations.ts, so every statement
-- is idempotent and unqualified (it must land in whichever ns_<hex32> schema the
-- search_path points at). Prisma wraps migrations in a transaction, so no
-- CREATE INDEX CONCURRENTLY and no transaction control here.

-- CreateEnum
DO $$
BEGIN
  CREATE TYPE "AgentTriggerMode" AS ENUM ('EAGER', 'BATCH', 'SETTLED', 'SCHEDULED', 'MANUAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: per-agent policy. NULL means "follow the shipped default", the
-- same convention `goal` and `max_iterations` already use — an agent nobody has
-- touched keeps tracking the defaults rather than freezing at whatever they
-- were the day its row happened to be created.
ALTER TABLE "agent_configs"
  ADD COLUMN IF NOT EXISTS "trigger_mode" "AgentTriggerMode",
  ADD COLUMN IF NOT EXISTS "wait_for_matching" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "wait_for_evidence" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "wait_for_scans" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "min_interval_minutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "max_staleness_hours" INTEGER,
  ADD COLUMN IF NOT EXISTS "run_budget_minutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "last_triggered_at" TIMESTAMP(3);

-- AlterTable: harness limits promoted from constants in autopilot.constants.ts
-- and agent-loop.ts. Defaults are the values those constants held.
ALTER TABLE "instance_settings"
  ADD COLUMN IF NOT EXISTS "harness_run_budget_minutes" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "harness_run_stale_after_minutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "harness_cycle_budget_minutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "harness_evidence_usable_findings" INTEGER NOT NULL DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS "harness_evidence_usable_coverage" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS "harness_evidence_warn_coverage" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS "harness_express_importance" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  ADD COLUMN IF NOT EXISTS "harness_observation_chars" INTEGER NOT NULL DEFAULT 8000,
  ADD COLUMN IF NOT EXISTS "harness_turn_observation_chars" INTEGER NOT NULL DEFAULT 24000,
  ADD COLUMN IF NOT EXISTS "harness_max_ranked_findings" INTEGER NOT NULL DEFAULT 25,
  ADD COLUMN IF NOT EXISTS "harness_max_glossary_entries" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "harness_max_recalled_memories" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "harness_dream_interval_days" INTEGER NOT NULL DEFAULT 2;

-- DropColumn: these six were written by the settings API and read by nothing.
-- Per-agent prompt steering moved to AgentConfig.goal when the harness gained
-- its own agent-config layer, and these were left behind looking configurable
-- while having no effect on any run. Dropping them rather than leaving a
-- surface that silently does nothing.
ALTER TABLE "instance_settings"
  DROP COLUMN IF EXISTS "autopilot_inquiry_desired",
  DROP COLUMN IF EXISTS "autopilot_inquiry_searchable",
  DROP COLUMN IF EXISTS "autopilot_case_guidance",
  DROP COLUMN IF EXISTS "autopilot_config_guidance",
  DROP COLUMN IF EXISTS "autopilot_detector_guidance",
  DROP COLUMN IF EXISTS "autopilot_escalation_guidance";
