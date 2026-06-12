-- AlterEnum
ALTER TYPE "AgentDecisionAction" ADD VALUE 'REMOVE_EDGE';

-- AlterEnum
ALTER TYPE "AgentDecisionAction" ADD VALUE 'LINK_SUPPORT';

-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN "case_id" TEXT;

-- CreateIndex
CREATE INDEX "agent_runs_case_id_created_at_idx" ON "agent_runs"("case_id", "created_at" DESC);
