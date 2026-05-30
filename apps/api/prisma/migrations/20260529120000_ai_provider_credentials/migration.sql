-- Replace the singleton ai_provider_config with multiple, named, reusable credentials.
-- No production data exists yet, so the old singleton row is dropped.

-- DropTable
DROP TABLE "ai_provider_config";

-- CreateTable
CREATE TABLE "ai_provider_config" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" "AiProviderType" NOT NULL DEFAULT 'CLAUDE',
    "model" TEXT NOT NULL DEFAULT '',
    "api_key_enc" TEXT,
    "base_url" TEXT,
    "context_size" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_config_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "instance_settings" ADD COLUMN "ai_provider_config_id" TEXT;

-- AddForeignKey
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_ai_provider_config_id_fkey" FOREIGN KEY ("ai_provider_config_id") REFERENCES "ai_provider_config"("id") ON DELETE SET NULL ON UPDATE CASCADE;
