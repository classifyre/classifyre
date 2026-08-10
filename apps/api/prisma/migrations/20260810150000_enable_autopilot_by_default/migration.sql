-- Autopilot agents were opt-in even though entity aiMode defaults to INHERIT,
-- so a fresh workspace resolved every inherited entity to OBSERVE_ONLY and no
-- investigation loop ran until six separate switches were enabled manually.
--
-- New workspaces should run the full investigation loop by default. Entities
-- remain INHERIT so one instance switch can still stop a domain, while an
-- explicit OBSERVE_ONLY entity remains protected by the normal mutation gate.
--
-- This changes column defaults only. Existing workspace rows are deliberately
-- not rewritten: false may be an operator's explicit safety choice, and a
-- migration cannot distinguish that from the historical default.

-- AlterTable
ALTER TABLE "instance_settings"
  ALTER COLUMN "autopilot_inquiry_enabled" SET DEFAULT true,
  ALTER COLUMN "autopilot_case_enabled" SET DEFAULT true,
  ALTER COLUMN "autopilot_config_enabled" SET DEFAULT true,
  ALTER COLUMN "autopilot_detector_enabled" SET DEFAULT true,
  ALTER COLUMN "autopilot_escalation_enabled" SET DEFAULT true,
  ALTER COLUMN "autopilot_mcp_enabled" SET DEFAULT true;
