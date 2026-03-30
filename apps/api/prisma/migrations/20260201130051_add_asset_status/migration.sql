-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('NEW', 'UPDATED', 'UNCHANGED', 'DELETED');

-- AlterTable
ALTER TABLE "assets" ADD COLUMN     "status" "AssetStatus" NOT NULL DEFAULT 'NEW';

-- CreateIndex
CREATE INDEX "assets_status_idx" ON "assets"("status");
