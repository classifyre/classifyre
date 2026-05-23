-- AlterEnum
ALTER TYPE "InstanceLanguage" ADD VALUE 'AUTOMATIC';

-- Set new default
ALTER TABLE "instance_settings" ALTER COLUMN "language" SET DEFAULT 'AUTOMATIC';
