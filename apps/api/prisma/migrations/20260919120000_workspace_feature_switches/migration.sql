-- Workspace feature switches (Settings → Cleanup › Features).
--
-- Duplicate detection gains an on/off switch next to the one embeddings already
-- had, and both record HOW they were turned off: "kept" (a pause — results stay
-- and turning back on catches up) or "deleted" (results wiped). Null while on;
-- a switch that is off with no mode recorded (turned off before this column
-- existed) reads as "kept", the mode that never stops collecting input.
--
-- Existing workspaces keep duplicate detection on (DEFAULT true), exactly as
-- before this migration. Every statement is idempotent so a partially applied
-- run can be repeated.

ALTER TABLE "correlation_config" ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "correlation_config" ADD COLUMN IF NOT EXISTS "disabled_mode" TEXT;
ALTER TABLE "correlation_config" ADD COLUMN IF NOT EXISTS "enabled_changed_at" TIMESTAMP(3);

ALTER TABLE "embedding_settings" ADD COLUMN IF NOT EXISTS "disabled_mode" TEXT;
ALTER TABLE "embedding_settings" ADD COLUMN IF NOT EXISTS "enabled_changed_at" TIMESTAMP(3);
