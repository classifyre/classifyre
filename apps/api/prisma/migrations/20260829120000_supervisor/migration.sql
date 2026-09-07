-- The supervisor: a self-directed control loop above the existing missions.
--
-- Everything here exists so one agent can hold an intention across days without
-- holding a conversation across days. Its continuity is these rows, not a
-- carried transcript, which is what keeps it affordable and what makes every
-- step of it reviewable after the fact.

-- ── Enums ────────────────────────────────────────────────────────────────────
-- Written by hand. A generated migration alone has broken production here
-- before: Prisma will happily regenerate the client for a new enum value while
-- the database type still lacks it, and the failure surfaces at runtime.
ALTER TYPE "AgentKind" ADD VALUE IF NOT EXISTS 'SUPERVISOR';

ALTER TYPE "AgentDecisionAction" ADD VALUE IF NOT EXISTS 'SET_GOAL';
ALTER TYPE "AgentDecisionAction" ADD VALUE IF NOT EXISTS 'COMMAND_AGENT';
ALTER TYPE "AgentDecisionAction" ADD VALUE IF NOT EXISTS 'CONFIGURE_AGENT';
ALTER TYPE "AgentDecisionAction" ADD VALUE IF NOT EXISTS 'PURGE_FINDINGS';
ALTER TYPE "AgentDecisionAction" ADD VALUE IF NOT EXISTS 'PURGE_ASSETS';
ALTER TYPE "AgentDecisionAction" ADD VALUE IF NOT EXISTS 'SCHEDULE_WAKE';
ALTER TYPE "AgentDecisionAction" ADD VALUE IF NOT EXISTS 'WRITE_JOURNAL';
ALTER TYPE "AgentDecisionAction" ADD VALUE IF NOT EXISTS 'REVERT_ACTION';

DO $$ BEGIN
  CREATE TYPE "SupervisorGoalKind" AS ENUM ('CHARTER', 'GOAL', 'TASK');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupervisorGoalStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DONE', 'ABANDONED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Existing tables ──────────────────────────────────────────────────────────
-- NULL scope means shared, which is every memory written before now.
ALTER TABLE "agent_memories"
  ADD COLUMN IF NOT EXISTS "scope" "AgentKind";
CREATE INDEX IF NOT EXISTS "agent_memories_scope_idx" ON "agent_memories"("scope");

-- Agents are not alike in what they need from a model; paying one rate for all
-- of them is the easiest cost mistake available here.
ALTER TABLE "agent_configs"
  ADD COLUMN IF NOT EXISTS "ai_provider_config_id" TEXT;

-- Off by default. The supervisor sets its own pace, commands the other agents
-- and can be granted the right to delete data — a switch to throw deliberately,
-- not one to inherit from an upgrade.
ALTER TABLE "instance_settings"
  ADD COLUMN IF NOT EXISTS "supervisor_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "supervisor_daily_cost_limit_usd" DECIMAL(10,4),
  ADD COLUMN IF NOT EXISTS "supervisor_max_sleep_hours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS "supervisor_purge_budget_per_day" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS "supervisor_undo_retention_days" INTEGER NOT NULL DEFAULT 30;

-- ── Supervisor state ─────────────────────────────────────────────────────────
-- Singleton. Deliberately not the enable switch: that is
-- instance_settings.supervisor_enabled, so there is exactly one place to turn
-- the supervisor off.
CREATE TABLE IF NOT EXISTS "supervisor_state" (
  "id"                INTEGER NOT NULL DEFAULT 1,
  "next_wake_at"      TIMESTAMP(3),
  "wake_on_events"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "wake_reason"       TEXT,
  "last_wake_at"      TIMESTAMP(3),
  "paused_until"      TIMESTAMP(3),
  "consecutive_noops" INTEGER NOT NULL DEFAULT 0,
  "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supervisor_state_pkey" PRIMARY KEY ("id")
);

INSERT INTO "supervisor_state" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

-- ── Goals ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "supervisor_goals" (
  "id"         TEXT NOT NULL,
  "kind"       "SupervisorGoalKind" NOT NULL DEFAULT 'GOAL',
  "status"     "SupervisorGoalStatus" NOT NULL DEFAULT 'ACTIVE',
  "origin"     "AgentMemoryOrigin" NOT NULL DEFAULT 'OPERATOR',
  "title"      TEXT NOT NULL,
  "body"       TEXT,
  "priority"   INTEGER NOT NULL DEFAULT 0,
  "parent_id"  TEXT,
  "due_at"     TIMESTAMP(3),
  "progress"   TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "supervisor_goals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "supervisor_goals_status_priority_idx"
  ON "supervisor_goals"("status", "priority" DESC);
CREATE INDEX IF NOT EXISTS "supervisor_goals_parent_id_idx"
  ON "supervisor_goals"("parent_id");

DO $$ BEGIN
  ALTER TABLE "supervisor_goals"
    ADD CONSTRAINT "supervisor_goals_parent_id_fkey"
    FOREIGN KEY ("parent_id") REFERENCES "supervisor_goals"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Journal ──────────────────────────────────────────────────────────────────
-- Append-only, and the supervisor's actual memory of itself. `next` is a column
-- rather than prose inside a summary because the following wake reads it back
-- as its own standing intention.
CREATE TABLE IF NOT EXISTS "supervisor_journal_entries" (
  "id"            TEXT NOT NULL,
  "run_id"        TEXT,
  "wake_reason"   TEXT NOT NULL,
  "situation"     TEXT NOT NULL,
  "did"           TEXT NOT NULL,
  "next"          TEXT NOT NULL,
  "goal_ids"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "next_wake_at"  TIMESTAMP(3),
  "cost_usd"      DECIMAL(14,6),
  "operator_note" TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supervisor_journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "supervisor_journal_entries_created_at_idx"
  ON "supervisor_journal_entries"("created_at" DESC);
CREATE INDEX IF NOT EXISTS "supervisor_journal_entries_run_id_idx"
  ON "supervisor_journal_entries"("run_id");

-- ── Inbox ────────────────────────────────────────────────────────────────────
-- The observation filter's output. Rows are drained rather than deleted so the
-- journal can be reconciled against what the agent was actually told.
CREATE TABLE IF NOT EXISTS "supervisor_inbox_events" (
  "id"          TEXT NOT NULL,
  "type"        TEXT NOT NULL,
  "severity"    TEXT NOT NULL DEFAULT 'info',
  "summary"     TEXT NOT NULL,
  "payload"     JSONB,
  "consumed_at" TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "supervisor_inbox_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "supervisor_inbox_events_consumed_at_created_at_idx"
  ON "supervisor_inbox_events"("consumed_at", "created_at");
CREATE INDEX IF NOT EXISTS "supervisor_inbox_events_type_created_at_idx"
  ON "supervisor_inbox_events"("type", "created_at" DESC);

-- ── Undo ─────────────────────────────────────────────────────────────────────
-- Modelled on correlation_decision_batches, the undo log here that already
-- works — including its honesty. Undo is not time travel: whether an entry
-- still applies is a freshness question answered when the log is read, which is
-- why there is no "undoable" column to go stale.
CREATE TABLE IF NOT EXISTS "agent_undo_entries" (
  "id"             TEXT NOT NULL,
  "run_id"         TEXT NOT NULL,
  "decision_id"    TEXT,
  "action"         "AgentDecisionAction" NOT NULL,
  "label"          TEXT NOT NULL,
  "entity_type"    TEXT,
  "entity_id"      TEXT,
  "revert_kind"    TEXT NOT NULL,
  "revert_payload" JSONB NOT NULL,
  "reverted_at"    TIMESTAMP(3),
  "reverted_by"    TEXT,
  "expires_at"     TIMESTAMP(3) NOT NULL,
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_undo_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "agent_undo_entries_reverted_at_created_at_idx"
  ON "agent_undo_entries"("reverted_at", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "agent_undo_entries_run_id_idx"
  ON "agent_undo_entries"("run_id");
