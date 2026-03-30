-- AlterEnum
-- This migration updates DetectorCategory enum values to match API usage
-- Note: The Detector model is not yet in use, so this is safe

-- Remove old values (if they exist)
-- Note: PostgreSQL doesn't support removing enum values directly
-- We'll add new values and the old ones will remain unused

-- Add new enum values
ALTER TYPE "DetectorCategory" ADD VALUE IF NOT EXISTS 'SECRETS';
ALTER TYPE "DetectorCategory" ADD VALUE IF NOT EXISTS 'PII';
ALTER TYPE "DetectorCategory" ADD VALUE IF NOT EXISTS 'CONTENT';
ALTER TYPE "DetectorCategory" ADD VALUE IF NOT EXISTS 'THREAT';

-- Note: Old values (SECURITY, PRIVACY, COMPLIANCE) remain in the enum
-- but are not used. They can be removed in a future migration if needed
-- by recreating the enum type.
