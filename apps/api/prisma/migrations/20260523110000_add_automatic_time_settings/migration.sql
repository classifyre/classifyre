-- AlterEnum: add AUTOMATIC to InstanceTimeFormat
ALTER TYPE "InstanceTimeFormat" ADD VALUE 'AUTOMATIC';

-- Change default for time_format to AUTOMATIC
ALTER TABLE "instance_settings" ALTER COLUMN "time_format" SET DEFAULT 'AUTOMATIC';

-- Change default for timezone to AUTOMATIC
ALTER TABLE "instance_settings" ALTER COLUMN "timezone" SET DEFAULT 'AUTOMATIC';
