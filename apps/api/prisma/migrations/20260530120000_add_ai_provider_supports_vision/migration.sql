-- Add a per-provider capability flag indicating the model accepts image/PDF
-- (vision) input. When enabled, vision-capable detectors send rendered file
-- images to the model instead of extracted text.

-- AlterTable
ALTER TABLE "ai_provider_config" ADD COLUMN "supports_vision" BOOLEAN NOT NULL DEFAULT false;
