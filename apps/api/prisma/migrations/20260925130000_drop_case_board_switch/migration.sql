-- The case board is the case now: the per-workspace rollout switch that kept
-- cases on the legacy graph workspace is gone, and so is the graph workspace.
ALTER TABLE "instance_settings" DROP COLUMN IF EXISTS "case_board_enabled";
