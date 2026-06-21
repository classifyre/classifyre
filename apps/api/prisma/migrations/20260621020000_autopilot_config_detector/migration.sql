-- AlterEnum: new agent kinds
ALTER TYPE "AgentKind" ADD VALUE 'CONFIG';
ALTER TYPE "AgentKind" ADD VALUE 'DETECTOR_AUTHOR';

-- Per-entity autopilot management mode
ALTER TABLE "sources" ADD COLUMN "ai_mode" "AiManagementMode" NOT NULL DEFAULT 'INHERIT';
ALTER TABLE "custom_detectors" ADD COLUMN "ai_mode" "AiManagementMode" NOT NULL DEFAULT 'INHERIT';

-- Instance-wide opt-in flags + guidance for the new agents
ALTER TABLE "instance_settings" ADD COLUMN "autopilot_config_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "instance_settings" ADD COLUMN "autopilot_config_guidance" TEXT;
ALTER TABLE "instance_settings" ADD COLUMN "autopilot_detector_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "instance_settings" ADD COLUMN "autopilot_detector_guidance" TEXT;
ALTER TABLE "instance_settings" ADD COLUMN "autopilot_mcp_enabled" BOOLEAN NOT NULL DEFAULT false;
