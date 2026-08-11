-- Provider assignment is now the single source of truth for whether the
-- Assistant and Harness are enabled. Preserve the effective disabled state of
-- existing installations before removing the redundant switches.
UPDATE "instance_settings"
SET "ai_provider_config_id" = NULL
WHERE "ai_enabled" = false;

UPDATE "instance_settings"
SET "harness_ai_provider_config_id" = NULL
WHERE "harness_enabled" = false;

ALTER TABLE "instance_settings"
DROP COLUMN "ai_enabled",
DROP COLUMN "harness_enabled";
