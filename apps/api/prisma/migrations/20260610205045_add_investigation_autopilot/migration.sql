-- CreateEnum
CREATE TYPE "AiManagementMode" AS ENUM ('INHERIT', 'MANAGED', 'OBSERVE_ONLY');

-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('INQUIRY', 'CASE');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AgentDecisionAction" AS ENUM ('CREATE_INQUIRY', 'UPDATE_INQUIRY', 'ENRICH_INQUIRY_MATCHERS', 'SIGNAL_CASE_READY', 'CREATE_CASE', 'UPDATE_CASE', 'ADD_HYPOTHESIS', 'UPDATE_HYPOTHESIS', 'ADD_EVIDENCE', 'ATTACH_FINDINGS', 'ADD_NOTE', 'ADD_THREAD_ENTRY', 'CREATE_EDGE', 'CHANGE_STATUS', 'LINK_INQUIRY', 'NO_ACTION');

-- CreateEnum
CREATE TYPE "AgentDecisionOutcome" AS ENUM ('APPLIED', 'SKIPPED_OBSERVE_ONLY', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentMemoryKind" AS ENUM ('GLOSSARY', 'DECISION_PRECEDENT', 'TOPIC_INQUIRY_MAP');

-- DropForeignKey
ALTER TABLE "case_activities" DROP CONSTRAINT "case_activities_case_id_fkey";

-- DropForeignKey
ALTER TABLE "case_thread_entries" DROP CONSTRAINT "case_thread_entries_thread_id_fkey";

-- DropForeignKey
ALTER TABLE "case_thread_support" DROP CONSTRAINT "case_thread_support_entry_id_fkey";

-- DropForeignKey
ALTER TABLE "case_thread_support" DROP CONSTRAINT "case_thread_support_thread_id_fkey";

-- DropForeignKey
ALTER TABLE "case_threads" DROP CONSTRAINT "case_threads_case_id_fkey";

-- AlterTable
ALTER TABLE "case_activities" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "case_thread_entries" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "case_thread_support" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "case_threads" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "status" SET DEFAULT 'PROPOSED',
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "ai_mode" "AiManagementMode" NOT NULL DEFAULT 'INHERIT';

-- AlterTable
ALTER TABLE "inquiries" ADD COLUMN     "ai_mode" "AiManagementMode" NOT NULL DEFAULT 'INHERIT';

-- AlterTable
ALTER TABLE "instance_settings" ADD COLUMN     "autopilot_case_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autopilot_case_guidance" TEXT,
ADD COLUMN     "autopilot_inquiry_desired" TEXT,
ADD COLUMN     "autopilot_inquiry_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autopilot_inquiry_searchable" TEXT;

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "agent_kind" "AgentKind" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'PENDING',
    "source_id" TEXT,
    "runner_id" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'scan_completed',
    "current_step" TEXT,
    "step_state" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "summary" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_decisions" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "action" "AgentDecisionAction" NOT NULL,
    "outcome" "AgentDecisionOutcome" NOT NULL DEFAULT 'APPLIED',
    "entity_type" TEXT,
    "entity_id" TEXT,
    "rationale" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_memories" (
    "id" TEXT NOT NULL,
    "kind" "AgentMemoryKind" NOT NULL,
    "key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ref_type" TEXT,
    "ref_id" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_memories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_runs_agent_kind_created_at_idx" ON "agent_runs"("agent_kind", "created_at" DESC);

-- CreateIndex
CREATE INDEX "agent_runs_status_idx" ON "agent_runs"("status");

-- CreateIndex
CREATE INDEX "agent_decisions_run_id_idx" ON "agent_decisions"("run_id");

-- CreateIndex
CREATE INDEX "agent_decisions_entity_type_entity_id_idx" ON "agent_decisions"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "agent_decisions_action_created_at_idx" ON "agent_decisions"("action", "created_at" DESC);

-- CreateIndex
CREATE INDEX "agent_memories_kind_idx" ON "agent_memories"("kind");

-- CreateIndex
CREATE INDEX "agent_memories_tags_idx" ON "agent_memories" USING GIN ("tags");

-- CreateIndex
CREATE UNIQUE INDEX "agent_memories_kind_key_key" ON "agent_memories"("kind", "key");

-- AddForeignKey
ALTER TABLE "case_threads" ADD CONSTRAINT "case_threads_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_thread_entries" ADD CONSTRAINT "case_thread_entries_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "case_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_thread_support" ADD CONSTRAINT "case_thread_support_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "case_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_thread_support" ADD CONSTRAINT "case_thread_support_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "case_thread_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_activities" ADD CONSTRAINT "case_activities_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "case_thread_support_target_type_id_idx" RENAME TO "case_thread_support_target_type_target_id_idx";

-- Full-text search indexes for memory recall (pg_trgm intentionally avoided —
-- not available in all PostgreSQL distributions; see matched_content_trgm migration).
CREATE INDEX "agent_memories_key_fts_idx" ON "agent_memories" USING GIN (to_tsvector('simple', "key"));
CREATE INDEX "agent_memories_content_fts_idx" ON "agent_memories" USING GIN (to_tsvector('simple', "content"));
