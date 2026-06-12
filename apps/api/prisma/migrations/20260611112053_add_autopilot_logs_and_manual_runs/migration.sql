-- CreateEnum
CREATE TYPE "AgentLogChannel" AS ENUM ('TECHNICAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "AgentLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "cycle_key" TEXT,
ADD COLUMN     "instruction" TEXT;

-- CreateTable
CREATE TABLE "agent_logs" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "channel" "AgentLogChannel" NOT NULL,
    "level" "AgentLogLevel" NOT NULL DEFAULT 'INFO',
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_logs_run_id_created_at_idx" ON "agent_logs"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_logs_run_id_channel_idx" ON "agent_logs"("run_id", "channel");

-- CreateIndex
CREATE INDEX "agent_runs_cycle_key_idx" ON "agent_runs"("cycle_key");

-- AddForeignKey
ALTER TABLE "agent_logs" ADD CONSTRAINT "agent_logs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
