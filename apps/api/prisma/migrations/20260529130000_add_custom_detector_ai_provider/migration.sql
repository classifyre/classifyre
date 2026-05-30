-- Link custom detectors to a configured AI provider credential (required for LLM detectors).

-- AlterTable
ALTER TABLE "custom_detectors" ADD COLUMN "ai_provider_config_id" TEXT;

-- CreateIndex
CREATE INDEX "custom_detectors_ai_provider_config_id_idx" ON "custom_detectors"("ai_provider_config_id");

-- AddForeignKey
ALTER TABLE "custom_detectors" ADD CONSTRAINT "custom_detectors_ai_provider_config_id_fkey" FOREIGN KEY ("ai_provider_config_id") REFERENCES "ai_provider_config"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
