-- Governed data assets, phase G-5 (docs/prd/GOV-governed-data-assets.md):
-- notifications to the people who answer for an asset, by name.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'GOVERNANCE';
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "audience_person_refs" TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS "notifications_audience_person_refs_idx" ON "notifications" USING GIN ("audience_person_refs");
