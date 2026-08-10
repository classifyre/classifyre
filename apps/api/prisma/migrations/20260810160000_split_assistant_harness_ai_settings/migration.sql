ALTER TABLE "instance_settings"
ADD COLUMN "harness_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "harness_ai_provider_config_id" TEXT;

-- Preserve existing behavior on upgrade: the old AI switch/provider controlled
-- both surfaces, so seed the new Harness-specific settings from them.
UPDATE "instance_settings"
SET
  "harness_enabled" = "ai_enabled",
  "harness_ai_provider_config_id" = "ai_provider_config_id";

ALTER TABLE "instance_settings"
ADD CONSTRAINT "instance_settings_harness_ai_provider_config_id_fkey"
FOREIGN KEY ("harness_ai_provider_config_id")
REFERENCES "ai_provider_config"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
