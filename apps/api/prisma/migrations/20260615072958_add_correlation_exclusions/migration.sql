-- AlterTable
ALTER TABLE "correlation_config" ADD COLUMN     "exclusions" JSONB NOT NULL DEFAULT '[]';
