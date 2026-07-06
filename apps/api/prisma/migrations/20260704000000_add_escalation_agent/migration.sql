-- AlterEnum: new harness mission kind for the alerting/escalation agent.
ALTER TYPE "AgentKind" ADD VALUE IF NOT EXISTS 'ESCALATION';

-- AlterEnum: decision action recorded when the escalation agent alerts an operator.
ALTER TYPE "AgentDecisionAction" ADD VALUE IF NOT EXISTS 'NOTIFY_OPERATOR';

-- AlterTable: instance-wide toggle + optional guidance for the escalation agent.
ALTER TABLE "instance_settings"
  ADD COLUMN IF NOT EXISTS "autopilot_escalation_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "autopilot_escalation_guidance" TEXT;
